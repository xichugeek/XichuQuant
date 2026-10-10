"""Build a metadata inventory from installed dependencies; not a legal clearance."""
import argparse
import importlib.metadata
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--node", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
node_data = json.loads(Path(args.node).read_text(encoding="utf-8-sig"))
node_rows = sorted(
    [{"name": row["name"], "versions": row["versions"], "license": license_name}
     for license_name, rows in node_data.items() for row in rows], key=lambda row: row["name"]
)
python_rows = []
for dist in importlib.metadata.distributions():
    license_text = dist.metadata.get("License-Expression") or dist.metadata.get("License", "UNKNOWN")
    if len(license_text) > 200 or "\n" in license_text:
        license_text = "SEE_INSTALLED_LICENSE_FILES"
    python_rows.append({"name": dist.metadata["Name"], "version": dist.version, "licenseMetadata": license_text,
                        "licenseClassifiers": [x for x in dist.metadata.get_all("Classifier", []) if x.startswith("License ::")]})
report = {"status": "INVENTORY_ONLY_PENDING_RIGHTS_REVIEW", "scope": "Windows installed workspace; runtime and development dependencies; Linux image inventory NOT_RUN",
          "node": node_rows, "python": sorted(python_rows, key=lambda row: row["name"].lower())}
Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Inventory written: {len(node_rows)} Node package names, {len(python_rows)} Python distributions; no license selected.")
