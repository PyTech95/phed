"""Map reads use the latest PHED survey, not stale legacy notice status."""


async def enrich_survey_states(db, properties):
    if not properties:
        return properties
    ids = [p["id"] for p in properties]
    rows = await db.phed_surveys.find({"property_record_id": {"$in": ids}}, {
        "_id": 0, "property_record_id": 1, "status": 1, "survey_type": 1,
        "surveyor_name": 1, "updated_at": 1,
    }).sort([("updated_at", 1), ("created_at", 1)]).to_list(None)
    latest = {s["property_record_id"]: s for s in rows}
    for prop in properties:
        survey = latest.get(prop["id"])
        if survey:
            prop.update(phed_survey_state=survey["status"], phed_survey_status=survey["status"],
                        phed_survey_type=survey.get("survey_type"), phed_surveyor_name=survey.get("surveyor_name"))
    return properties