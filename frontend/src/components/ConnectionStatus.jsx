import { ArrowRightLeft, BadgeCheck, Droplet, Waves, PlusCircle, Lock, Ban, CircleHelp, AlertCircle } from 'lucide-react';
import { CONNECTION_TYPES, connectionCode } from '../lib/connectionStatus';
const icons = { both: BadgeCheck, water: Droplet, sewer: Waves, new: PlusCircle, transfer: ArrowRightLeft, lock: Lock, denied: Ban, unknown: CircleHelp };

export const ConnectionTypeBadge = ({ survey, testId }) => {
  const code = connectionCode(survey);
  const type = CONNECTION_TYPES[code];
  const Icon = icons[type.icon];
  return <span data-testid={testId} data-connection-type={code} className={`inline-flex max-w-full items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold leading-5 ${type.classes}`}>
    <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 whitespace-normal break-words">{type.label}</span>
  </span>;
};

export const ConnectionAvailability = ({ water, sewer, testId }) => (
  <div className="flex flex-wrap gap-1.5" data-testid={testId}>
    {[['water', 'Water', water, Droplet], ['sewer', 'Sewer', sewer, Waves]].map(([key, label, present, Icon]) => (
      <span key={key} data-testid={`${testId}-${key}`} className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${present ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
        {present ? <Icon aria-hidden="true" className="h-3.5 w-3.5" /> : <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />}{label} {present ? 'Connected' : 'Missing'}
      </span>
    ))}
  </div>
);