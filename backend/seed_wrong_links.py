"""Seed demo wrong-link data: 3 properties + 3 PHED consumers wrongly linked to them,
one via office receipt (auto EXISTING_LINKED survey blocking the property), one via import,
one manual. For verifying the Link Cleanup feature. Idempotent."""
import asyncio
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
DB = os.environ.get("DB_NAME", "phed_preview")


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[DB]
    ts = datetime.now(timezone.utc).isoformat()
    props = [
        {"property_id": "TESTP0001", "owner_name": "Ramesh Kumar", "colony": "Lal Dora Dhobi Mohalla", "ward": "1", "mobile": "9811111111", "address": "H.No 12, Dhobi Mohalla"},
        {"property_id": "TESTP0002", "owner_name": "Sunita Devi", "colony": "Aman Palace", "ward": "2", "mobile": "9822222222", "address": "H.No 45, Aman Palace"},
        {"property_id": "TESTP0003", "owner_name": "Amit Singh", "colony": "Lal Dora Dhobi Mohalla", "ward": "1", "mobile": "9833333333", "address": "H.No 78, Dhobi Mohalla"},
    ]
    prop_refs = {}
    for p in props:
        existing = await db.properties.find_one({"property_id": p["property_id"]}, {"_id": 0, "id": 1})
        pid = (existing or {}).get("id") or str(uuid.uuid4())
        prop_refs[p["property_id"]] = pid
        await db.properties.update_one(
            {"property_id": p["property_id"]},
            {"$set": {**p, "id": pid, "status": "Active", "updated_at": ts}, "$setOnInsert": {"created_at": ts}},
            upsert=True)

    consumers = [
        # consumer wrongly attached to property 1 via office receipt (+ blocking auto-survey)
        {"consumer_id": "TESTC001", "consumer_name": "Wrong Person One", "phone": "9416540408", "prop": "TESTP0001", "source": "imported", "office": True},
        # consumer wrongly attached to property 2 via excel import
        {"consumer_id": "TESTC002", "consumer_name": "Wrong Person Two", "phone": "9422222222", "prop": "TESTP0002", "source": "imported", "import_id": "test-import-1"},
        # consumer wrongly attached to property 3 manually
        {"consumer_id": "TESTC003", "consumer_name": "Wrong Person Three", "phone": "9433333333", "prop": "TESTP0003", "source": "admin"},
    ]
    for c in consumers:
        pid = prop_refs[c["prop"]]
        pnum = c["prop"]
        ref = str(uuid.uuid4())
        doc = {
            "id": ref, "consumer_id": c["consumer_id"], "consumer_id_norm": c["consumer_id"],
            "consumer_name": c["consumer_name"], "name_norm": c["consumer_name"].lower(),
            "phone": c["phone"], "phone_norm": c["phone"], "colony_name": "Lal Dora Dhobi Mohalla",
            "address": "wrong address", "locality": "Lal Dora Dhobi Mohalla", "category": "Domestic",
            "source": c["source"], "import_id": c.get("import_id"), "linked_property_id": pid,
            "linked_property_number": pnum, "status": "Surveyed" if c.get("office") else "Not Started",
            "is_active": True, "created_at": ts, "updated_at": ts,
        }
        if c.get("office"):
            doc["office_document_receipt"] = {
                "property_record_id": pid, "property_id": pnum,
                "status": "Water documents received at office", "remarks": "test",
                "received_at": ts, "received_by": "seed", "received_by_name": "Seed"}
        await db.phed_consumers.update_one({"consumer_id": c["consumer_id"]}, {"$set": doc}, upsert=True)
        consumer = await db.phed_consumers.find_one({"consumer_id": c["consumer_id"]}, {"_id": 0, "id": 1})
        cref = consumer["id"]
        await db.phed_connections.update_one(
            {"consumer_ref": cref, "service": "Water"},
            {"$set": {"id": str(uuid.uuid4()), "consumer_ref": cref, "consumer_id": c["consumer_id"],
                      "service": "Water", "connection_number": f"WN-{c['consumer_id']}",
                      "connection_number_norm": f"wn-{c['consumer_id']}", "is_active": True,
                      "linked_property_id": pid, "created_at": ts, "updated_at": ts}},
            upsert=True)
        if c.get("office"):
            await db.phed_surveys.update_one(
                {"property_record_id": pid, "source": "office_document"},
                {"$set": {"id": str(uuid.uuid4()), "property_record_id": pid, "property_id": pnum,
                          "survey_type": "EXISTING_LINKED", "source": "office_document",
                          "consumer_ref": cref, "consumer_refs": [cref], "status": "Submitted",
                          "water": {"consumer_ref": cref, "consumer_name": c["consumer_name"], "mobile": c["phone"]},
                          "surveyor_id": "seed", "surveyor_name": "Seed", "attachments": [],
                          "started_at": ts, "submitted_at": ts, "created_at": ts, "updated_at": ts}},
                upsert=True)
            await db.properties.update_one({"id": pid}, {"$set": {
                "phed_survey_status": "Submitted", "phed_survey_state": "Submitted",
                "phed_survey_type": "EXISTING_LINKED", "phed_surveyed_at": ts,
                "phed_surveyor_id": "seed", "phed_surveyor_name": "Seed"}})
    print("Seeded 3 properties, 3 wrongly-linked consumers (1 with blocking office survey)")


if __name__ == "__main__":
    asyncio.run(main())
