#!/usr/bin/env python3
"""
Standalone Live DB Cleaner for PHED / NSTU Property Tax System
=============================================================
Use this script to clean up wrongly-attached PHED consumers from MC properties
and immediately unblock properties so field staff can resume surveys.

Works with both local MongoDB and remote MongoDB (Atlas / VPS).

Usage:
  1. Inspect only (SAFE, no changes):
       python cleanup_live_wrong_links.py --inspect

  2. Unlink all wrong attachments & unblock properties (leaves consumer data intact):
       python cleanup_live_wrong_links.py --unlink-all --confirm

  3. Unlink ONLY office-receipt auto-attachments:
       python cleanup_live_wrong_links.py --unlink-source office --confirm

  4. Delete consumers + unblock properties permanently:
       python cleanup_live_wrong_links.py --delete-all-linked-consumers --confirm

  5. Delete an entire import batch by filename (legacy batches included):
       python cleanup_live_wrong_links.py --delete-batch "wrong_file.xlsx" --confirm

  6. Target a specific database / Mongo URI:
       MONGO_URL="mongodb://localhost:27017" DB_NAME="nstu_town_THS" python cleanup_live_wrong_links.py --inspect
"""

import argparse
import os
import sys
from datetime import datetime, timezone
from pymongo import MongoClient


def get_db():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "phed_preview")
    client = MongoClient(mongo_url)
    return client, client[db_name]


def inspect_db(db):
    print("=" * 60)
    print(f"DATABASE INSPECTION: {db.name}")
    print("=" * 60)
    
    total_props = db.properties.count_documents({})
    total_consumers = db.phed_consumers.count_documents({})
    linked_consumers = db.phed_consumers.count_documents({"linked_property_id": {"$ne": None}})
    office_links = db.phed_consumers.count_documents({"office_document_receipt": {"$ne": None}})
    import_links = db.phed_consumers.count_documents({"office_document_receipt": None, "import_id": {"$ne": None}, "linked_property_id": {"$ne": None}})
    manual_links = db.phed_consumers.count_documents({"office_document_receipt": None, "import_id": None, "linked_property_id": {"$ne": None}})
    
    blocked_props = db.properties.count_documents({"phed_survey_status": {"$in": ["Submitted", "Draft", "Requires Review", "Approved"]}})
    auto_office_surveys = db.phed_surveys.count_documents({"survey_type": "EXISTING_LINKED", "source": "office_document"})
    total_surveys = db.phed_surveys.count_documents({})

    print(f"Total MC Properties:             {total_props}")
    print(f"Properties with PHED survey:     {blocked_props}")
    print(f"Total PHED Consumers:            {total_consumers}")
    print(f"Consumers linked to properties:  {linked_consumers}")
    print(f"  ├─ Via Office Receipt:         {office_links}")
    print(f"  ├─ Via Excel Import:           {import_links}")
    print(f"  └─ Via Manual / Bulk:          {manual_links}")
    print(f"Total PHED Surveys:              {total_surveys}")
    print(f"  └─ Auto Office Surveys:        {auto_office_surveys}")
    print("=" * 60)

    if linked_consumers > 0:
        print("\nSample Linked Consumers (first 5):")
        for c in db.phed_consumers.find({"linked_property_id": {"$ne": None}}).limit(5):
            print(f"  - Consumer ID: {c.get('consumer_id')} | Name: {c.get('consumer_name')} | Mobile: {c.get('phone')} | Linked Property: {c.get('linked_property_number')}")
    print()


