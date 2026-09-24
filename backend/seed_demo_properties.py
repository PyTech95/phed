"""Seed a few DEMO MC properties in Ward 1 (THS/test_database) assigned to surveyor1.
These carry is_demo=True so they can be safely deleted later. Idempotent by property_id.
Run: python seed_demo_properties.py
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
SURVEYOR_USERNAME = "surveyor1"

# Thanesar / Kurukshetra approx centre
BASE_LAT = 29.96950
BASE_LNG = 76.87830


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client["test_database"]
    master = client[os.environ.get("MASTER_DB_NAME", "phed_master")]

    surveyor = await master.users.find_one({"username": SURVEYOR_USERNAME})
    if not surveyor:
        print(f"ERROR: surveyor '{SURVEYOR_USERNAME}' not found")
        return
    sid = surveyor["id"]
    sname = surveyor.get("name", SURVEYOR_USERNAME)

    # Pull a few real consumers to base demo properties on (so linking works)
    consumers = await db.phed_consumers.find({"ward_number": "1"}, {"_id": 0}).limit(8).to_list(8)

    now = datetime.now(timezone.utc).isoformat()
    created = 0
    for i, c in enumerate(consumers):
        pid = f"DEMO-W1-{i+1:03d}"
        existing = await db.properties.find_one({"property_id": pid})
        lat = BASE_LAT + (i % 4) * 0.0009 + (0.00035 if i >= 4 else 0)
        lng = BASE_LNG + (i % 4) * 0.0011 + (0.00045 if i >= 4 else 0)
        doc = {
            "id": str(uuid.uuid4()),
            "property_id": pid,
            "serial_number": i + 1,
            "bill_sr_no": pid,
            "owner_name": c.get("consumer_name", f"Demo Owner {i+1}"),
            "mobile": c.get("phone", ""),
            "address": c.get("address", "Ward 1, Thanesar"),
            "colony": c.get("colony_name", "Masita House"),
            "ward": "Ward 1",
            "latitude": round(lat, 6),
            "longitude": round(lng, 6),
            "status": "Pending",
            "category": c.get("category", "Domestic"),
            "assigned_employee_id": sid,
            "assigned_employee_ids": [sid],
            "assigned_employee_name": sname,
            "is_demo": True,
            "created_at": now,
            "updated_at": now,
        }
        if existing:
            await db.properties.update_one({"property_id": pid}, {"$set": doc})
            print(f"updated {pid} ({doc['owner_name']})")
        else:
            await db.properties.insert_one(doc)
            created += 1
            print(f"created {pid} ({doc['owner_name']}) @ {lat:.5f},{lng:.5f}")

    total = await db.properties.count_documents({})
    demo = await db.properties.count_documents({"is_demo": True})
    print(f"\nDONE. new={created}, total_properties={total}, demo_properties={demo}")


if __name__ == "__main__":
    asyncio.run(main())
