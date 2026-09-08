import { useState, useEffect, useRef, useCallback } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Upload, FileSpreadsheet, CheckCircle, Download, AlertTriangle, Loader2, Plus, Database, History,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = API_URL + '/phed';

const MODES = [
  { v: 'validate_only', l: 'Validate only (no changes)' },
  { v: 'import_and_update', l: 'Import new + update existing' },
  { v: 'new_only', l: 'Import new records only' },
  { v: 'update_only', l: 'Update existing records only' },
];

export default function PhedImport() {
  const { getAuthHeader } = useAuth();
  const [wards, setWards] = useState([]);
  const [wardId, setWardId] = useState('');
  const [defaultColony, setDefaultColony] = useState('');
  const [mode, setMode] = useState('import_and_update');
  const [file, setFile] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [imports, setImports] = useState([]);
  const [newWard, setNewWard] = useState('');
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const H = () => ({ headers: getAuthHeader() });

  const downloadSample = async () => {
    try {
      const res = await axios.get(`${PHED}/import/sample`, { ...H(), responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'PHED_import_sample.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Sample template downloaded');
    } catch (e) { toast.error('Could not download sample'); }
  };

  const loadWards = useCallback(async () => {
    try {
      const { data } = await axios.get(`${PHED}/wards`, H());
      setWards(data.wards || []);
    } catch { /* ignore */ }
  }, []);

  const loadImports = useCallback(async () => {
    try {
      const { data } = await axios.get(`${PHED}/imports`, H());
      setImports(data.imports || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadWards(); loadImports(); return () => clearInterval(pollRef.current); }, [loadWards, loadImports]);

  const createWard = async () => {
    if (!newWard.trim()) return;
    try {
      const { data } = await axios.post(`${PHED}/wards`, { ward_number: newWard.trim() }, H());
      toast.success(`Ward ${data.ward_number} created`);
      setNewWard('');
      await loadWards();
      setWardId(data.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create ward');
    }
  };

  const validate = async () => {
    if (!file) return toast.error('Choose an .xlsx file');
    if (!wardId) return toast.error('Select a ward');
    setValidating(true);
    setValidation(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('ward_id', wardId);
      fd.append('default_colony', defaultColony);
      fd.append('mode', mode);
      const { data } = await axios.post(`${PHED}/import/validate`, fd, {
        headers: { ...getAuthHeader(), 'Content-Type': 'multipart/form-data' },
      });
      setValidation(data);
      toast.success('File validated — review the summary below');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  const pollImport = (id) => {
    clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const { data } = await axios.get(`${PHED}/import/${id}`, H());
        setValidation((v) => ({ ...v, ...data }));
        if (['Completed', 'Validated Only'].includes(data.status)) {
          clearInterval(pollRef.current);
          setCommitting(false);
          toast.success('Import completed');
          loadImports();
        } else if (data.status === 'Failed' || attempts > 120) {
          clearInterval(pollRef.current);
          setCommitting(false);
          toast.error('Import did not complete — check the error report');
          loadImports();
        }
      } catch { clearInterval(pollRef.current); setCommitting(false); }
    }, 1200);
  };

  const commit = async () => {
    if (!validation?.id) return;
    setCommitting(true);
    try {
      const { data } = await axios.post(`${PHED}/import/${validation.id}/commit`, {}, H());
      if (data.status === 'Processing') {
        toast.info('Import started…');
        pollImport(validation.id);
      } else {
        setCommitting(false);
        toast.success(data.message || 'Done');
        loadImports();
      }
    } catch (e) {
      setCommitting(false);
      toast.error(e.response?.data?.detail || 'Commit failed');
    }
  };

  const downloadErrors = async (id) => {
    try {
      const res = await axios.get(`${PHED}/import/${id}/errors.csv`, { ...H(), responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `import_errors_${id.slice(0, 8)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
  };

  const c = validation?.counts || {};
  const countCards = [
    ['Total rows', c.total_rows], ['Valid rows', c.valid_rows], ['Invalid rows', c.invalid_rows],
    ['New consumers', c.new_consumers], ['Existing', c.existing_consumers], ['Duplicate IDs', c.duplicate_consumer_ids],
    ['New Water conn.', c.new_water_connections], ['New Sewer conn.', c.new_sewer_connections],
    ['Missing optional', c.rows_with_missing_optional], ['Conflicts', c.conflicts],
  ];

  return (
    <AdminLayout title="PHED Data Import">
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-6">
          <Card className="clinic-card" data-testid="phed-import-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg" style={{ color: 'var(--phed-ink)' }}>
                <Database className="w-5 h-5" style={{ color: 'var(--phed-blue)' }} /> Import PHED Consumer Excel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Ward <span className="text-red-500">*</span></Label>
                  <Select value={wardId} onValueChange={setWardId}>
                    <SelectTrigger className="mt-1.5" data-testid="import-ward-select"><SelectValue placeholder="Select ward" /></SelectTrigger>
                    <SelectContent>
                      {wards.map((w) => <SelectItem key={w.id} value={w.id}>Ward {w.ward_number} — {w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Default colony / locality (optional)</Label>
                  <Input className="mt-1.5" value={defaultColony} onChange={(e) => setDefaultColony(e.target.value)} placeholder="e.g. Model Town" data-testid="import-colony-input" />
                </div>
                <div>
                  <Label>Import mode</Label>
                  <Select value={mode} onValueChange={setMode}>
                    <SelectTrigger className="mt-1.5" data-testid="import-mode-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{MODES.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Excel file (.xlsx)</Label>
                  <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden"
                    onChange={(e) => setFile(e.target.files[0])} data-testid="import-file-input" />
                  <Button variant="outline" className="mt-1.5 w-full justify-start" onClick={() => fileRef.current?.click()}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />{file ? file.name : 'Choose file'}
                  </Button>
                </div>
              </div>
              <Button onClick={validate} disabled={validating} className="w-full text-white" style={{ background: 'var(--phed-blue)' }} data-testid="import-validate-btn">
                {validating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />} Validate file
              </Button>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs" style={{ color: 'var(--phed-muted)' }}>
                  Expected columns: Consumer Name, F/H Name, Head of Family in PPP, Address, Locality, Phone No., Consumer ID, Water Connection No., Sewer Connection No., Type of Connection.
                </p>
                <Button variant="outline" size="sm" onClick={downloadSample} data-testid="download-sample-btn" className="shrink-0">
                  <Download className="w-4 h-4 mr-1.5" /> Download sample file
                </Button>
              </div>
            </CardContent>
          </Card>

          {validation && (
            <Card className="clinic-card" data-testid="validation-summary">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg" style={{ color: 'var(--phed-ink)' }}>Validation summary</CardTitle>
                <Badge style={{ background: 'var(--phed-blue-soft)', color: 'var(--phed-blue)' }}>{validation.status}</Badge>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {countCards.map(([label, val]) => (
                    <div key={label} className="rounded-xl border p-3" style={{ borderColor: 'var(--phed-border)' }}>
                      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--phed-muted)' }}>{label}</div>
                      <div className="text-2xl font-bold" style={{ color: 'var(--phed-ink)' }}>{val ?? 0}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="text-sm font-semibold mb-2" style={{ color: 'var(--phed-ink)' }}>Detected column mapping</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(validation.header_mapping || {}).map(([f, h]) => (
                      <Badge key={f} variant="outline" className="font-normal">{f} → {h}</Badge>
                    ))}
                    {(validation.unmapped_headers || []).map((h) => (
                      <Badge key={h} variant="outline" className="font-normal text-amber-600 border-amber-300">unmapped: {h}</Badge>
                    ))}
                  </div>
                </div>

                {validation.preview?.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--phed-border)' }}>
                    <Table>
                      <TableHeader><TableRow>
                        {['Row', 'Consumer ID', 'Name', 'F/H', 'Phone', 'Water', 'Sewer', 'Type', 'Notes'].map((h) => <TableHead key={h}>{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {validation.preview.map((r) => (
                          <TableRow key={r.row}>
                            <TableCell className="font-mono text-xs">{r.row}</TableCell>
                            <TableCell className="font-mono text-xs">{r.consumer_id || '—'}</TableCell>
                            <TableCell>{r.consumer_name || '—'}</TableCell>
                            <TableCell>{r.fh_name || '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{r.phone || '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{r.water_conn || '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{r.sewer_conn || '—'}</TableCell>
                            <TableCell>{r.category || '—'}</TableCell>
                            <TableCell className="text-xs text-amber-600">
                              {(r.errors?.length ? r.errors : r.warnings || []).join('; ') || '✓'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {validation.result && (
                  <div className="rounded-xl p-4 bg-green-50 border border-green-200 text-sm text-green-800" data-testid="import-result">
                    <div className="font-semibold flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Import result</div>
                    <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1">
                      <span>Created consumers: {validation.result.created_consumers}</span>
                      <span>Updated: {validation.result.updated_consumers}</span>
                      <span>Skipped: {validation.result.skipped_consumers}</span>
                      <span>Created connections: {validation.result.created_connections}</span>
                      <span>Skipped conn.: {validation.result.skipped_connections}</span>
                      <span>Conflicts: {validation.result.conflicts}</span>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  {validation.status === 'Validated' && (
                    <Button onClick={commit} disabled={committing} className="text-white" style={{ background: 'var(--phed-teal)' }} data-testid="import-commit-btn">
                      {committing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                      {mode === 'validate_only' ? 'Close validation' : `Commit import (${c.valid_rows} rows)`}
                    </Button>
                  )}
                  {(validation.counts?.invalid_rows > 0 || validation.counts?.conflicts > 0) && (
                    <Button variant="outline" onClick={() => downloadErrors(validation.id)} data-testid="download-errors-btn">
                      <AlertTriangle className="w-4 h-4 mr-2 text-amber-600" /> Download error report
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Side: ward mgmt + history */}
        <div className="space-y-6">
          <Card className="clinic-card">
            <CardHeader><CardTitle className="text-base" style={{ color: 'var(--phed-ink)' }}>Wards</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input value={newWard} onChange={(e) => setNewWard(e.target.value)} placeholder="Ward no. e.g. 1" data-testid="new-ward-input" />
                <Button variant="outline" onClick={createWard} data-testid="create-ward-btn"><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {wards.length === 0 && <span className="text-xs" style={{ color: 'var(--phed-muted)' }}>No wards yet. Create one to import.</span>}
                {wards.map((w) => <Badge key={w.id} variant="outline">Ward {w.ward_number}</Badge>)}
              </div>
            </CardContent>
          </Card>

          <Card className="clinic-card">
            <CardHeader><CardTitle className="text-base flex items-center gap-2" style={{ color: 'var(--phed-ink)' }}><History className="w-4 h-4" /> Import history</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
              {imports.length === 0 && <span className="text-xs" style={{ color: 'var(--phed-muted)' }}>No imports yet.</span>}
              {imports.map((im) => (
                <div key={im.id} className="rounded-lg border p-2.5 text-xs" style={{ borderColor: 'var(--phed-border)' }} data-testid={`import-history-${im.id}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate" style={{ color: 'var(--phed-ink)' }}>{im.filename}</span>
                    <Badge variant="outline" className="text-[10px]">{im.status}</Badge>
                  </div>
                  <div style={{ color: 'var(--phed-muted)' }}>Ward {im.ward_number} · {im.counts?.total_rows} rows · {new Date(im.created_at).toLocaleString()}</div>
                  {im.result && (((im.result.created_consumers || 0) + (im.result.updated_consumers || 0)) > 0 ? (
                    <div className="text-green-700">
                      +{im.result.created_consumers} new, {im.result.updated_consumers} updated
                      {im.result.skipped_consumers ? `, ${im.result.skipped_consumers} skipped` : ''} consumers · +{im.result.created_connections} conn.
                      {im.result.conflicts ? ` · ${im.result.conflicts} conflicts` : ''}
                    </div>
                  ) : (
                    <div className="text-amber-700" data-testid={`import-nothing-saved-${im.id}`}>
                      Nothing saved (0 new, 0 updated).
                      {im.counts?.invalid_rows
                        ? ` ${im.counts.invalid_rows} row(s) invalid — each row needs a Consumer ID and Consumer Name column.`
                        : ' Rows were duplicates or skipped by the chosen import mode.'}
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
