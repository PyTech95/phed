"""Reversible, provenance-based imports. Never infer identity from names/phones."""
from datetime import datetime, timezone
import uuid

from fastapi import HTTPException


def explicit_id(value):
    text = str(value or "").strip()
    return text if text.upper().replace(" ", "") not in {
        "", "-", "--", "NA", "N/A", "NONE", "NULL", "NAN", "0", "NOTAVAILABLE",
    } else ""


async def import_write(db, batch_id, collection, doc_id, fields):
    """Journal before writing. One before-image per document, even for duplicate rows."""
    before = await db[collection].find_one({"id": doc_id}, {"_id": 0})
    after = {**(before or {}), **fields, "id": doc_id}
    key = {"batch_id": batch_id, "collection": collection, "document_id": doc_id}
    await db.phed_import_changes.update_one(key, {
        "$setOnInsert": {"id": str(uuid.uuid4()), "before": before},
        "$set": {"after": after},
    }, upsert=True)
    if before is None:
        await db[collection].insert_one(dict(after))
    else:
        await db[collection].update_one({"id": doc_id}, {"$set": fields})


async def batch_document(db, kind, batch_id):
    collection = {"consumer": "phed_imports", "office": "phed_office_imports"}.get(kind)
    if not collection:
        raise HTTPException(404, "Import type not found")
    batch = await db[collection].find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Import not found")
    if batch.get("status") in ("Processing", "Deleting"):
        raise HTTPException(409, "Import is busy; wait for it to finish")
    return collection, batch


async def legacy_changes(db, kind, batch, force=False):
    """Old imports lack before-images: delete only provably import-created records.
    force=True: also delete import-created records that were edited later (best-effort,
    no restore possible for those)."""
    changes, warnings = [], []
    if kind == "consumer":
        docs = await db.phed_consumers.find({"import_id": batch["id"]}, {"_id": 0}).to_list(None)
        for doc in docs:
            # A prior master record must never be deleted just because an import updated it.
            if not doc.get("created_at") or doc.get("created_at") != doc.get("updated_at"):
                if force:
                    changes.append({"collection": "phed_consumers", "document_id": doc["id"], "before": None, "after": doc})
                else:
                    warnings.append(f"Consumer {doc.get('consumer_id')}: older/edited record has no restore snapshot")
                continue
            changes.append({"collection": "phed_consumers", "document_id": doc["id"], "before": None, "after": doc})
        conns = await db.phed_connections.find({"import_id": batch["id"]}, {"_id": 0}).to_list(None)
        changes.extend({"collection": "phed_connections", "document_id": d["id"], "before": None, "after": d} for d in conns)
    else:
        docs = await db.phed_surveys.find({"office_batch_id": batch["id"]}, {"_id": 0}).to_list(None)
        for doc in docs:
            if not doc.get("created_at") or doc.get("created_at") != doc.get("submitted_at") or doc.get("updated_at") != doc.get("submitted_at"):
                if force:
                    changes.append({"collection": "phed_surveys", "document_id": doc["id"], "before": None, "after": doc})
                else:
                    warnings.append(f"Survey {doc.get('property_id')}: older/edited survey has no restore snapshot")
                continue
            changes.append({"collection": "phed_surveys", "document_id": doc["id"], "before": None, "after": doc})
        # Exact consumer links made by an old office import cannot be distinguished
        # from pre-existing links. Preserve master data instead of guessing.
        warnings.append("Legacy batch: original consumer/property links cannot be restored automatically; master records and links are preserved.")
    return changes, warnings


async def _live_map(db, collection, ids):
    """Bulk-load current documents by id into {id: doc}. Chunked to bound $in size.
    O(1) queries per ~1000 ids instead of one find_one per record — keeps deletion
    preview/undo fast on large imports (tens of thousands of rows)."""
    out = {}
    ids = list(ids)
    for i in range(0, len(ids), 1000):
        async for d in db[collection].find({"id": {"$in": ids[i:i + 1000]}}, {"_id": 0}):
            out[d["id"]] = d
    return out


