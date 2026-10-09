"""Check source or built Bundle assets against the shared pinned dictionary manifest."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[3]
manifest = json.loads((root / "contracts/wordnet-assets-v1.json").read_text())
folder = Path(sys.argv[1]) if len(sys.argv) > 1 else root / manifest["sourcePath"]
for name, digest in manifest["files"].items():
    path = folder / name
    assert path.is_file(), f"Missing packaged dictionary file: {name}"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, f"Dictionary hash mismatch: {name}"
print(f"Verified {len(manifest['files'])} WordNet files including metadata and licenses.")