def unlink_all(db, source_filter=None, delete_consumers=False):
    q = {"linked_property_id": {"$ne": None}}
    if source_filter == "office":
        q["office_document_receipt"] = {"$ne": None}
    elif source_filter == "import":
        q["office_document_receipt"] = None
        q["import_id"] = {"$ne": None}
    elif source_filter == "manual":
        q["office_document_receipt"] = None
        q["import_id"] = None

    consumers = list(db.phed_consumers.find(q, {"id": 1, "linked_property_id": 1, "office_document_receipt": 1}))
    if not consumers:
        print("Koi linked consumers nahi mile — database already clean hai.")
        return

    ts = datetime.now(timezone.utc).isoformat()
    affected_prop_ids = set()
    consumer_refs = [c["id"] for c in consumers]

    for c in consumers:
        pid = c.get("linked_property_id")
        if pid:
            affected_prop_ids.add(pid)
        upd = {"linked_property_id": None, "linked_property_number": None, "updated_at": ts}
        if c.get("office_document_receipt"):
            upd["office_document_receipt"] = None
            upd["status"] = "Not Started"
        db.phed_consumers.update_one({"id": c["id"]}, {"$set": upd})
        db.phed_connections.update_many({"consumer_ref": c["id"]}, {"$set": {"linked_property_id": None, "updated_at": ts}})

    # Remove blocking auto-created office surveys
    surveys_del = 0
    if affected_prop_ids:
        res = db.phed_surveys.delete_many({
            "property_record_id": {"$in": list(affected_prop_ids)},
            "survey_type": "EXISTING_LINKED",
            "source": "office_document",
            "status": {"$ne": "Approved"}
        })
        surveys_del = res.deleted_count

    # Unblock properties
    unblocked = 0
    for pid in affected_prop_ids:
        remaining = db.phed_surveys.find_one({"property_record_id": pid}, sort=[("updated_at", -1)])
        if remaining:
            db.properties.update_one({"id": pid}, {"$set": {
                "phed_survey_status": remaining.get("status"),
                "phed_survey_state": remaining.get("status"),
                "phed_survey_type": remaining.get("survey_type"),
                "phed_surveyed_at": remaining.get("submitted_at"),
            }})
        else:
            db.properties.update_one({"id": pid}, {"$unset": {
                "phed_survey_status": "", "phed_survey_state": "", "phed_survey_type": "",
                "phed_surveyed_at": "", "phed_outcome": "", "phed_surveyor_id": "", "phed_surveyor_name": ""
            }})
        unblocked += 1

    del_cons_cnt = 0
    if delete_consumers:
        db.phed_connections.delete_many({"consumer_ref": {"$in": consumer_refs}})
        del_cons_cnt = db.phed_consumers.delete_many({"id": {"$in": consumer_refs}}).deleted_count

    print("=" * 60)
    print("CLEANUP SUCCESSFUL!")
    print(f"  ✓ Links Removed:             {len(consumers)}")
    print(f"  ✓ Office Surveys Removed:    {surveys_del}")
    print(f"  ✓ Properties Unblocked:      {unblocked}")
    if delete_consumers:
        print(f"  ✓ Consumers Deleted:         {del_cons_cnt}")
    print("=" * 60)
    print("Ab aapke field staff / bache bina kisi rukawat ke survey start kar sakte hain!")


