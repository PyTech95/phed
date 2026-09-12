#!/usr/bin/env python3
"""
Idempotent MongoDB backup / restore for the PHED app (no mongodump dependency).

Usage:
  python backup_restore.py dump    [--out backups/2026-09-06]   # writes one .json file per collection
  python backup_restore.py restore --src backups/2026-09-06 [--drop]
  python backup_restore.py verify  --src backups/2026-09-06     # compares document counts

Reads MONGO_URL, DB_NAME (and MASTER_DB_NAME / TOWN_DB_MODE) from the environment or backend/.env.
GridFS buckets are plain collections (*.files / *.chunks) so they are included automatically.
Restore uses upsert on _id, so re-running it never duplicates data.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from bson import json_util
from dotenv import load_dotenv
from pymongo import MongoClient, ReplaceOne

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")


def db_names(client):
    names = {os.environ["DB_NAME"]}
    if os.environ.get("MASTER_DB_NAME"):
        names.add(os.environ["MASTER_DB_NAME"])
    if os.environ.get("TOWN_DB_MODE", "single").lower() == "multi":
        prefix = os.environ["DB_NAME"]
        names.update(n for n in client.list_database_names() if n.startswith(prefix + "_"))
    return sorted(names)


def dump(client, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "databases": {}}
    for db_name in db_names(client):
        db = client[db_name]
        (out / db_name).mkdir(exist_ok=True)
        manifest["databases"][db_name] = {}
        for coll in db.list_collection_names():
            docs = list(db[coll].find())
            path = out / db_name / f"{coll}.json"
            path.write_text(json_util.dumps(docs))
            manifest["databases"][db_name][coll] = len(docs)
            print(f"  {db_name}.{coll}: {len(docs)} docs -> {path}")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Backup complete: {out}")


def restore(client, src: Path, drop: bool):
    manifest = json.loads((src / "manifest.json").read_text())
    for db_name, colls in manifest["databases"].items():
        db = client[db_name]
        for coll in colls:
            docs = json_util.loads((src / db_name / f"{coll}.json").read_text())
            if drop:
                db[coll].drop()
            if not docs:
                continue
            ops = [ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in docs]
            res = db[coll].bulk_write(ops, ordered=False)
            print(f"  {db_name}.{coll}: upserted={res.upserted_count} modified={res.modified_count} (of {len(docs)})")
    print("Restore complete. Restart the backend so indexes are (re)created on startup.")


def verify(client, src: Path) -> int:
    manifest = json.loads((src / "manifest.json").read_text())
    bad = 0
    for db_name, colls in manifest["databases"].items():
        for coll, expected in colls.items():
            actual = client[db_name][coll].count_documents({})
            flag = "OK " if actual >= expected else "MISMATCH"
            if actual < expected:
                bad += 1
            print(f"  [{flag}] {db_name}.{coll}: backup={expected} live={actual}")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["dump", "restore", "verify"])
    ap.add_argument("--out", default=None)
    ap.add_argument("--src", default=None)
    ap.add_argument("--drop", action="store_true", help="drop each collection before restoring")
    args = ap.parse_args()

    client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=10000)
    client.admin.command("ping")

    if args.action == "dump":
        out = Path(args.out or ROOT / "backups" / datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S"))
        dump(client, out)
    elif args.action == "restore":
        if not args.src:
            sys.exit("--src is required")
        restore(client, Path(args.src), args.drop)
    else:
        if not args.src:
            sys.exit("--src is required")
        sys.exit(1 if verify(client, Path(args.src)) else 0)


if __name__ == "__main__":
    main()
