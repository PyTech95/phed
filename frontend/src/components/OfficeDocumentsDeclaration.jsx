import { FileCheck2 } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { formatISTDateTime } from '../lib/indianDateTime';

export const OfficeDocumentsCheckbox = ({ checked, disabled, onCheckedChange }) => (
  <label className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${checked ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white hover:border-teal-500'} ${disabled ? 'opacity-70' : 'cursor-pointer'}`} data-testid="office-documents-option">
    <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)}
      className="mt-0.5 shrink-0" data-testid="office-documents-checkbox" aria-label="Already documents submitted in office" />
    <span className="min-w-0">
      <span className="block font-medium" data-testid="office-documents-option-label">Already documents submitted in office</span>
      <span className="mt-1 block text-xs text-slate-500" data-testid="office-documents-option-scope">All required documents · Submit survey</span>
    </span>
  </label>
);

export const OfficeDocumentsStatus = ({ water, testId = 'office-documents-status' }) => {
  if (!water?.office_documents_submitted) return null;
  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-left text-xs text-teal-800" data-testid={testId}>
      <div className="flex items-start gap-2 font-medium"><FileCheck2 className="h-4 w-4 shrink-0" />Already documents submitted in office</div>
      {water.office_documents_recorded_by_name && <p className="mt-1" data-testid={`${testId}-recorder`}>Recorded by {water.office_documents_recorded_by_name}</p>}
      {water.office_documents_recorded_at && <p className="mt-1" data-testid={`${testId}-date`}>{formatISTDateTime(water.office_documents_recorded_at)}</p>}
    </div>
  );
};