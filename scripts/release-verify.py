"""Read-only verification of the public tree against the audited source manifest."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, help="Optional read-only original checkout")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "docs/SOURCE_COPY_MANIFEST.json").read_text(encoding="utf-8"))
    for row in manifest["files"]:
        target = root / row["target"]
        assert target.is_file(), f"Missing preserved source: {row['target']}"
        target_bytes = target.read_bytes()
        exact = hashlib.sha256(target_bytes).hexdigest() == row["target_sha256"]
        normalized = hashlib.sha256(target_bytes.replace(b"\r\n", b"\n")).hexdigest() == row["target_lf_sha256"]
        assert exact or normalized, f"Changed target: {row['target']}"
        if args.source:
            data = subprocess.check_output(["git", "show", f"{manifest['source_head']}:{row['source']}"], cwd=args.source)
            assert hashlib.sha256(data).hexdigest() == row["source_git_blob_sha256"], f"Source blob mismatch: {row['source']}"
            assert hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest() == row["source_lf_sha256"], f"Source content mismatch: {row['source']}"
    for row in manifest["added_files"]:
        target = root / row["target"]
        assert target.is_file(), f"Missing new release file: {row['target']}"
        if row.get("target_sha256"):
            assert hashlib.sha256(target.read_bytes()).hexdigest() == row["target_sha256"], f"Changed release file: {row['target']}"
        else:
            assert row["target"] == "docs/SOURCE_COPY_MANIFEST.json", "Only the manifest itself may omit a self-referential hash"
    git = lambda *argv: subprocess.check_output(["git", *argv], cwd=root).decode().strip()
    assert git("branch", "--show-current") == "main"
    assert git("remote") == "origin"
    assert git("remote", "get-url", "origin") == "https://github.com/xichugeek/XichuQuant.git"
    assert git("remote", "get-url", "--push", "origin") == "https://github.com/xichugeek/XichuQuant.git"
    assert not git("tag", "--list"), "Release tags need separate approval"
    assert not (root / ".git/objects/info/alternates").exists()
    tracked = git("ls-files", "-z").split("\0")
    expected = {row["target"] for row in manifest["files"] + manifest["added_files"]}
    assert set(filter(None, tracked)) == expected, "Tracked files differ from the explicit release manifest"
    refs = git("for-each-ref", "--format=%(refname)").splitlines()
    main_commits = git("rev-list", "main").splitlines()
    audited_trees = {git("rev-parse", f"{commit}^{{tree}}") for commit in main_commits}
    captures = []
    for ref in refs:
        if ref == "refs/heads/main":
            continue
        assert re.fullmatch(r"refs/codex/turn-diffs/captures/[0-9]+/[0-9a-f-]+/base", ref), f"Unexpected ref: {ref}"
        assert git("cat-file", "-t", ref) == "tree", f"Capture must not add commit history: {ref}"
        assert git("rev-parse", ref) in audited_trees, f"Capture differs from an audited main tree: {ref}"
        captures.append(ref)
    assert "refs/heads/main" in refs
    assert set(git("rev-list", "--all").splitlines()) == set(main_commits), "Unexpected reachable history"
    roots = git("rev-list", "--max-parents=0", "--all").splitlines()
    assert len(roots) == 1 and roots[0] != manifest["source_head"]
    assert roots[0] == manifest["target_git_root"], "Independent audited root must be preserved"
    assert git("rev-list", "--parents", "-n", "1", roots[0]) == roots[0], "Root commit must have no parents"
    commits = int(git("rev-list", "--all", "--count"))
    assert subprocess.run(["git", "cat-file", "-e", manifest["source_head"]], cwd=root, capture_output=True).returncode != 0, "Original commit object is present"
    if args.source:
        original_commits = set(subprocess.check_output(["git", "rev-list", "--all"], cwd=args.source).decode().splitlines())
        assert not original_commits.intersection(main_commits), "Original history is reachable"
    print(json.dumps({"result": "PASS", "preserved_files": len(manifest["files"]),
                      "new_files": len(manifest["added_files"]), "tracked_files": len(expected),
                      "source_head": manifest["source_head"], "target_head": git("rev-parse", "HEAD"),
                      "commits": commits, "root_has_no_parent": True,
                      "audited_local_capture_trees": len(captures)}, ensure_ascii=True))


if __name__ == "__main__":
    main()