def delete_batch(db, filename):
    """Delete an entire import batch by filename — works for legacy batches too.
    Office batch: removes its surveys, unlinks consumers it attached, unblocks properties.
    Consumer batch: removes the consumers + connections it created, unblocks properties."""
    batch = db.phed_office_imports.find_one({"filename": filename})
    kind, collection = ("office", "phed_office_imports") if batch else (None, None)
    if not batch:
        batch = db.phed_imports.find_one({"filename": filename})
        kind, collection = ("consumer", "phed_imports") if batch else (None, None)
    if not batch:
        print(f"Batch '{filename}' nahi mila. Recent batches:")
        for b in list(db.phed_office_imports.find({}, {"filename": 1, "_id": 0}).sort("created_at", -1).limit(10)):
            print(f"  - [office] {b.get('filename')}")
        for b in list(db.phed_imports.find({}, {"filename": 1, "_id": 0}).sort("created_at", -1).limit(10)):
            print(f"  - [consumer] {b.get('filename')}")
        return
    if batch.get("status") == "Deleted":
        print("Ye batch already deleted hai.")
        return

    bid = batch["id"]
    ts = datetime.now(timezone.utc).isoformat()
    affected_props = set()
    deleted = 0
    unlinked = 0

    if kind == "office":
        surveys = list(db.phed_surveys.find({"office_batch_id": bid},
                                            {"_id": 0, "property_record_id": 1, "consumer_ref": 1, "consumer_refs": 1}))
        for s in surveys:
            if s.get("property_record_id"):
                affected_props.add(s["property_record_id"])
        deleted = db.phed_surveys.delete_many({"office_batch_id": bid}).deleted_count
        consumer_refs = set()
        for s in surveys:
            if s.get("consumer_ref"):
                consumer_refs.add(s["consumer_ref"])
            consumer_refs.update(s.get("consumer_refs") or [])
        for cref in consumer_refs:
            c = db.phed_consumers.find_one({"id": cref}, {"_id": 0, "linked_property_id": 1})
            if c and c.get("linked_property_id") in affected_props:
                db.phed_consumers.update_one({"id": cref}, {"$set": {
                    "linked_property_id": None, "linked_property_number": None,
                    "office_document_receipt": None, "status": "Not Started", "updated_at": ts}})
                db.phed_connections.update_many({"consumer_ref": cref},
                                                {"$set": {"linked_property_id": None, "updated_at": ts}})
                unlinked += 1
    else:
        cons = list(db.phed_consumers.find({"import_id": bid}, {"_id": 0, "id": 1, "linked_property_id": 1}))
        affected_props = {c["linked_property_id"] for c in cons if c.get("linked_property_id")}
        db.phed_connections.delete_many({"import_id": bid})
        deleted = db.phed_consumers.delete_many({"import_id": bid}).deleted_count

    unblocked = 0
    for pid in affected_props:
        remaining = db.phed_surveys.find_one({"property_record_id": pid}, sort=[("updated_at", -1)])
        if remaining:
            db.properties.update_one({"id": pid}, {"$set": {
                "phed_survey_status": remaining.get("status"), "phed_survey_state": remaining.get("status"),
                "phed_survey_type": remaining.get("survey_type"), "phed_surveyed_at": remaining.get("submitted_at")}})
        else:
            db.properties.update_one({"id": pid}, {
                "$set": {"phed_survey_status": "Not Started", "phed_survey_state": "Not Started"},
                "$unset": {"phed_outcome": "", "phed_survey_source": "", "phed_surveyed_at": "",
                           "phed_survey_type": "", "phed_surveyor_id": "", "phed_surveyor_name": ""}})
        unblocked += 1

    db[collection].update_one({"id": bid}, {"$set": {"status": "Deleted", "deleted_at": ts}})
    print("=" * 60)
    print(f"BATCH '{filename}' DELETED ({kind})!")
    print(f"  ✓ Records Removed:    {deleted}")
    print(f"  ✓ Consumers Unlinked: {unlinked}")
    print(f"  ✓ Properties Reset:   {unblocked}")
    print("=" * 60)
    print("Ab field staff in properties par survey start kar sakta hai!")


def main():
    parser = argparse.ArgumentParser(description="Clean wrongly linked PHED data and unblock properties")
    parser.add_argument("--inspect", action="store_true", help="Inspect database counts without making any changes")
    parser.add_argument("--unlink-all", action="store_true", help="Remove all consumer-property attachments & unblock properties")
    parser.add_argument("--unlink-source", choices=["office", "import", "manual"], help="Unlink only from a specific source")
    parser.add_argument("--delete-all-linked-consumers", action="store_true", help="Unlink AND permanently delete the consumers")
    parser.add_argument("--delete-batch", metavar="FILENAME", help="Delete an entire import batch by its filename (legacy batches included)")
    parser.add_argument("--confirm", action="store_true", help="Confirm the action")

    args = parser.parse_args()

    client, db = get_db()

    if args.inspect or (not args.unlink_all and not args.unlink_source and not args.delete_all_linked_consumers and not args.delete_batch):
        inspect_db(db)
        return

    if not args.confirm:
        print("Error: Please add --confirm to execute changes.")
        sys.exit(1)

    if args.delete_batch:
        delete_batch(db, args.delete_batch)
    elif args.unlink_all:
        unlink_all(db)
    elif args.unlink_source:
        unlink_all(db, source_filter=args.unlink_source)
    elif args.delete_all_linked_consumers:
        unlink_all(db, delete_consumers=True)


if __name__ == "__main__":
    main()
