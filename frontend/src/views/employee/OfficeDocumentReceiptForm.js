import { useState } from 'react';
import axios from 'axios';
import { ArrowLeft, FileCheck2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';

import { OFFICE_DOCUMENT_OPTIONS } from '../../constants/officeDocuments';

const PHED = process.env.REACT_APP_BACKEND_URL + '/api/phed';

export default function OfficeDocumentReceiptForm({ consumer, property, H, onBack, onSaved }) {
  const [status, setStatus] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (!status || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.post(`${PHED}/consumers/${consumer.id}/office-document-receipt`, {
        property_record_id: property.id, status, remarks: remarks.trim(), confirm: true,
      }, H());
      toast.success(data.reference_number
        ? `Property ID linked ✓ Survey approval ke liye bhej diya — ${data.reference_number}`
        : 'Property ID linked ✓ Survey approval ke liye bhej diya');
      onSaved(data);
    } catch (err) {
      setError(typeof err.response?.data?.detail === 'string' ? err.response.data.detail : 'Receipt could not be saved. Please try again.');
    } finally { setSaving(false); }
  };

  return (
    <EmployeeLayout title="Document submission">
      <form onSubmit={submit} className="mx-auto max-w-md space-y-4" data-testid="office-document-form">
        <Button type="button" variant="ghost" onClick={onBack} disabled={saving} data-testid="back-to-property-search-button">
          <ArrowLeft className="mr-1 h-4 w-4" /> Property search
        </Button>
        <section className="clinic-card space-y-2 border p-4" data-testid="office-document-selected-records">
          <p className="text-xs font-semibold uppercase text-slate-500">Selected records</p>
          <p className="text-sm" data-testid="office-document-consumer">{consumer.consumer_name} · Consumer ID: {consumer.consumer_id}</p>
          <p className="font-mono font-semibold text-blue-700" data-testid="office-document-property-id">{property.property_id}</p>
          <p className="text-sm" data-testid="office-document-owner">{property.owner_name || '—'} · {property.mobile || 'No mobile number'}</p>
          <p className="text-xs text-slate-500" data-testid="office-document-address">Colony: {property.colony || property.ward || '—'} · {property.address || '—'}</p>
        </section>
        <p className="rounded-md border border-teal-200 bg-teal-50 p-2 text-xs text-teal-800" data-testid="office-document-no-link-notice">Submit karne par yeh Property ID is PHED consumer se <b>link</b> ho jayegi aur survey <b>admin approval</b> ke liye chala jayega.</p>
        <fieldset disabled={saving} className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Documents received — select one</legend>
          {OFFICE_DOCUMENT_OPTIONS.map(([key, label]) => (
            <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${status === label ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white hover:border-teal-400'}`}>
              <input type="radio" name="document-status" value={label} checked={status === label} required onChange={() => { setStatus(label); setError(''); }} className="mt-0.5 accent-teal-700" data-testid={`office-document-option-${key}`} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="space-y-2">
          <label htmlFor="office-document-remarks" className="text-sm font-medium">{status === 'Other' ? 'Describe the documents received (required)' : 'Remarks (optional)'}</label>
          <Textarea id="office-document-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} required={status === 'Other'} maxLength={2000} disabled={saving} data-testid="office-document-remarks" />
        </div>
        {error && <p role="alert" className="text-sm text-red-700" data-testid="office-document-error">{error}</p>}
        <Button type="submit" disabled={saving || !status || (status === 'Other' && !remarks.trim())} className="h-12 w-full text-white" style={{ background: 'var(--phed-teal)' }} data-testid="submit-office-document-button">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />} Submit document status
        </Button>
      </form>
    </EmployeeLayout>
  );
}
