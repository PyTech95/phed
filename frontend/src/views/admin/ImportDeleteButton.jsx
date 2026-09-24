import { useState } from 'react';
import axios from 'axios';
import { Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';

const BASE = process.env.REACT_APP_BACKEND_URL + '/api/phed/import-batches';
const errorText = (e) => {
  const detail = e.response?.data?.detail;
  return typeof detail === 'string' ? detail : detail?.message || 'Delete failed; no later survey will be overwritten.';
};

export const ImportDeleteButton = ({ batch, kind, onDeleted }) => {
  const { user, getAuthHeader } = useAuth();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [force, setForce] = useState(false);
  const testId = `delete-import-${kind}-${batch.id}`;
  if (user?.role !== 'ADMIN') return null;

  const loadPreview = async (forceMode) => {
    setBusy(true); setError(''); setPreview(null);
    try {
      const { data } = await axios.get(`${BASE}/${kind}/${batch.id}/deletion-preview`, {
        headers: getAuthHeader(), params: forceMode ? { force: true } : {},
      });
      setPreview(data);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const show = () => {
    setOpen(true); setPreview(null); setError(''); setConfirmation(''); setForce(false);
    loadPreview(false);
  };

  const toggleForce = (checked) => {
    setForce(checked);
    setConfirmation('');
    loadPreview(checked);
  };

  const remove = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await axios.delete(`${BASE}/${kind}/${batch.id}`, {
        headers: getAuthHeader(), data: { confirmation, force },
      });
      toast.success(`Import removed: ${data.deleted} records deleted, ${data.restored} restored`);
      setOpen(false); onDeleted?.();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const blocked = preview?.blocked?.length > 0;
  return <>
    <Button variant="ghost" size="sm" className="text-red-700 shrink-0" title="Delete imported data" onClick={show}
      disabled={['Deleted', 'Processing', 'Deleting'].includes(batch.status)} data-testid={testId}>
      <Trash2 className="h-3.5 w-3.5 mr-1" />{batch.status === 'Deleted' ? 'Deleted' : 'Delete data'}
    </Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="import-delete-dialog">
        <DialogHeader><DialogTitle>Delete imported data?</DialogTitle>
          <DialogDescription className="break-all" data-testid="import-delete-filename">{batch.filename}</DialogDescription></DialogHeader>
        {busy && <p role="status" data-testid="import-delete-loading"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Please wait…</p>}
        {error && <p role="alert" className="text-sm text-red-700" data-testid="import-delete-error">{error}</p>}
        {preview && <>
          <p className="text-sm" data-testid="import-delete-impact">Remove {preview.remove} import-created records; restore {preview.restore} records to their previous values. Other batches and later survey work are protected. Import history is retained.</p>
          {preview.warnings.map((warning, i) => <p className="text-sm text-amber-800 break-words" key={i} data-testid={`import-delete-warning-${i}`}>{warning}</p>)}
          {blocked && <div role="alert" className="bg-red-50 p-3 rounded text-sm text-red-800" data-testid="import-delete-blocked">
            Deletion blocked to protect existing work.<ul className="list-disc pl-4 break-all">{preview.blocked.slice(0, 10).map((reason, i) => <li key={i} data-testid={`import-delete-block-reason-${i}`}>{reason}</li>)}</ul>
            <label className="flex items-start gap-2 mt-3 font-semibold text-red-900">
              <input type="checkbox" checked={force} onChange={(e) => toggleForce(e.target.checked)} data-testid="import-delete-force" className="mt-1" />
              <span>{force
                ? 'Force delete enabled — remaining items above are protected by later survey work and cannot be deleted.'
                : 'Force delete: edited/purane records bhi permanently delete karein aur properties unblock karein (unka restore possible nahi hoga)'}</span>
            </label>
          </div>}
          {!blocked && force && <p className="text-sm text-amber-800" data-testid="import-delete-force-note">Force mode ON: edited records will be permanently deleted without restore.</p>}
          <label htmlFor="import-delete-confirmation" className="text-sm">Type the filename to confirm</label>
          <Input id="import-delete-confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy || blocked} data-testid="import-delete-confirmation" />
        </>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)} data-testid="import-delete-cancel">Cancel</Button>
          <Button variant="destructive" onClick={remove} disabled={busy || !preview || blocked || confirmation !== batch.filename} data-testid="import-delete-submit">Delete data</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
};
