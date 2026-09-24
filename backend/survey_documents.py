"""Office-document declarations for quick water surveys (not office approval)."""
from fastapi import HTTPException


def required_water_documents(survey_type, water):
    if water.get("owner_denied") or water.get("property_locked"):
        return []
    standard = ["APPLICATION", "AADHAAR", "PROPERTY_PROOF", "HOUSE_PHOTO"]
    if survey_type == "NO_CONNECTION" or water.get("new_connection"):
        return standard
    if not water.get("has_connection"):
        return []
    if water.get("owner_change") == "DEATH_TRANSFER":
        return [*standard, "DEATH_CERTIFICATE"]
    if water.get("owner_change") == "OWNERSHIP_CHANGE":
        return standard
    if water.get("connection_numbers") and water.get("sewer_connection_numbers"):
        return []
    return ["APPLICATION", "AADHAAR"]


def office_declaration_water(water, previous, requested, survey_type, user, timestamp):
    water = dict(water)
    # Recorder identity/timestamp must never come from client-supplied water metadata.
    for field in ("office_documents_submitted", "office_documents_recorded_at",
                  "office_documents_recorded_by", "office_documents_recorded_by_name"):
        water.pop(field, None)
    required = required_water_documents(survey_type, water)
    declared = requested if requested is not None else bool(previous.get("office_documents_submitted"))
    if declared and not required:
        if requested is True:
            raise HTTPException(400, "Office document declaration applies only when documents are required")
        declared = False
    water["office_documents_submitted"] = declared
    if declared:
        keep_record = previous.get("office_documents_submitted") and previous.get("required_docs") == required
        water.update({
            "required_docs": required, "document_pending": False, "missing_documents": [],
            "office_documents_recorded_at": previous.get("office_documents_recorded_at", timestamp) if keep_record else timestamp,
            "office_documents_recorded_by": previous.get("office_documents_recorded_by", user["id"]) if keep_record else user["id"],
            "office_documents_recorded_by_name": previous.get("office_documents_recorded_by_name", user.get("name")) if keep_record else user.get("name"),
        })
    elif previous.get("office_documents_submitted") and required:
        # Removing a declaration cannot silently leave an empty survey document-complete.
        water["required_docs"] = required
    return water


def validate_office_submission(survey):
    water = survey.get("water") or {}
    if not water.get("office_documents_submitted"):
        return
    if not required_water_documents(survey.get("survey_type"), water):
        raise HTTPException(400, "Office document declaration does not apply to this survey")
    required = [(water.get("mobile") or water.get("phone"), "Mobile number")]
    if water.get("new_connection") or survey.get("survey_type") == "NO_CONNECTION":
        required.extend([(water.get("new_owner_name"), "Owner name"), (water.get("new_locality"), "Colony / locality")])
    if water.get("has_connection"):
        required.append((water.get("consumer_ref") or water.get("consumer_id"), "PHED consumer"))
    if water.get("owner_change"):
        required.append((water.get("new_owner_name"), "New owner name"))
    if water.get("owner_change") == "DEATH_TRANSFER":
        required.append((water.get("relationship"), "Relationship"))
    if water.get("owner_change") == "OWNERSHIP_CHANGE":
        required.append((water.get("ownership_change_reason"), "Ownership change reason"))
    for value, label in required:
        if not str(value or "").strip():
            raise HTTPException(400, f"{label} is required before submitting")