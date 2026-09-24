"""Seed map-color test data for surveyor 'survdash': 3 assigned properties in
Not Started (red) / Submitted (yellow) / Approved (green) states with coordinates,
plus matching phed_surveys so the dashboard today/total/connection breakdown is non-zero.
Idempotent: clears prior SEEDMAP-* docs first."""
import os, uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]

SURVEYOR_ID = "b07c29b3-4744-407f-b8af-9471bc383c28"
SURVEYOR_NAME = "Dash Surveyor"
TOWN_ID = "b63f7421-0b40-45ff-b98e-baa41b93b498"
now = datetime.now(timezone.utc).isoformat()

# clear previous
db.properties.delete_many({"property_id": {"$regex": "^SEEDMAP-"}})
db.phed_surveys.delete_many({"property_id": {"$regex": "^SEEDMAP-"}})

def prop(n, state, outcome=None, status="Pending"):
    return {
        "id": str(uuid.uuid4()),
        "property_id": f"SEEDMAP-{n}",
        "serial_number": n,
        "owner_name": f"Seed Owner {n}",
        "colony": "Seed Colony",
        "ward": "Seed Colony",
        "address": f"Seed Colony House {n}",
        "mobile": "9811111111",
        "latitude": 29.9695 + n * 0.001,
        "longitude": 76.8783 + n * 0.001,
        "status": status,
        "assigned_employee_id": SURVEYOR_ID,
        "assigned_employee_ids": [SURVEYOR_ID],
        "assigned_employee_name": SURVEYOR_NAME,
        "assigned_town": TOWN_ID,
        "source": "import",
        "created_at": now,
        **({"phed_survey_state": state, "phed_survey_status": state} if state else {}),
        **({"phed_outcome": outcome} if outcome else {}),
    }

def survey(prop_doc, water, status):
    return {
        "id": str(uuid.uuid4()),
        "property_record_id": prop_doc["id"],
        "property_id": prop_doc["property_id"],
        "surveyor_id": SURVEYOR_ID,
        "surveyor_name": SURVEYOR_NAME,
        "water": water,
        "survey_type": "WATER_CONNECTION",
        "status": status,
        "attachments": [],
        "started_at": now,
        "submitted_at": now,
        "updated_at": now,
        "created_at": now,
    }

p1 = prop(1, None, status="Pending")                                    # red  (not started)
p2 = prop(2, "Submitted", status="Submitted")                           # yellow
p3 = prop(3, "Approved", outcome="HAS_CONNECTION", status="Approved")   # green
db.properties.insert_many([p1, p2, p3])
db.phed_surveys.insert_many([
    survey(p2, {"connection_numbers": ["W-1001"], "sewer_connection_numbers": []}, "Submitted"),
    survey(p3, {"connection_numbers": ["W-2001"], "sewer_connection_numbers": ["S-2001"]}, "Approved"),
])
print("seeded 3 properties + 2 surveys for", SURVEYOR_ID)
print("counts:", db.properties.count_documents({"property_id": {"$regex": "^SEEDMAP-"}}))
