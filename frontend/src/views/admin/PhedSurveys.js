import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Eye, MapPin, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Loader2,
  FileText, AlertTriangle, Droplet, Waves, Crosshair, ClipboardCheck, RotateCcw, Clock, Phone, Download, Search,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = API_URL + '/phed';
const ANY = '__any__';

const TYPE_LABEL = { EXISTING_LINKED: 'Existing linked', NEW_UNLISTED: 'New / unlisted', NO_CONNECTION: 'No connection', WATER_CONNECTION: 'Water connection' };
const STATUS_STYLE = {
  Approved: 'bg-green-100 text-green-700', Submitted: 'bg-blue-100 text-blue-700',
  Rejected: 'bg-red-100 text-red-700', Draft: 'bg-slate-100 text-slate-600', 'In Progress': 'bg-amber-100 text-amber-700',
  'Requires Review': 'bg-amber-100 text-amber-800', 'Document Pending': 'bg-orange-100 text-orange-700',
};
const DOC_LABEL = {
  APPLICATION: 'Application photo', AADHAAR: 'Aadhaar', AADHAAR_FRONT: 'Aadhaar (front)', AADHAAR_BACK: 'Aadhaar (back)',
  PROPERTY_PROOF: 'Property proof', PROPERTY_FRONT: 'Property photo', HOUSE_PHOTO: 'House photo (with owner)',
  DEATH_CERTIFICATE: 'Death certificate', BILL: 'Water/Sewer bill', REGISTRY: 'Registry', OTHER: 'Other',
};
const OWNER_CHANGE_LABEL = { DEATH_TRANSFER: 'Death transfer', OWNERSHIP_CHANGE: 'Ownership change' };