async def deletion_plan(db, kind, batch, force=False):
    changes = await db.phed_import_changes.find({"batch_id": batch["id"], "undone": {"$ne": True}}, {"_id": 0}).to_list(None)
    warnings = []
    if not batch.get("rollback_version"):
        changes, warnings = await legacy_changes(db, kind, batch, force=force)
    blocked = []
    affected_survey_ids = [c["document_id"] for c in changes if c["collection"] == "phed_surveys"]
    connection_ids = [c["document_id"] for c in changes if c["collection"] == "phed_connections" and c["before"] is None]

    # Bulk-load live docs per collection (replaces one find_one per change).
    ids_by_collection = {}
    for c in changes:
        ids_by_collection.setdefault(c["collection"], set()).add(c["document_id"])
    live_maps = {coll: await _live_map(db, coll, ids) for coll, ids in ids_by_collection.items()}

    # Bulk-compute the "protected by later work" sets in a few queries instead of
    # one count_documents per consumer/property.
    consumer_ids = [c["document_id"] for c in changes if c["collection"] == "phed_consumers"]
    new_consumer_ids = [c["document_id"] for c in changes if c["collection"] == "phed_consumers" and c["before"] is None]
    prop_ids = [c["document_id"] for c in changes if c["collection"] == "properties"]
    used_consumers, extra_conn_consumers, props_with_other_survey = set(), set(), set()
    if consumer_ids:
        async for s in db.phed_surveys.find(
            {"id": {"$nin": affected_survey_ids}, "$or": [{"consumer_ref": {"$in": consumer_ids}}, {"consumer_refs": {"$in": consumer_ids}}]},
            {"_id": 0, "consumer_ref": 1, "consumer_refs": 1},
        ):
            if s.get("consumer_ref"):
                used_consumers.add(s["consumer_ref"])
            used_consumers.update(s.get("consumer_refs") or [])
    if new_consumer_ids:
        async for cn in db.phed_connections.find(
            {"consumer_ref": {"$in": new_consumer_ids}, "id": {"$nin": connection_ids}}, {"_id": 0, "consumer_ref": 1},
        ):
            extra_conn_consumers.add(cn["consumer_ref"])
    if prop_ids:
        async for s in db.phed_surveys.find(
            {"property_record_id": {"$in": prop_ids}, "id": {"$nin": affected_survey_ids}}, {"_id": 0, "property_record_id": 1},
        ):
            props_with_other_survey.add(s["property_record_id"])

    for change in changes:
        collection, doc_id = change["collection"], change["document_id"]
        live = live_maps.get(collection, {}).get(doc_id)
        if live != change["after"] and live != change["before"]:
            blocked.append(f"{collection}: {doc_id} changed after this import")
        if collection == "phed_consumers":
            if doc_id in used_consumers or (change["before"] is None and doc_id in extra_conn_consumers) or (change["before"] is None and (live or {}).get("office_document_receipt")):
                blocked.append(f"Consumer {doc_id} is used by a survey or another import")
        if collection == "phed_connections" and change["before"] is None and (live or {}).get("verified_at"):
            blocked.append(f"Connection {doc_id} has been verified in a survey")
        if collection == "properties" and doc_id in props_with_other_survey:
            blocked.append(f"Property {doc_id} has another survey; preserve its current status")
    # Legacy records which cannot be identified safely must not produce a false 'deleted'.
    if not force:
        blocked.extend(w for w in warnings if "no restore snapshot" in w)
    return changes, warnings, blocked


async def prepare_undo(db, kind, batch_id, confirmation, force=False):
    """Synchronous, fast-failing part: validate, block-check, and claim the batch.
    Returns (collection, batch, changes, warnings) or (collection, batch, None, None)
    if the batch was already deleted."""
    collection, batch = await batch_document(db, kind, batch_id)
    if confirmation != batch.get("filename"):
        raise HTTPException(400, "Type the exact filename to confirm deletion")
    if batch.get("status") == "Deleted":
        return collection, batch, None, None
    changes, warnings, blocked = await deletion_plan(db, kind, batch, force=force)
    if blocked:
        raise HTTPException(409, {"message": "Deletion blocked to protect later work", "blocked": blocked[:20]})
    claim = await db[collection].update_one(
        {"id": batch_id, "status": batch.get("status")},
        {"$set": {"status": "Deleting", "deletion_progress": {"done": 0, "total": len(changes)}}},
    )
    if not claim.modified_count:
        raise HTTPException(409, "Import changed; refresh the preview")
    return collection, batch, changes, warnings


