export const CONNECTION_TYPES = {
  ALREADY_CONNECTION: { label: 'Already Connection', classes: 'border-green-300 bg-green-100 text-green-900', icon: 'both' },
  WATER_CONNECTION: { label: 'Water Connection Only — Sewer Missing', classes: 'border-blue-300 bg-blue-50 text-blue-900', icon: 'water' },
  SEWER_CONNECTION: { label: 'Sewer Connection Only — Water Missing', classes: 'border-orange-300 bg-orange-50 text-orange-900', icon: 'sewer' },
  NEW_CONNECTION: { label: 'New Connection', classes: 'border-teal-300 bg-teal-50 text-teal-900', icon: 'new' },
  DEATH_TRANSFER: { label: 'Death Transfer', classes: 'border-rose-300 bg-rose-50 text-rose-900', icon: 'transfer' },
  OWNERSHIP_CHANGE: { label: 'Ownership Change', classes: 'border-amber-300 bg-amber-50 text-amber-900', icon: 'transfer' },
  PROPERTY_LOCKED: { label: 'Property Locked', classes: 'border-slate-300 bg-slate-100 text-slate-700', icon: 'lock' },
  OWNER_DENIED: { label: 'Owner Denied', classes: 'border-red-300 bg-red-50 text-red-900', icon: 'denied' },
  UNKNOWN: { label: 'Connection Details Not Recorded', classes: 'border-slate-300 bg-slate-50 text-slate-700', icon: 'unknown' },
};

export function connectionCode(survey) {
  if (CONNECTION_TYPES[survey?.connection_type]) return survey.connection_type;
  const w = survey?.water || {};
  if (w.property_locked) return 'PROPERTY_LOCKED';
  if (w.owner_denied) return 'OWNER_DENIED';
  if (['DEATH_TRANSFER', 'OWNERSHIP_CHANGE'].includes(w.owner_change)) return w.owner_change;
  if (w.new_connection || survey?.survey_type === 'NO_CONNECTION') return 'NEW_CONNECTION';
  const hasWater = (w.connection_numbers || []).some(Boolean) || w.connection_number || w.has_water;
  const hasSewer = (w.sewer_connection_numbers || []).some(Boolean) || w.sewer_connection_number || w.has_sewer;
  if (hasWater && hasSewer) return 'ALREADY_CONNECTION';
  if (hasWater) return 'WATER_CONNECTION';
  if (hasSewer) return 'SEWER_CONNECTION';
  return 'UNKNOWN';
}

export const connectionLabel = (survey) => CONNECTION_TYPES[connectionCode(survey)].label;