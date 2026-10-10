"""Regression tests for the public main and Codex auxiliary-ref boundary."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("release_verify", Path(__file__).with_name("release-verify.py"))
assert spec is not None and spec.loader is not None
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

TREE = "b" * 40
OTHER_TREE = "c" * 40
CHECKPOINT = (
    "refs/codex/turn-diffs/checkpoints/" + "a" * 32 + "/" + "d" * 32
    + "/1791610046360/398b8103-7160-4536-90b6-990869b55923"
)
CAPTURE = "refs/codex/turn-diffs/captures/1791610346900/5e960e88-2095-49c4-834f-039e385b7cc8/base"


class AuxiliaryRefTests(unittest.TestCase):
    def accept(self, ref, kind="tree", oid=TREE):
        verifier.validate_auxiliary_ref(ref, kind, oid, {TREE})

    def test_same_tree_checkpoint(self):
        self.accept(CHECKPOINT)

    def test_existing_same_tree_capture(self):
        self.accept(CAPTURE)

    def test_different_checkpoint_tree_rejected(self):
        with self.assertRaisesRegex(AssertionError, "differs from an audited main tree"):
            self.accept(CHECKPOINT, oid=OTHER_TREE)

    def test_different_capture_tree_rejected(self):
        with self.assertRaisesRegex(AssertionError, "differs from an audited main tree"):
            self.accept(CAPTURE, oid=OTHER_TREE)

    def test_checkpoint_commit_rejected(self):
        with self.assertRaisesRegex(AssertionError, "must not add commit history"):
            self.accept(CHECKPOINT, kind="commit")

    def test_checkpoint_blob_rejected(self):
        with self.assertRaisesRegex(AssertionError, "must not add commit history"):
            self.accept(CHECKPOINT, kind="blob")

    def test_unknown_namespace_rejected_even_for_same_tree(self):
        with self.assertRaisesRegex(AssertionError, "Unexpected ref"):
            self.accept(CHECKPOINT.replace("checkpoints/", "other/"))

    def test_malformed_checkpoint_rejected(self):
        with self.assertRaisesRegex(AssertionError, "Unexpected ref"):
            self.accept("refs/codex/turn-diffs/checkpoints/arbitrary")

    def test_checkpoint_child_ref_rejected(self):
        with self.assertRaisesRegex(AssertionError, "Unexpected ref"):
            self.accept(CHECKPOINT + "/extra")

    def test_tag_rejected_even_for_same_tree(self):
        with self.assertRaisesRegex(AssertionError, "Unexpected ref"):
            self.accept("refs/tags/release")

    def test_other_branch_rejected_even_for_same_tree(self):
        with self.assertRaisesRegex(AssertionError, "Unexpected ref"):
            self.accept("refs/heads/other")


class PublishedMainRefTests(unittest.TestCase):
    def test_main_tracking_commit(self):
        verifier.validate_origin_main_ref("refs/remotes/origin/main", "commit", TREE, {TREE})

    def test_main_tracking_tree_rejected(self):
        with self.assertRaises(AssertionError):
            verifier.validate_origin_main_ref("refs/remotes/origin/main", "tree", TREE, {TREE})

    def test_unrelated_commit_rejected(self):
        with self.assertRaises(AssertionError):
            verifier.validate_origin_main_ref("refs/remotes/origin/main", "commit", OTHER_TREE, {TREE})

    def test_other_remote_branch_rejected(self):
        with self.assertRaises(AssertionError):
            verifier.validate_origin_main_ref("refs/remotes/origin/other", "commit", TREE, {TREE})


if __name__ == "__main__":
    unittest.main()
