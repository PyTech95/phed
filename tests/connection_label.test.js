// Source-mirrored unit test for connectionLabel + consumerIdOf precedence
// Mirrors exact logic from /app/frontend/src/views/admin/PhedSurveys.js lines 30-49

const connectionLabel = (s) => {
  const w = s.water || {};
  if (w.property_locked) return 'Property Locked';
  if (w.owner_denied) return 'Owner Denied';
  if (w.owner_change === 'DEATH_TRANSFER') return 'Death Transfer';
  if (w.owner_change === 'OWNERSHIP_CHANGE') return 'Ownership Change';
  const hasWater = (w.connection_numbers || []).length > 0;
  const hasSewer = w.has_sewer || (w.sewer_connection_numbers || []).length > 0;
  if (w.new_connection || s.survey_type === 'NO_CONNECTION') return 'New Connection';
  if (hasWater && hasSewer) return 'Water + Sewer Connection';
  if (hasSewer) return 'Sewer Connection';
  if (hasWater || w.has_connection || s.survey_type === 'WATER_CONNECTION') {
    return 'Already Connection';
  }
  return '—';
};
const consumerIdOf = (s) => {
  if (s.water?.new_connection || s.survey_type === 'NO_CONNECTION') return 'New Connection';
  return s.water?.consumer_id || '—';
};

const cases = [
  { name: 'locked has highest precedence over denied/new/water/sewer',
    s: { water: { property_locked: true, owner_denied: true, new_connection: true,
      connection_numbers: ['W1'], sewer_connection_numbers: ['S1'], owner_change: 'DEATH_TRANSFER' } },
    expect: 'Property Locked' },
  { name: 'denied beats owner_change and new/water',
    s: { water: { owner_denied: true, owner_change: 'OWNERSHIP_CHANGE', new_connection: true, connection_numbers: ['W1'] } },
    expect: 'Owner Denied' },
  { name: 'death transfer beats ownership_change/new/water',
    s: { water: { owner_change: 'DEATH_TRANSFER', new_connection: true, connection_numbers: ['W1'] } },
    expect: 'Death Transfer' },
  { name: 'ownership change beats new/water',
    s: { water: { owner_change: 'OWNERSHIP_CHANGE', new_connection: true, connection_numbers: ['W1'] } },
    expect: 'Ownership Change' },
  { name: 'new_connection beats water+sewer',
    s: { water: { new_connection: true, connection_numbers: ['W1'], sewer_connection_numbers: ['S1'] } },
    expect: 'New Connection' },
  { name: 'survey_type NO_CONNECTION => New Connection',
    s: { survey_type: 'NO_CONNECTION', water: {} },
    expect: 'New Connection' },
  { name: 'water + sewer combined',
    s: { water: { connection_numbers: ['W1'], sewer_connection_numbers: ['S1'] } },
    expect: 'Water + Sewer Connection' },
  { name: 'sewer only via list',
    s: { water: { sewer_connection_numbers: ['S1'] } },
    expect: 'Sewer Connection' },
  { name: 'sewer only via has_sewer flag',
    s: { water: { has_sewer: true } },
    expect: 'Sewer Connection' },
  { name: 'already connection via water list',
    s: { water: { connection_numbers: ['W1'] } },
    expect: 'Already Connection' },
  { name: 'already connection via has_connection',
    s: { water: { has_connection: true } },
    expect: 'Already Connection' },
  { name: 'already connection via survey_type WATER_CONNECTION',
    s: { survey_type: 'WATER_CONNECTION', water: {} },
    expect: 'Already Connection' },
  { name: 'fallback dash when no info',
    s: { water: {} },
    expect: '—' },
  // consumerIdOf precedence
  { name: 'consumerIdOf: new_connection => label',
    fn: consumerIdOf,
    s: { water: { new_connection: true, consumer_id: 'C-9' } },
    expect: 'New Connection' },
  { name: 'consumerIdOf: NO_CONNECTION type => label',
    fn: consumerIdOf,
    s: { survey_type: 'NO_CONNECTION', water: { consumer_id: 'C-9' } },
    expect: 'New Connection' },
  { name: 'consumerIdOf: returns water.consumer_id',
    fn: consumerIdOf,
    s: { water: { consumer_id: 'C-42' } },
    expect: 'C-42' },
  { name: 'consumerIdOf: locked => — (no consumer_id)',
    fn: consumerIdOf,
    s: { water: { property_locked: true } },
    expect: '—' },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = (c.fn || connectionLabel)(c.s);
  if (got === c.expect) { pass++; console.log(`PASS  ${c.name}`); }
  else { fail++; console.error(`FAIL  ${c.name} — expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`); }
}
console.log(`\nRESULT: ${pass} pass, ${fail} fail (total ${cases.length})`);
if (fail > 0) process.exit(1);
