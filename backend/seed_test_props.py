"""Seed demo MC properties assigned to surveyor1 for testing the map + survey flow.
Idempotent by property_id. Run: python seed_test_props.py"""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
MASTER_DB_NAME = os.environ.get("MASTER_DB_NAME", DB_NAME)
BASE_LAT, BASE_LNG = 29.96950, 76.87830


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    master = client[MASTER_DB_NAME]
    surveyor = await master.users.find_one({"username": "surveyor1"})
    if not surveyor:
        print("ERROR: surveyor1 not found")
        return
    sid, sname = surveyor["id"], surveyor.get("name", "surveyor1")
    now = datetime.now(timezone.utc).isoformat()
    created = 0
    for i in range(6):
        pid = f"DEMO-W1-{i+1:03d}"
        lat = round(BASE_LAT + (i % 3) * 0.0009 + (0.00035 if i >= 3 else 0), 6)
        lng = round(BASE_LNG + (i % 3) * 0.0011 + (0.00045 if i >= 3 else 0), 6)
        doc = {
            "id": str(uuid.uuid4()), "property_id": pid, "serial_number": i + 1,
            "owner_name": f"Demo Owner {i+1}", "mobile": f"90000000{i:02d}",
            "address": "Ward 1, Thanesar", "colony": "Masita House", "ward": "Ward 1",
            "latitude": lat, "longitude": lng, "status": "Pending", "category": "Residential",
            "assigned_employee_id": sid, "assigned_employee_ids": [sid], "assigned_employee_name": sname,
            "is_demo": True, "created_at": now, "updated_at": now,
        }
        res = await db.properties.update_one({"property_id": pid}, {"$set": doc}, upsert=True)
        if res.upserted_id:
            created += 1
    total = await db.properties.count_documents({})
    print(f"DONE. new={created}, total_properties={total}")


if __name__ == "__main__":
    asyncio.run(main())
