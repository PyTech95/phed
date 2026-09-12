import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { Building2, Download, Upload, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';

const PHED = process.env.REACT_APP_BACKEND_URL + '/api/phed';

export const OfficeImportCard = () => {
  const { getAuthHeader } = useAuth();
  const H = () => ({ headers: getAuthHeader() });
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const loadHistory = useCallback(async () => {
    try { const { data } = await axios.get(`${PHED}/office-imports`, H()); setHistory(data); } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const downloadSample = async () => {
    try {
      const res = await axios.get(`${PHED}/office-import/sample`, { ...H(), responseType: 'blob' });
      const url = URL.createObjectURL(res.data); const a = document.createElement('a');
      a.href = url; a.download = 'phed_office_documents_sample.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('Sample download failed'); }
  };

  const upload = async () => {
    if (!file) return toast.error('Excel file चुनें');
    setBusy(true); setResult(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await axios.post(`${PHED}/office-import`, fd, H());
      setResult(data); setFile(null);
      toast.success(`${data.approved} properties Approved (office documents)`);
      loadHistory();
    } catch (e) { toast.error(e.response?.data?.detail || 'Upload failed'); } finally { setBusy(false); }
  };

  return (
    <Card className="clinic-card" data-testid="office-import-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg" style={{ color: 'var(--phed-ink)' }}>
          <Building2 className="w-5 h-5" style={{ color: 'var(--phed-teal)' }} /> Office documents → auto Approve
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600">
          जिन लोगों के documents office में आ गए हैं, उनकी list Excel में upload करें — columns: <b>Property ID (PID)</b>, <b>Consumer ID</b>, Owner Name, Mobile, Remarks.
          PID या Consumer ID में से कोई एक ज़रूरी। Match मिलने पर property का survey <b>Approved (green, locked)</b> हो जाएगा और surveyor को दोबारा नहीं खुलेगा।
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} data-testid="office-file-input" />
          <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="office-choose-btn"><Upload className="w-4 h-4 mr-1.5" /> {file ? file.name : 'Excel चुनें'}</Button>
          <Button onClick={upload} disabled={!file || busy} className="text-white" style={{ background: 'var(--phed-teal)' }} data-testid="office-upload-btn">
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1.5" />} Upload & Approve
          </Button>
          <Button variant="ghost" size="sm" onClick={downloadSample} data-testid="office-sample-btn"><Download className="w-4 h-4 mr-1.5" /> Sample file</Button>
        </div>
        {result && (
          <div className="rounded-lg border p-3 text-sm space-y-2" style={{ borderColor: 'var(--phed-border)' }} data-testid="office-result">
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-green-600 text-white">Approved: {result.approved}</Badge>
              <Badge variant="outline">Rows: {result.total_rows}</Badge>
              <Badge variant="outline">Already approved: {result.already_approved}</Badge>
              <Badge variant="outline" className={result.not_found ? 'text-red-600 border-red-300' : ''}>Not found: {result.not_found}</Badge>
              <Badge variant="outline">Invalid: {result.invalid}</Badge>
            </div>
            {result.unmatched?.length > 0 && (
              <div className="text-xs text-slate-600 max-h-40 overflow-y-auto space-y-0.5" data-testid="office-unmatched">
                {result.unmatched.map((u, i) => (
                  <div key={i} className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" /> Row {u.row}: {u.property_id || u.consumer_id || '—'} — {u.reason}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {history.length > 0 && (
          <div className="text-xs text-slate-500 space-y-1" data-testid="office-history">
            {history.slice(0, 5).map((h) => (
              <div key={h.id} className="flex justify-between gap-2 border-t pt-1" style={{ borderColor: 'var(--phed-border)' }}>
                <span className="truncate">{h.filename} · {h.uploaded_by_name}</span>
                <span className="shrink-0">✓ {h.result?.approved} · ✗ {h.result?.not_found} · {new Date(h.created_at).toLocaleDateString('en-IN')}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