async def execute_undo(db, kind, collection, batch, changes, warnings, actor):
    """Long-running write phase. Safe to run in the background; reports progress on
    the batch doc so the UI can show a progress bar. Journal makes it idempotent."""
    batch_id = batch["id"]
    total = len(changes)
    deleted = restored = 0
    try:
        # Prefetch current docs in bulk (one query per ~1000 ids) so the loop below
        # doesn't do a find_one per record — critical for large imports.
        undo_ids = {}
        for c in changes:
            undo_ids.setdefault(c["collection"], set()).add(c["document_id"])
        undo_live = {coll: await _live_map(db, coll, ids) for coll, ids in undo_ids.items()}
        undone_change_ids = []
        # Restore links before removing imported entities; journal makes retries idempotent.
        for processed, change in enumerate(reversed(changes), start=1):
            target = db[change["collection"]]
            live = undo_live.get(change["collection"], {}).get(change["document_id"])
            if live != change["before"]:
                if live != change["after"]:
                    raise HTTPException(409, "A record changed during deletion; later work was preserved")
                # Compare the entire current document (except Mongo's internal _id) atomically.
                cas = {"id": change["document_id"], "$expr": {"$setEquals": [
                    {"$filter": {"input": {"$objectToArray": "$$ROOT"}, "as": "f", "cond": {"$ne": ["$$f.k", "_id"]}}},
                    {"$objectToArray": {"$literal": change["after"]}},
                ]}}
                if change["before"] is None:
                    result = await target.delete_one(cas)
                    count = result.deleted_count
                    deleted += count
                else:
                    result = await target.replace_one(cas, dict(change["before"]))
                    count = result.matched_count
                    restored += count
                if not count:
                    raise HTTPException(409, "Record changed during deletion; refresh and retry")
            if change.get("id"):
                undone_change_ids.append(change["id"])
            # Report progress periodically so the UI's polling can render a bar.
            if processed % 500 == 0 or processed == total:
                await db[collection].update_one({"id": batch_id}, {"$set": {"deletion_progress": {"done": processed, "total": total}}})
        # Flag journal rows undone in bulk instead of one update per record.
        for i in range(0, len(undone_change_ids), 1000):
            await db.phed_import_changes.update_many({"id": {"$in": undone_change_ids[i:i + 1000]}}, {"$set": {"undone": True}})
        if kind == "office" and not batch.get("rollback_version"):
            for change in changes:
                if change["collection"] != "phed_surveys":
                    continue
                prop_id = change["after"].get("property_record_id")
                if not prop_id:
                    continue
                remaining = await db.phed_surveys.find_one({"property_record_id": prop_id}, {"_id": 0}, sort=[("updated_at", -1)])
                if remaining:
                    # Another survey still exists on this property: sync its state.
                    await db.properties.update_one({"id": prop_id}, {"$set": {
                        "phed_survey_status": remaining.get("status"), "phed_survey_state": remaining.get("status"),
                        "phed_survey_type": remaining.get("survey_type"), "phed_surveyed_at": remaining.get("submitted_at")}})
                else:
                    # No survey left: property goes back to untouched so field work can restart.
                    await db.properties.update_one({"id": prop_id}, {
                        "$set": {"phed_survey_status": "Not Started", "phed_survey_state": "Not Started"},
                        "$unset": {"phed_outcome": "", "phed_survey_source": "", "phed_surveyed_at": "",
                                   "phed_survey_type": "", "phed_surveyor_id": "", "phed_surveyor_name": ""}})
        ts = datetime.now(timezone.utc).isoformat()
        result = {"status": "Deleted", "deleted": deleted, "restored": restored, "warnings": warnings}
        await db[collection].update_one({"id": batch_id}, {"$set": {"status": "Deleted", "deleted_at": ts, "deleted_by": actor["id"], "deletion_result": result, "deletion_progress": {"done": total, "total": total}}})
        await db.phed_import_staging.delete_many({"import_id": batch_id})
        return result
    except Exception as exc:
        detail = exc.detail if isinstance(exc, HTTPException) else "Deletion failed; later work was preserved"
        await db[collection].update_one({"id": batch_id}, {"$set": {"status": "Delete Failed", "deletion_error": str(detail)}})
        raise


async def undo_batch(db, kind, batch_id, confirmation, actor, force=False):
    """Synchronous full run (kept for direct/programmatic use)."""
    collection, batch, changes, warnings = await prepare_undo(db, kind, batch_id, confirmation, force=force)
    if changes is None:
        return {"status": "Deleted", "deleted": 0, "restored": 0}
    return await execute_undo(db, kind, collection, batch, changes, warnings, actor)
