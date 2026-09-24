"""One-off verification seed for THIS Emergent deployment (uses env DB names).
Seeds: 1 ward (with colonies), a few properties in 3 statuses assigned to surveyor1,
and a consumer+connection so the office Excel import has something to match.
Idempotent by property_id / ward_number / consumer_id. Run: python seed_verify_data.py
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
MASTER_DB_NAME = os.environ.get("MASTER_DB_NAME", DB_NAME)

BASE_LAT, BASE_LNG = 29.96950, 76.87830
COLONIES = ["Didar Nagar", "Masita House", "Sector 5"]


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    master = client[MASTER_DB_NAME]
    now = datetime.now(timezone.utc).isoformat()

    surveyor = await master.users.find_one({"username": "surveyor1"}) or await db.users.find_one({"username": "surveyor1"})
    if not surveyor:
        print("ERROR: surveyor1 not found; create it first")
        return
    sid, sname = surveyor["id"], surveyor.get("name", "surveyor1")

    # Ward 1 with colonies
    await db.phed_wards.update_one(
        {"ward_number": "1"},
        {"$set": {"ward_number": "1", "name": "Ward 1", "town": "Thanesar", "is_active": True,
                  "colonies": COLONIES, "updated_at": now},
         "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}},
        upsert=True)

    # Properties in 3 statuses to show red/yellow/green on the map
    statuses = ["Pending", "Submitted", "Approved"]
    for i in range(3):
        pid = f"THS-{i+1:04d}"
        lat = round(BASE_LAT + i * 0.0009, 6)
        lng = round(BASE_LNG + i * 0.0011, 6)
        doc = {
            "id": str(uuid.uuid4()), "property_id": pid, "serial_number": i + 1,
            "owner_name": f"Verify Owner {i+1}", "mobile": f"90000000{i+1:02d}",
            "address": f"{COLONIES[i]}, Thanesar", "colony": COLONIES[i], "ward": "Ward 1",
            "latitude": lat, "longitude": lng, "status": statuses[i], "category": "Domestic",
            "assigned_employee_id": sid, "assigned_employee_ids": [sid], "assigned_employee_name": sname,
            "phed_survey_status": {"Pending": "Pending", "Submitted": "Submitted", "Approved": "Approved"}[statuses[i]],
            "is_demo": True, "created_at": now, "updated_at": now,
        }
        await db.properties.update_one({"property_id": pid}, {"$set": doc}, upsert=True)

    # A consumer + water connection so office Excel import (by Consumer ID / PID) can match
    cid = "4326479"
    consumer = await db.phed_consumers.find_one({"consumer_id_norm": cid.lower()})
    if not consumer:
        cref = str(uuid.uuid4())
        await db.phed_consumers.insert_one({
            "id": cref, "consumer_id": cid, "consumer_id_norm": cid.lower(),
            "consumer_name": "Suman Devi", "fh_name": "Ram Kumar", "phone": "7206864297",
            "address": "Didar Nagar", "locality": "Didar Nagar", "colony_name": "Didar Nagar",
            "ward_number": "1", "category": "Domestic", "status": "Active", "source": "seed",
            "is_active": True, "linked_property_id": None, "created_at": now, "updated_at": now,
        })
        await db.phed_connections.insert_one({
            "id": str(uuid.uuid4()), "consumer_ref": cref, "consumer_id": cid,
            "connection_number": "101", "connection_number_norm": "101", "service": "Water",
            "category": "Domestic", "source": "seed", "status": "Active", "is_active": True,
            "verification_status": "Unverified", "created_at": now, "updated_at": now,
        })

    print("Properties:", await db.properties.count_documents({}))
    print("Wards:", await db.phed_wards.count_documents({}))
    print("Consumers:", await db.phed_consumers.count_documents({}))


if __name__ == "__main__":
    asyncio.run(main())
