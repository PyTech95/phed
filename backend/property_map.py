"""Location validation for surveyor maps; never invent coordinates for imports."""
import math
from typing import Any

from pydantic import BaseModel


class EmployeeMapResponse(BaseModel):
    properties: list[dict[str, Any]]
    count: int
    mapped_count: int
    missing_location_count: int


def normalize_location(prop: dict) -> bool:
    """Normalize legacy numeric strings; missing/invalid pairs stay unlocated."""
    try:
        raw_lat, raw_lng = prop.get("latitude"), prop.get("longitude")
        if isinstance(raw_lat, bool) or isinstance(raw_lng, bool):
            raise ValueError("boolean coordinate")
        lat, lng = float(raw_lat), float(raw_lng)
        valid = (math.isfinite(lat) and math.isfinite(lng)
                 and -90 <= lat <= 90 and -180 <= lng <= 180
                 and (lat, lng) != (0, 0))
    except (TypeError, ValueError, OverflowError):
        valid = False
    prop["latitude"] = lat if valid else None
    prop["longitude"] = lng if valid else None
    prop["has_location"] = valid
    return valid