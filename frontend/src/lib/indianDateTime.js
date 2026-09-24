const options = { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
const formatter = new Intl.DateTimeFormat('en-GB', options);

export function formatISTDateTime(value) {
  if (!value) return '—';
  let normalized = value;
  // Legacy timezone-less backend timestamps represent UTC, never the browser's timezone.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) normalized = value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '—';
  const p = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute}:${p.second} IST`;
}

export function formatIndianDate(value) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : formatISTDateTime(value).split(',')[0];
}