export default function PhedSurveys() {
  const { user, getAuthHeader } = useAuth();
  const H = () => ({ headers: getAuthHeader() });
  const isAdmin = user?.role === 'ADMIN';
  const [filters, setFilters] = useState({ wards: [], surveyors: [], statuses: [] });
  const [f, setF] = useState({ status: ANY, ward_id: ANY, surveyor_id: ANY, search: '' });
  const [searchInput, setSearchInput] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [detailSurvey, setDetailSurvey] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { axios.get(`${PHED}/filters`, H()).then((r) => setFilters(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setF((x) => ({ ...x, search: searchInput.trim() })); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setRows(null);
    const params = { page, limit: 20 };
    Object.entries(f).forEach(([k, v]) => { if (v && v !== ANY) params[k] = v; });
    try {
      const { data } = await axios.get(`${PHED}/surveys`, { ...H(), params });
      setRows(data.surveys); setTotal(data.total); setPages(data.pages || 1);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load surveys'); setRows([]); }
  }, [page, f]);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (s) => {
    setDetailSurvey(s); setDetail(null); setRejectReason('');
    try { const { data } = await axios.get(`${PHED}/property/${s.property_record_id}`, H()); setDetail(data); }
    catch { setDetail({ property: null, consumers: [] }); }
  };

  const viewAttachment = async (surveyId, att) => {
    try {
      const res = await axios.get(`${PHED}/surveys/${surveyId}/attachments/${att.id}`, { ...H(), responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch { toast.error('Could not open document'); }
  };

  const [pdfBusy, setPdfBusy] = useState(false);
  const downloadPdf = async (survey) => {
    setPdfBusy(true);
    try {
      const res = await axios.get(`${PHED}/surveys/${survey.id}/documents.pdf`, { ...H(), responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `phed_documents_${survey.property_id || survey.id}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (e) { toast.error(e.response?.status === 404 ? 'No documents to download' : 'Could not build PDF'); } finally { setPdfBusy(false); }
  };

  const bulkDownload = async () => {
    const ids = (rows || []).filter((s) => (s.attachments || []).length > 0).map((s) => s.id);
    if (ids.length === 0) return toast.error('इस list में कोई document वाला survey नहीं है');
    setBulkBusy(true);
    try {
      const res = await axios.post(`${PHED}/surveys/documents/bulk.zip`, { survey_ids: ids }, { ...H(), responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `phed_documents_bulk_${ids.length}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      toast.success(`${ids.length} surveys के documents ZIP में download हो रहे हैं`);
    } catch (e) { toast.error(e.response?.status === 404 ? 'कोई document नहीं मिला' : 'Bulk download failed'); } finally { setBulkBusy(false); }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await axios.post(`${PHED}/surveys/${detailSurvey.id}/approve`, {}, { headers: getAuthHeader() });
      toast.success('Survey approved');
      setDetailSurvey(null); setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Approve failed'); } finally { setBusy(false); }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return toast.error('Enter a rejection reason');
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('reason', rejectReason.trim());
      await axios.post(`${PHED}/surveys/${detailSurvey.id}/reject`, fd, { headers: { ...getAuthHeader(), 'Content-Type': 'multipart/form-data' } });
      toast.success('Survey rejected; property reopened');
      setDetailSurvey(null); setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Reject failed'); } finally { setBusy(false); }
  };

  const reopen = async (mode) => {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('reason', rejectReason.trim()); fd.append('mode', mode);
      await axios.post(`${PHED}/surveys/${detailSurvey.id}/reopen`, fd, { headers: { ...getAuthHeader(), 'Content-Type': 'multipart/form-data' } });
      toast.success(mode === 'pending' ? 'Marked as pending' : 'Returned to surveyor for correction');
      setDetailSurvey(null); setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Action failed'); } finally { setBusy(false); }
  };

  return (
    <AdminLayout title="PHED Survey Review">
      <Card className="clinic-card mb-4"><CardContent className="p-4 grid md:grid-cols-4 gap-3">
        <div className="md:col-span-1">
          <label className="text-xs font-medium text-slate-500">Search reference / property</label>
          <div className="relative mt-1">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="जैसे SS0001, MC-W1-002…"
              className="w-full h-9 pl-8 pr-2 rounded-md border text-sm" style={{ borderColor: 'var(--phed-border)' }} data-testid="survey-search-input" />
          </div>
        </div>
        <Flt label="Status" value={f.status} onChange={(v) => { setPage(1); setF({ ...f, status: v }); }}
          options={[[ANY, 'All statuses'], ...(filters.statuses || []).map((s) => [s, s])]} testid="survey-filter-status" />
        <Flt label="Ward" value={f.ward_id} onChange={(v) => { setPage(1); setF({ ...f, ward_id: v }); }}
          options={[[ANY, 'All wards'], ...(filters.wards || []).map((w) => [w.id, `Ward ${w.ward_number}`])]} testid="survey-filter-ward" />
        <Flt label="Surveyor" value={f.surveyor_id} onChange={(v) => { setPage(1); setF({ ...f, surveyor_id: v }); }}
          options={[[ANY, 'All surveyors'], ...(filters.surveyors || []).map((u) => [u.id, u.name])]} testid="survey-filter-surveyor" />
      </CardContent></Card>

      <Card className="clinic-card"><CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--phed-border)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--phed-ink)' }}><ClipboardCheck className="w-4 h-4 inline mr-1.5" />{total} surveys</span>
          <Button size="sm" variant="outline" onClick={bulkDownload} disabled={bulkBusy} className="h-8 text-blue-700 border-blue-300" data-testid="bulk-download-btn">
            {bulkBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />} Bulk PDF (ZIP)
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              {['Property', 'Ref no.', 'Surveyor', 'Type', 'GPS', 'Status', 'Submitted', ''].map((h) => <TableHead key={h}>{h}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {rows === null && <TableRow><TableCell colSpan={8} className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></TableCell></TableRow>}
              {rows?.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-slate-500">No surveys yet.</TableCell></TableRow>}
              {rows?.map((s) => (
                <TableRow key={s.id} data-testid={`survey-row-${s.id}`}>
                  <TableCell className="font-mono text-xs">{s.property_id}</TableCell>
                  <TableCell className="font-mono text-xs font-bold text-blue-700" data-testid={`ref-${s.id}`}>{s.reference_number || '—'}</TableCell>
                  <TableCell>{s.surveyor_name || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{TYPE_LABEL[s.survey_type] || s.survey_type || '—'}</Badge></TableCell>
                  <TableCell className="text-xs">
                    {s.latitude != null ? (
                      <span className="font-mono"><Crosshair className="w-3 h-3 inline mr-0.5 text-slate-400" />±{s.gps_accuracy}m
                        {s.gps_flagged && <AlertTriangle className="w-3 h-3 inline ml-1 text-amber-500" />}</span>
                    ) : <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell><Badge className={`text-[10px] ${STATUS_STYLE[s.status] || ''}`}>{s.status}</Badge></TableCell>
                  <TableCell className="text-xs text-slate-500">{s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : '—'}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => openDetail(s)} data-testid={`view-survey-${s.id}`}><Eye className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between p-3 border-t" style={{ borderColor: 'var(--phed-border)' }}>
            <span className="text-sm text-slate-500">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </CardContent></Card>

      <Dialog open={!!detailSurvey} onOpenChange={(o) => { if (!o) { setDetailSurvey(null); setDetail(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="survey-detail-dialog">
          <DialogHeader><DialogTitle style={{ color: 'var(--phed-ink)' }}>Survey — {detailSurvey?.property_id}{detailSurvey?.reference_number ? <span className="ml-2 font-mono text-blue-700" data-testid="detail-ref">{detailSurvey.reference_number}</span> : null}</DialogTitle></DialogHeader>
          {detailSurvey && (
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge className={STATUS_STYLE[detailSurvey.status]}>{detailSurvey.status}</Badge>
                <Badge variant="outline">{TYPE_LABEL[detailSurvey.survey_type] || detailSurvey.survey_type}</Badge>
                <Badge variant="outline">Surveyor: {detailSurvey.surveyor_name || '—'}</Badge>
                {detailSurvey.ward_number && <Badge variant="outline">Ward {detailSurvey.ward_number}</Badge>}
              </div>

              {detail?.property && (
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--phed-border)' }}>
                  <div className="font-semibold" style={{ color: 'var(--phed-ink)' }}>{detail.property.owner_name}</div>
                  <div className="text-xs text-slate-500">{detail.property.address} · {detail.property.colony}</div>
                </div>
              )}

              {detailSurvey.water && Object.keys(detailSurvey.water).length > 0 && (
                <WaterDetails w={detailSurvey.water} type={detailSurvey.survey_type} />
              )}

              <div>
                <div className="font-semibold mb-1" style={{ color: 'var(--phed-ink)' }}>Linked consumers</div>
                {(detail?.consumers || []).length === 0 ? <div className="text-xs text-slate-400">None</div> :
                  detail.consumers.map((c) => (
                    <div key={c.id} className="text-xs border-b py-1" style={{ borderColor: 'var(--phed-border)' }}>
                      <span className="font-medium">{c.consumer_name}</span> <span className="font-mono text-slate-500">{c.consumer_id}</span>
                      {(c.connections || []).map((cn) => (
                        <Badge key={cn.id} variant="outline" className="ml-1 text-[10px] font-mono" style={cn.service === 'Water' ? { color: '#1565C0' } : { color: '#00897B' }}>
                          {cn.service === 'Water' ? <Droplet className="w-3 h-3 inline mr-0.5" /> : <Waves className="w-3 h-3 inline mr-0.5" />}{cn.connection_number}
                        </Badge>))}
                    </div>
                  ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--phed-border)' }}>
                  <div className="text-[11px] uppercase text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> Survey GPS</div>
                  {detailSurvey.latitude != null ? (
                    <div className="font-mono text-xs mt-1">{detailSurvey.latitude?.toFixed(6)}, {detailSurvey.longitude?.toFixed(6)} (±{detailSurvey.gps_accuracy}m)
                      {detailSurvey.gps_drift_m != null && <div className={detailSurvey.gps_flagged ? 'text-amber-600' : 'text-slate-500'}>{detailSurvey.gps_drift_m}m from property {detailSurvey.gps_flagged && '⚠'}</div>}</div>
                  ) : <div className="text-xs text-slate-400 mt-1">Not captured</div>}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--phed-border)' }}>
                  <div className="text-[11px] uppercase text-slate-400">Remarks</div>
                  <div className="text-xs mt-1">{detailSurvey.remarks || '—'}</div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold" style={{ color: 'var(--phed-ink)' }}>Documents ({(detailSurvey.attachments || []).length})</div>
                  {(detailSurvey.attachments || []).length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => downloadPdf(detailSurvey)} disabled={pdfBusy} className="h-8 text-blue-700 border-blue-300" data-testid="download-docs-pdf-btn">
                      {pdfBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />} Download PDF (print)
                    </Button>
                  )}
                </div>
                <div className="space-y-1">
                  {(detailSurvey.attachments || []).length === 0 && <div className="text-xs text-slate-400">No documents</div>}
                  {(detailSurvey.attachments || []).map((a) => (
                    <button key={a.id} onClick={() => viewAttachment(detailSurvey.id, a)} data-testid={`view-attachment-${a.id}`}
                      className="w-full flex items-center justify-between text-xs rounded-lg border p-2 hover:bg-blue-50 transition-colors" style={{ borderColor: 'var(--phed-border)' }}>
                      <span><FileText className="w-3.5 h-3.5 inline mr-1 text-slate-400" />{DOC_LABEL[a.attachment_type] || a.attachment_type} · {a.filename}</span>
                      <Eye className="w-3.5 h-3.5 text-blue-600" />
                    </button>
                  ))}
                </div>
              </div>

              {detailSurvey.rejection_reason && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <span className="font-semibold">Rejected:</span> {detailSurvey.rejection_reason}
                </div>
              )}

              {detailSurvey.return_reason && (
                <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-xs text-orange-700" data-testid="return-reason-note">
                  <span className="font-semibold">Sent back to surveyor:</span> {detailSurvey.return_reason}
                  {detailSurvey.returned_by_name && <span className="text-orange-500"> — by {detailSurvey.returned_by_name}</span>}
                </div>
              )}

              {(detailSurvey.review_reasons || []).length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800" data-testid="review-reasons">
                  <span className="font-semibold">Needs review:</span> {detailSurvey.review_reasons.join(', ')}
                  {detailSurvey.owner_mismatch && detailSurvey.mismatch_reason && <div className="mt-1">Owner mismatch reason: {detailSurvey.mismatch_reason}</div>}
                </div>
              )}

              {['Submitted', 'Requires Review', 'Document Pending'].includes(detailSurvey.status) && (
                <Button onClick={approve} disabled={busy} className="w-full text-white" style={{ background: '#2E7D32' }} data-testid="approve-survey-btn">
                  {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />} Approve survey
                </Button>
              )}

              {isAdmin && !['Draft', 'Rejected'].includes(detailSurvey.status) && (
                <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--phed-border)' }}>
                  <Label className="text-xs" style={{ color: 'var(--phed-ink)' }}>Send back to surveyor (note optional — shown to surveyor)</Label>
                  <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Aadhaar photo blurry, re-upload…" className="mt-1" data-testid="return-note-input" />
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => reopen('correction')} disabled={busy} variant="outline" className="text-orange-700 border-orange-300" data-testid="return-correction-btn">
                      {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1.5" />} Return for correction
                    </Button>
                    <Button onClick={() => reopen('pending')} disabled={busy} variant="outline" className="text-orange-700 border-orange-300" data-testid="mark-pending-btn">
                      {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Clock className="w-4 h-4 mr-1.5" />} Mark pending
                    </Button>
                  </div>
                  <Button onClick={reject} disabled={busy} variant="outline" className="w-full text-red-600 border-red-300" data-testid="reject-survey-btn">
                    {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <XCircle className="w-4 h-4 mr-1.5" />} Reject &amp; reopen for re-survey
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => { setDetailSurvey(null); setDetail(null); }}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function WaterDetails({ w, type }) {
  const mode = w.property_locked ? 'Property locked' : w.owner_denied ? 'Owner denied' : (w.new_connection ? 'New connection request' : (w.has_connection ? 'Water connection found' : (type === 'NO_CONNECTION' ? 'No connection' : '—')));
  const DENIAL = { SELF: 'Owner self denied', TENANT: 'Tenant (on rent) denied', OTHER: 'Other reason' };
  const water = w.connection_numbers || [];
  const sewer = w.sewer_connection_numbers || [];
  const missing = w.missing_documents || [];
  const Item = ({ label, value }) => (
    <div className="flex justify-between gap-3 py-1 border-b last:border-0" style={{ borderColor: 'var(--phed-border)' }}>
      <span className="text-[11px] text-slate-500 shrink-0">{label}</span>
      <span className="text-xs font-medium text-right" style={{ color: 'var(--phed-ink)' }}>{value || '—'}</span>
    </div>
  );
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--phed-border)' }} data-testid="water-survey-details">
      <div className="font-semibold mb-1 flex items-center gap-1.5" style={{ color: 'var(--phed-ink)' }}>
        <Droplet className="w-4 h-4 text-blue-600" /> Water / Sewer survey
      </div>
      {w.document_pending && (
        <div className="rounded bg-orange-50 border border-orange-200 px-2 py-1.5 text-[11px] text-orange-700 mb-2" data-testid="doc-pending-flag">
          <Clock className="w-3 h-3 inline mr-1" /><b>Document Pending</b>{missing.length > 0 && <> — बाकी: {missing.map((m) => DOC_LABEL[m] || m).join(', ')}</>}
        </div>
      )}
      <Item label="Field decision" value={<Badge variant="outline" className="text-[10px]">{mode}</Badge>} />
      {w.denial_reason && <Item label="Denial reason" value={DENIAL[w.denial_reason] || w.denial_reason} />}
      <Item label="Mobile" value={<span className="font-mono"><Phone className="w-3 h-3 inline mr-0.5 text-slate-400" />{w.mobile || w.phone}</span>} />
      {w.alternate_mobile && <Item label="Alternate mobile" value={<span className="font-mono">{w.alternate_mobile}</span>} />}
      {(w.consumer_id || w.consumer_name) && <Item label="Consumer" value={<span>{w.consumer_name} {w.consumer_id ? <span className="font-mono text-slate-500">{w.consumer_id}</span> : null}</span>} />}
      {w.category && <Item label="Category" value={w.category} />}
      <Item label="Water conn." value={<span className="font-mono text-blue-700">{water.join(', ') || '—'}</span>} />
      <Item label="Sewer conn." value={<span className="font-mono text-teal-700">{sewer.join(', ') || '—'}</span>} />
      {w.owner_change && <Item label="Owner change" value={OWNER_CHANGE_LABEL[w.owner_change] || w.owner_change} />}
      {w.new_owner_name && <Item label="New owner" value={w.new_owner_name} />}
      {w.new_ward && <Item label="New ward" value={w.new_ward} />}
      {w.new_address && <Item label="New address" value={w.new_address} />}
    </div>
  );
}

function Flt({ label, value, onChange, options, testid }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1" data-testid={testid}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
