"""Exercise the built probe against disposable SQLite stores in separate processes."""
import json
import pathlib
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parents[3]
binary = pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="rememberme-process-") as folder:
    for mode, expected in [("before-publish", "0:0"), ("after-publish", "1:1")]:
        store = pathlib.Path(folder) / mode / "vocabulary.sqlite"
        subprocess.run([str(binary), mode, str(store)], check=True)
        actual = subprocess.run([str(binary), "inspect", str(store)], check=True, capture_output=True, text=True).stdout.strip()
        assert actual == expected, (mode, actual, expected)
        print(f"{mode}: fresh-process recovery {actual} passed", flush=True)
    report = subprocess.run([str(binary), "contracts", str(root / "contracts/fixtures/legacy-shared.json")],
                            check=True, capture_output=True, text=True)
    expected = json.loads((root / "contracts/fixtures/legacy-expected.json").read_text())
    assert json.loads(report.stdout) == expected
    print("Independent Swift/TypeScript source identity report passed.", flush=True)
    for mode in ["import-copy-exit", "import-stage-exit", "import-ready-exit"]:
        store = pathlib.Path(folder) / mode / "vocabulary.sqlite"
        subprocess.run([str(binary), mode, str(store)], check=True)
        before = subprocess.run([str(binary), "inspect", str(store)], check=True, capture_output=True, text=True).stdout.strip()
        assert before == "1:1", (mode, before)
        resumed = subprocess.run([str(binary), "import-resume", str(store)], check=True, capture_output=True, text=True).stdout.strip()
        assert resumed == "3:3", (mode, resumed)
        print(f"{mode}: fresh-process resume passed, original 1/1 becomes 3 words/3 operations.", flush=True)
    shared = pathlib.Path(folder) / "capture-process"
    subprocess.run([str(binary), "capture-save", str(shared)], check=True)
    subprocess.run([str(binary), "capture-before-ack", str(shared)], check=True)
    assert len(list((shared / "inbox").glob("*.json"))) == 1
    subprocess.run([str(binary), "capture-drain", str(shared)], check=True)
    actual = subprocess.run([str(binary), "capture-inspect", str(shared)], check=True, capture_output=True, text=True).stdout.strip()
    assert actual == "1:0:0", actual
    assert not list((shared / "inbox").glob("*.json"))
    print("Share inbox fresh-process write/drain recovery passed: 1 pending draft, 0 words, 0 operations.", flush=True)
    sync_store = pathlib.Path(folder) / "sync-process" / "vocabulary.sqlite"
    subprocess.run([str(binary), "sync-freeze-exit", str(sync_store)], check=True)
    report = subprocess.run([str(binary), "sync-inspect", str(sync_store)], check=True, capture_output=True, text=True).stdout.strip()
    assert report == "Frozen request/identity/backoff/local vocabulary survived a separate process.", report
    print(report, flush=True)
