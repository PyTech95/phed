import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Input } from './ui/input';
import { formatIndianDate } from '../lib/indianDateTime';

export const IndianDateInput = ({ value, onChange, testId, label }) => {
  const [text, setText] = useState(value ? formatIndianDate(value) : '');
  const [error, setError] = useState(false);
  const picker = useRef(null);
  useEffect(() => { setText(value ? formatIndianDate(value) : ''); setError(false); }, [value]);
  const change = (next) => {
    setText(next);
    if (!next) { setError(false); onChange(''); return; }
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next);
    if (!m) { setError(true); return; }
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    const valid = !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
    setError(!valid); if (valid) onChange(iso);
  };
  return <div className="mt-1">
    <div className="relative">
      <Input value={text} placeholder="DD/MM/YYYY" inputMode="numeric" maxLength={10} onChange={(e) => change(e.target.value)}
        className="pr-10" aria-label={label} aria-invalid={error} data-testid={testId} />
      <input ref={picker} type="date" value={value} onChange={(e) => { onChange(e.target.value); setError(false); }} className="pointer-events-none absolute h-0 w-0 opacity-0" tabIndex={-1} aria-label={`${label} calendar`} data-testid={`${testId}-calendar-input`} />
      <button type="button" title="Choose date" aria-label={`Choose ${label.toLowerCase()}`} data-testid={`${testId}-calendar-button`} className="absolute right-2 top-2 text-slate-500 hover:text-blue-700" onClick={() => picker.current?.showPicker?.()}><CalendarDays className="h-5 w-5" /></button>
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-red-600" data-testid={`${testId}-error`}>Enter a valid DD/MM/YYYY date</p>}
  </div>;
};