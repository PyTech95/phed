import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ALL_DOCUMENT_STATUSES, OFFICE_DOCUMENT_OPTIONS } from '../constants/officeDocuments';

export const OfficeDocumentStatusFilter = ({ value, onChange, testId }) => (
  <div className="min-w-0">
    <Label htmlFor={testId} className="text-xs">Document status</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={testId} className="mt-1 w-full text-left [&>span]:truncate" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-w-[calc(100vw-2rem)]" data-testid={`${testId}-options`}>
        <SelectItem value={ALL_DOCUMENT_STATUSES} data-testid={`${testId}-all`}>All document statuses</SelectItem>
        <SelectItem value="not_submitted" data-testid={`${testId}-not-submitted`}>Not submitted</SelectItem>
        {OFFICE_DOCUMENT_OPTIONS.map(([key, status]) => (
          <SelectItem key={key} value={status} className="whitespace-normal" data-testid={`${testId}-${key}`}>{status}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    {value !== ALL_DOCUMENT_STATUSES && <p className="mt-1 text-xs text-slate-600" data-testid={`${testId}-active`}>{value === 'not_submitted' ? 'No document status submitted' : value}</p>}
  </div>
);
