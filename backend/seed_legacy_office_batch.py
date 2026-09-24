"""Seed a LEGACY office import batch (no rollback_version) like the ones on the live site:
3 properties Approved via office import, 1 pristine survey + 2 edited surveys (no restore
snapshot) — reproduces the 'older/edited survey has no restore snapshot' deletion block.
Idempotent."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
DB = os.environ.get("DB_NAME", "phed_preview")
BATCH_ID = "legacy-office-batch-test"
FILENAME = "legacy_office_wrong.xlsx"


def main():
    db = MongoClient(os.environ["MONGO_URL"])[DB]
    ts = datetime.now(timezone.utc).isoformat()
    later = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()

    db.phed_office_imports.update_one(
        {"id": BATCH_ID},
        {"$set": {"id": BATCH_ID, "filename": FILENAME, "status": "Completed",
                  "uploaded_by": "seed", "uploaded_by_name": "Seed", "created_at": ts,
                  "result": {"approved": 3}}},  # NOTE: no rollback_version -> legacy batch
        upsert=True)

    for i in (1, 2, 3):
        pnum = f"LEGP000{i}"
        pid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"legacy-prop-{i}"))
        db.properties.update_one(
            {"property_id": pnum},
            {"$set": {"id": pid, "property_id": pnum, "owner_name": f"Legacy Owner {i}",
                      "colony": "Legacy Colony", "ward": "3", "status": "Active",
                      "phed_survey_status": "Approved", "phed_survey_state": "Approved",
                      "phed_survey_type": "WATER_CONNECTION", "phed_surveyed_at": ts,
                      "phed_survey_source": "office", "phed_outcome": "HAS_CONNECTION",
                      "updated_at": ts},
             "$setOnInsert": {"created_at": ts}},
            upsert=True)
        edited = i > 1  # survey 1 pristine; surveys 2 & 3 edited later -> no snapshot
        db.phed_surveys.update_one(
            {"property_record_id": pid, "office_batch_id": BATCH_ID},
            {"$set": {"id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"legacy-survey-{i}")),
                      "property_record_id": pid, "property_id": pnum,
                      "survey_type": "WATER_CONNECTION", "source": "office",
                      "office_batch_id": BATCH_ID, "status": "Approved",
                      "water": {"consumer_name": f"Legacy Owner {i}", "has_connection": True},
                      "surveyor_id": "seed", "surveyor_name": "Seed", "attachments": [],
                      "started_at": ts, "submitted_at": ts, "created_at": ts,
                      "updated_at": later if edited else ts}},
            upsert=True)

    print(f"Seeded legacy office batch '{FILENAME}' (id={BATCH_ID}): 3 properties Approved, "
          "1 pristine survey + 2 edited surveys (edited ones block normal deletion)")


if __name__ == "__main__":
    main()
