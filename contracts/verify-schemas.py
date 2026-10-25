"""Optional JSON Schema checks. Install jsonschema==4.25.1 in a disposable environment."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parent
for path in root.glob("*.schema.json"):
    Draft202012Validator.check_schema(json.loads(path.read_text()))
    print(path.name + ": meta-schema passed")
legacy = Draft202012Validator(json.loads((root / "legacy-word-entry.schema.json").read_text()))
for case in json.loads((root / "fixtures/legacy-validation.json").read_text()):
    assert legacy.is_valid(case["data"]) == case["valid"], case["name"]
print("Legacy schema acceptance/rejection fixtures passed.")
backup = Draft202012Validator(json.loads((root / "backup-v1.schema.json").read_text()))
backup.validate(json.loads((root / "fixtures/backup-v1.json").read_text()))
print("Versioned backup fixture passed.")
wire = json.loads((root / "fixtures/sync-create-v1.json").read_text())
Draft202012Validator(json.loads((root / "sync-api-v1.schema.json").read_text())).validate(wire["request"])
Draft202012Validator(json.loads((root / "sync-api-v1.schema.json").read_text())).validate(
    json.loads((root / "fixtures/sync-legacy-merge-v1.json").read_text())["request"])
replies = Draft202012Validator(json.loads((root / "sync-responses-v1.schema.json").read_text()))
replies.validate(wire["response"])
replies.validate(json.loads((root / "fixtures/sync-errors-v1.json").read_text()))
print("Unified wire request/response/error fixtures passed.")
reminder = Draft202012Validator(json.loads((root / "reminder-device-v1.schema.json").read_text()))
reminder_fixture = json.loads((root / "fixtures/reminder-device-v1.json").read_text())
for key in ["request", "response", "released"]:
    reminder.validate(reminder_fixture[key])
for invalid in reminder_fixture["invalidResponses"]:
    assert not reminder.is_valid(invalid)
print("Reminder device selection fixtures passed.")
