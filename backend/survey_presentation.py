"""Mutually exclusive survey categories and Indian reporting dates."""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException

IST = ZoneInfo('Asia/Kolkata')
CONNECTION_LABELS = {
    'ALREADY_CONNECTION': 'Already Connection',
    'WATER_CONNECTION': 'Water Connection Only — Sewer Missing',
    'SEWER_CONNECTION': 'Sewer Connection Only — Water Missing',
    'NEW_CONNECTION': 'New Connection',
    'DEATH_TRANSFER': 'Death Transfer',
    'OWNERSHIP_CHANGE': 'Ownership Change',
    'PROPERTY_LOCKED': 'Property Locked',
    'OWNER_DENIED': 'Owner Denied',
    'UNKNOWN': 'Connection Details Not Recorded',
}


def connection_code(survey):
    w = survey.get('water') or {}
    if w.get('property_locked'): return 'PROPERTY_LOCKED'
    if w.get('owner_denied'): return 'OWNER_DENIED'
    if w.get('owner_change') == 'DEATH_TRANSFER': return 'DEATH_TRANSFER'
    if w.get('owner_change') == 'OWNERSHIP_CHANGE': return 'OWNERSHIP_CHANGE'
    if w.get('new_connection') or survey.get('survey_type') == 'NO_CONNECTION': return 'NEW_CONNECTION'
    has_water = bool(any(w.get('connection_numbers') or []) or w.get('connection_number') or w.get('has_water'))
    has_sewer = bool(any(w.get('sewer_connection_numbers') or []) or w.get('sewer_connection_number') or w.get('has_sewer'))
    if has_water and has_sewer: return 'ALREADY_CONNECTION'
    if has_water: return 'WATER_CONNECTION'
    if has_sewer: return 'SEWER_CONNECTION'
    return 'UNKNOWN'


def connection_query(code):
    def service_rule(array, single, flag):
        return {'$or': [{f'water.{array}': {'$elemMatch': {'$nin': ['', None]}}},
                        {f'water.{single}': {'$exists': True, '$nin': ['', None]}}, {f'water.{flag}': True}]}
    water = service_rule('connection_numbers', 'connection_number', 'has_water')
    sewer = service_rule('sewer_connection_numbers', 'sewer_connection_number', 'has_sewer')
    rules = [
        ('PROPERTY_LOCKED', {'water.property_locked': True}),
        ('OWNER_DENIED', {'water.owner_denied': True}),
        ('DEATH_TRANSFER', {'water.owner_change': 'DEATH_TRANSFER'}),
        ('OWNERSHIP_CHANGE', {'water.owner_change': 'OWNERSHIP_CHANGE'}),
        ('NEW_CONNECTION', {'$or': [{'water.new_connection': True}, {'survey_type': 'NO_CONNECTION'}]}),
        ('ALREADY_CONNECTION', {'$and': [water, sewer]}),
        ('WATER_CONNECTION', water), ('SEWER_CONNECTION', sewer),
    ]
    excluded = []
    for key, rule in rules:
        if code == key:
            return {'$and': [rule, {'$nor': excluded}]} if excluded else rule
        excluded.append(rule)
    if code == 'UNKNOWN': return {'$nor': excluded}
    raise HTTPException(400, 'Invalid connection type filter')


def indian_date_range(date_from=None, date_to=None):
    bounds = {}
    dates = []
    for value, operator in ((date_from, '$gte'), (date_to, '$lt')):
        if not value:
            dates.append(None)
            continue
        try:
            parsed = datetime.strptime(value, '%Y-%m-%d').date()
            if parsed.isoformat() != value: raise ValueError()
        except (ValueError, TypeError):
            raise HTTPException(400, 'Dates must use YYYY-MM-DD format')
        dates.append(parsed)
        local = datetime.combine(parsed, time.min, tzinfo=IST)
        if operator == '$lt': local += timedelta(days=1)
        # Prefix boundaries compare correctly with legacy naive UTC, Z, offset and fractional UTC strings.
        bounds[operator] = local.astimezone(timezone.utc).replace(tzinfo=None).isoformat(timespec='seconds')
    if dates[0] and dates[1] and dates[0] > dates[1]:
        raise HTTPException(400, 'From date must not be after to date')
    return bounds


def ist_datetime_text(value):
    if not value: return ''
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None: parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(IST).strftime('%d/%m/%Y, %H:%M:%S IST')
    except (ValueError, TypeError):
        return ''