import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent } from '../../components/ui/card';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Search, Droplet, Waves, Link2, Unlink, Plus, Eye, Download, ChevronLeft, ChevronRight, Loader2, Users, X, Building2, Trash2,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = API_URL + '/phed';
const SERVICES = ['Water', 'Sewer'];
const CATEGORIES = ['Domestic', 'Commercial', 'Domestic-SC', 'Other'];

const ANY = '__any__';

export default function PhedConsumers() {
  const { getAuthHeader } = useAuth();
  const H = () => ({ headers: getAuthHeader() });
  const [wards, setWards] = useState([]);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', ward_id: ANY, service: ANY, category: ANY, linked: ANY, source: ANY, colony: '' });
  const [detail, setDetail] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [connForm, setConnForm] = useState({ service: 'Water', connection_number: '', category: 'Domestic' });
  const [linkForm, setLinkForm] = useState('');
  // bulk auto-link
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState(null);
  const [chosen, setChosen] = useState({});
  const [applying, setApplying] = useState(false);
  // live suggestion dropdown for the search box
  const [suggest, setSuggest] = useState(null);
  const [showSuggest, setShowSuggest] = useState(false);
  // colony/locality-wise breakdown
  const [colonyOpen, setColonyOpen] = useState(false);
  const [colonies, setColonies] = useState(null);

  const openColonies = async () => {
    setColonyOpen(true); setColonies(null);
    try {
      const params = {};
      if (f.ward_id && f.ward_id !== ANY) params.ward_id = f.ward_id;
      const { data } = await axios.get(`${PHED}/consumers-by-locality`, { ...H(), params });
      setColonies(data);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load colonies'); setColonies({ localities: [] }); }
  };
  const pickColony = (loc) => { setPage(1); setF({ ...f, colony: loc === '(No locality)' ? '' : loc }); setColonyOpen(false); };

  const openBulk = async () => {
    setBulkOpen(true); setBulk(null); setChosen({});
    try {
      const { data } = await axios.get(`${PHED}/link-suggestions`, { ...H(), params: { limit: 300 } });
      setBulk(data);
      const pre = {}; (data.suggestions || []).forEach((s) => { if (s.confidence === 'high') pre[s.consumer_ref] = s.property_record_id; });
      setChosen(pre);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load suggestions'); setBulk({ suggestions: [] }); }
  };

  const applyBulk = async () => {
    const links = Object.entries(chosen).map(([consumer_ref, property_record_id]) => ({ consumer_ref, property_record_id }));
    if (links.length === 0) return toast.error('Select at least one suggestion');
    setApplying(true);
    try {
      const { data } = await axios.post(`${PHED}/link-suggestions/apply`, { links }, H());
      toast.success(`${data.linked} consumer(s) linked to properties`);
      setBulkOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Apply failed'); } finally { setApplying(false); }
  };

  const load = useCallback(async () => {
    setRows(null);
    const params = { page, limit: 25 };
    Object.entries(f).forEach(([k, v]) => { if (v && v !== ANY) params[k] = v; });
    try {
      const { data } = await axios.get(`${PHED}/consumers`, { ...H(), params });
      setRows(data.consumers); setTotal(data.total); setPages(data.pages);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load'); setRows([]); }
  }, [page, f]);

  useEffect(() => { axios.get(`${PHED}/wards`, H()).then((r) => setWards(r.data.wards || [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  // Debounced autocomplete: fetch ranked name/id/phone suggestions as the user types
  useEffect(() => {
    const q = f.search.trim();
    if (q.length < 2) { setSuggest(null); return undefined; }
    const t = setTimeout(async () => {
      try {
        const { data } = await axios.get(`${PHED}/consumers/search`, { ...H(), params: { q, limit: 8 } });
        setSuggest(data.results || []);
      } catch { setSuggest([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [f.search]);

  const openDetail = async (id) => {
    setDetailId(id); setDetail(null);
    try { const { data } = await axios.get(`${PHED}/consumers/${id}`, H()); setDetail(data); }
    catch { toast.error('Failed to load consumer'); }
  };

  const refreshDetail = async () => { if (detailId) { const { data } = await axios.get(`${PHED}/consumers/${detailId}`, H()); setDetail(data); } };

  const addConnection = async () => {
    if (!connForm.connection_number.trim()) return toast.error('Enter a connection number');
    try {
      await axios.post(`${PHED}/consumers/${detailId}/connections`, connForm, H());
      toast.success('Connection added');
      setConnForm({ service: 'Water', connection_number: '', category: 'Domestic' });
      refreshDetail(); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const [delTarget, setDelTarget] = useState(null);
  const [delAllOpen, setDelAllOpen] = useState(false);
  const [delConfirm, setDelConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const deleteConsumer = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`${PHED}/consumers/${delTarget.id}`, H());
      toast.success(`Consumer ${delTarget.consumer_id} deleted`);
      setDelTarget(null);
      if (detailId === delTarget.id) { setDetailId(null); setDetail(null); }
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); } finally { setDeleting(false); }
  };

  const deleteAll = async () => {
    setDeleting(true);
    try {
      const body = { confirm: delConfirm, ward_id: f.ward_id !== ANY ? f.ward_id : null };
      const { data } = await axios.post(`${PHED}/consumers/delete-all`, body, H());
      toast.success(`Deleted ${data.deleted_consumers} consumers, ${data.deleted_connections} connections`);
      setDelAllOpen(false); setDelConfirm(''); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); } finally { setDeleting(false); }
  };

  const removeConnection = async (cid) => {
    try { await axios.delete(`${PHED}/connections/${cid}`, H()); toast.success('Connection removed'); refreshDetail(); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const linkProperty = async () => {
    if (!linkForm.trim()) return toast.error('Enter a property record ID');
    try {
      await axios.post(`${PHED}/consumers/${detailId}/link`, { property_record_id: linkForm.trim(), confirm: true }, H());
      toast.success('Property linked'); setLinkForm(''); refreshDetail(); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Link failed'); }
  };

  const unlink = async () => {
    try { await axios.post(`${PHED}/consumers/${detailId}/unlink`, {}, H()); toast.success('Property unlinked'); refreshDetail(); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const exportData = async () => {
    const params = {}; Object.entries(f).forEach(([k, v]) => { if (v && v !== ANY) params[k] = v; });
    try {
      const res = await axios.get(`${PHED}/export`, { ...H(), params, responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = 'phed_export.xlsx';
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch { toast.error('Export failed'); }
  };

  const connBadges = (conns) => (conns || []).map((cn) => (
    <Badge key={cn.id} variant="outline" className="mr-1 font-mono text-[10px]"
      style={cn.service === 'Water' ? { color: '#1565C0', borderColor: '#90caf9' } : { color: '#00897B', borderColor: '#80cbc4' }}>
      {cn.service === 'Water' ? <Droplet className="w-3 h-3 mr-1 inline" /> : <Waves className="w-3 h-3 mr-1 inline" />}{cn.connection_number}
    </Badge>
  ));

  return (
    <AdminLayout title="PHED Consumers">
      <Card className="clinic-card mb-4">
        <CardContent className="p-4">
          <div className="grid md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <Label className="text-xs">Search</Label>
              <div className="relative mt-1">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400 z-10" />
                <Input className="pl-8" placeholder="Consumer ID, name, phone, connection…" value={f.search}
                  autoComplete="off"
                  onChange={(e) => { setPage(1); setShowSuggest(true); setF({ ...f, search: e.target.value }); }}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  data-testid="consumer-search-input" />
                {showSuggest && f.search.trim().length >= 2 && suggest && (
                  <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-80 overflow-auto"
                    style={{ borderColor: 'var(--phed-border)' }} data-testid="consumer-suggestions">
                    {suggest.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No matches</div>}
                    {suggest.map((s) => (
                      <button type="button" key={s.id}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-b-0 flex items-center justify-between gap-2"
                        style={{ borderColor: 'var(--phed-border)' }}
                        onMouseDown={(ev) => { ev.preventDefault(); setShowSuggest(false); openDetail(s.id); }}
                        data-testid={`suggest-${s.id}`}>
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-800 truncate">{s.consumer_name}</span>
                          <span className="block text-xs text-slate-500 truncate font-mono">
                            {s.consumer_id}
                            {(s.phone || s.phone_masked) ? ` · ${s.phone || s.phone_masked}` : ''}
                            {s.locality ? ` · ${s.locality}` : ''}
                          </span>
                        </span>
                        {s.match === 'exact' && <Badge variant="outline" className="text-[9px] shrink-0">exact</Badge>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Filter label="Ward" value={f.ward_id} onChange={(v) => { setPage(1); setF({ ...f, ward_id: v }); }}
              options={[[ANY, 'All wards'], ...wards.map((w) => [w.id, `Ward ${w.ward_number}`])]} testid="filter-ward" />
            <Filter label="Service" value={f.service} onChange={(v) => { setPage(1); setF({ ...f, service: v }); }}
              options={[[ANY, 'All'], ...SERVICES.map((s) => [s, s])]} testid="filter-service" />
            <Filter label="Category" value={f.category} onChange={(v) => { setPage(1); setF({ ...f, category: v }); }}
              options={[[ANY, 'All'], ...CATEGORIES.map((s) => [s, s])]} testid="filter-category" />
            <Filter label="Linked" value={f.linked} onChange={(v) => { setPage(1); setF({ ...f, linked: v }); }}
              options={[[ANY, 'All'], ['yes', 'Linked'], ['no', 'Unlinked']]} testid="filter-linked" />
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-sm flex items-center gap-2" style={{ color: 'var(--phed-muted)' }}>
              <span><Users className="w-4 h-4 inline mr-1" />{total} consumers</span>
              {f.colony && (
                <Badge variant="outline" className="gap-1" data-testid="active-colony-chip">
                  <Building2 className="w-3 h-3" /> {f.colony}
                  <button type="button" onClick={() => { setPage(1); setF({ ...f, colony: '' }); }} data-testid="clear-colony-btn"><X className="w-3 h-3" /></button>
                </Badge>
              )}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={openColonies} data-testid="colony-view-btn">
                <Building2 className="w-4 h-4 mr-1.5" /> Colony-wise
              </Button>
              <Button variant="outline" size="sm" onClick={openBulk} data-testid="bulk-link-btn">
                <Link2 className="w-4 h-4 mr-1.5" /> Auto-link properties
              </Button>
              <Button variant="outline" size="sm" onClick={exportData} data-testid="export-consumers-btn">
                <Download className="w-4 h-4 mr-1.5" /> Export
              </Button>
              <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => { setDelConfirm(''); setDelAllOpen(true); }} data-testid="delete-all-consumers-btn">
                <Trash2 className="w-4 h-4 mr-1.5" /> {f.ward_id !== ANY ? 'Delete ward data' : 'Delete all'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="clinic-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                {['Consumer ID', 'Name', 'F/H Name', 'Phone', 'Locality', 'Ward', 'Connections', 'Category', 'Property', 'Survey', ''].map((h) => <TableHead key={h}>{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {rows === null && <TableRow><TableCell colSpan={11} className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></TableCell></TableRow>}
                {rows?.length === 0 && <TableRow><TableCell colSpan={11} className="text-center py-10 text-slate-500">No consumers found. Import an Excel file to get started.</TableCell></TableRow>}
                {rows?.map((c) => (
                  <TableRow key={c.id} data-testid={`consumer-row-${c.id}`}>
                    <TableCell className="font-mono text-xs">{c.consumer_id}</TableCell>
                    <TableCell className="font-medium">{c.consumer_name}</TableCell>
                    <TableCell>{c.fh_name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{c.phone || c.phone_masked || '—'}</TableCell>
                    <TableCell>{c.locality || '—'}</TableCell>
                    <TableCell>{c.ward_number || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{connBadges(c.connections) }{(!c.connections || c.connections.length === 0) && '—'}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.category}</Badge></TableCell>
                    <TableCell className="text-xs">{c.linked_property ? c.linked_property.property_id : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.survey_status}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => openDetail(c.id)} data-testid={`view-consumer-${c.id}`}><Eye className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => setDelTarget(c)} data-testid={`delete-consumer-${c.id}`}><Trash2 className="w-4 h-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between p-3 border-t" style={{ borderColor: 'var(--phed-border)' }}>
              <span className="text-sm text-slate-500">Page {page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)} data-testid="consumers-prev"><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="consumers-next"><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) { setDetailId(null); setDetail(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="consumer-detail-dialog">
          <DialogHeader><DialogTitle style={{ color: 'var(--phed-ink)' }}>{detail?.consumer_name || 'Consumer'}</DialogTitle></DialogHeader>
          {!detail ? <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></div> : (
            <div className="space-y-5 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Field label="Consumer ID" value={detail.consumer_id} mono />
                <Field label="F/H Name" value={detail.fh_name} />
                <Field label="PPP ID" value={detail.ppp_id} />
                <Field label="Phone" value={detail.phone || detail.phone_masked} mono />
                <Field label="Address" value={detail.address} />
                <Field label="Locality" value={detail.locality} />
                <Field label="Ward" value={detail.ward_number} />
                <Field label="Category" value={detail.category} />
                <Field label="Source" value={detail.source} />
                <Field label="Status" value={detail.status} />
              </div>

              <div>
                <div className="font-semibold mb-2" style={{ color: 'var(--phed-ink)' }}>Connections</div>
                <div className="space-y-1.5">
                  {(detail.connections || []).length === 0 && <div className="text-slate-400 text-xs">No connections</div>}
                  {(detail.connections || []).map((cn) => (
                    <div key={cn.id} className="flex items-center justify-between rounded-lg border p-2" style={{ borderColor: 'var(--phed-border)' }}>
                      <span>{connBadges([cn])} <span className="text-xs text-slate-500">{cn.category} · {cn.source}</span></span>
                      <Button size="sm" variant="ghost" className="text-red-500 h-7" onClick={() => removeConnection(cn.id)} data-testid={`remove-conn-${cn.id}`}><X className="w-4 h-4" /></Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Select value={connForm.service} onValueChange={(v) => setConnForm({ ...connForm, service: v })}>
                    <SelectTrigger className="w-28" data-testid="conn-service-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input placeholder="Connection number" value={connForm.connection_number} onChange={(e) => setConnForm({ ...connForm, connection_number: e.target.value })} data-testid="conn-number-input" />
                  <Select value={connForm.category} onValueChange={(v) => setConnForm({ ...connForm, category: v })}>
                    <SelectTrigger className="w-36" data-testid="conn-category-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button onClick={addConnection} style={{ background: 'var(--phed-blue)' }} className="text-white shrink-0" data-testid="add-conn-btn"><Plus className="w-4 h-4" /></Button>
                </div>
              </div>

              <div>
                <div className="font-semibold mb-2" style={{ color: 'var(--phed-ink)' }}>Linked property</div>
                {detail.linked_property ? (
                  <div className="flex items-center justify-between rounded-lg border p-2.5" style={{ borderColor: 'var(--phed-border)' }}>
                    <div><span className="font-mono text-xs">{detail.linked_property.property_id}</span> — {detail.linked_property.owner_name}</div>
                    <Button size="sm" variant="outline" className="text-red-500" onClick={unlink} data-testid="unlink-property-btn"><Unlink className="w-4 h-4 mr-1" /> Unlink</Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input placeholder="Property record ID" value={linkForm} onChange={(e) => setLinkForm(e.target.value)} data-testid="link-property-input" />
                    <Button onClick={linkProperty} style={{ background: 'var(--phed-teal)' }} className="text-white shrink-0" data-testid="link-property-btn"><Link2 className="w-4 h-4 mr-1" /> Link</Button>
                  </div>
                )}
              </div>

              {detail.surveys?.length > 0 && (
                <div>
                  <div className="font-semibold mb-2" style={{ color: 'var(--phed-ink)' }}>Survey history</div>
                  {detail.surveys.map((s) => (
                    <div key={s.id} className="text-xs flex justify-between border-b py-1" style={{ borderColor: 'var(--phed-border)' }}>
                      <span>{s.survey_type} · {s.surveyor_name || '—'}</span><Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => { setDetailId(null); setDetail(null); }}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent className="max-w-md" data-testid="delete-consumer-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-red-600"><Trash2 className="w-5 h-5" /> Delete consumer</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Delete <strong>{delTarget?.consumer_name}</strong> (ID <span className="font-mono">{delTarget?.consumer_id}</span>) and all its connections? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={deleteConsumer} disabled={deleting} data-testid="confirm-delete-consumer-btn">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delAllOpen} onOpenChange={(o) => { setDelAllOpen(o); if (!o) setDelConfirm(''); }}>
        <DialogContent className="max-w-md" data-testid="delete-all-consumers-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-red-600"><Trash2 className="w-5 h-5" /> {f.ward_id !== ANY ? 'Delete this ward\'s consumer data' : 'Delete ALL consumer data'}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            This permanently removes {f.ward_id !== ANY ? 'every consumer and connection in the selected ward' : <strong>all {total} consumers and their connections</strong>}. Properties and surveys are not deleted.
          </p>
          <div className="space-y-1">
            <Label className="text-xs">Type <span className="font-mono font-bold">DELETE</span> to confirm</Label>
            <Input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder="DELETE" data-testid="delete-all-confirm-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelAllOpen(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={deleteAll} disabled={deleting || delConfirm !== 'DELETE'} data-testid="confirm-delete-all-btn">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Colony-wise breakdown dialog */}
      <Dialog open={colonyOpen} onOpenChange={setColonyOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="colony-dialog">
          <DialogHeader><DialogTitle style={{ color: 'var(--phed-ink)' }}>Consumers by colony / locality</DialogTitle></DialogHeader>
          {!colonies ? <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></div> : (
            <div className="space-y-3 text-sm">
              <p className="text-xs" style={{ color: 'var(--phed-muted)' }}>
                {colonies.total_localities} colonies · {colonies.total_consumers} consumers{(f.ward_id && f.ward_id !== ANY) ? ' (selected ward)' : ''}. Click a colony to filter the list.
              </p>
              {(colonies.localities || []).length === 0 ? (
                <div className="py-8 text-center text-slate-500">No consumers yet.</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {colonies.localities.map((l) => (
                    <button type="button" key={l.locality}
                      className="text-left rounded-xl border p-3 hover:bg-blue-50 transition-colors"
                      style={{ borderColor: 'var(--phed-border)' }}
                      onClick={() => pickColony(l.locality)}
                      data-testid={`colony-card-${l.locality}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate flex items-center gap-1.5" style={{ color: 'var(--phed-ink)' }}>
                          <Building2 className="w-4 h-4 shrink-0" style={{ color: 'var(--phed-blue)' }} /> {l.locality}
                        </span>
                        <Badge style={{ background: 'var(--phed-blue-soft)', color: 'var(--phed-blue)' }} className="shrink-0">{l.count}</Badge>
                      </div>
                      <div className="text-[11px] mt-1" style={{ color: 'var(--phed-muted)' }}>
                        {l.linked} linked · {l.unlinked} unlinked
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk auto-link dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="bulk-link-dialog">
          <DialogHeader><DialogTitle style={{ color: 'var(--phed-ink)' }}>Auto-link consumers to properties</DialogTitle></DialogHeader>
          {!bulk ? <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></div> : (
            <div className="space-y-3 text-sm">
              <p className="text-xs" style={{ color: 'var(--phed-muted)' }}>
                {bulk.total_unlinked} unlinked consumers · {bulk.properties_available} properties · {(bulk.suggestions || []).length} suggested matches (by phone, address & owner name). High-confidence matches (e.g. phone match) are pre-selected. Review before applying.
              </p>
              {(bulk.suggestions || []).length === 0 ? (
                <div className="py-8 text-center text-slate-500">
                  {bulk.properties_available === 0 ? 'No MC properties uploaded yet — upload property data first, then run auto-link.' : 'No confident matches found.'}
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { const all = {}; bulk.suggestions.forEach((s) => { all[s.consumer_ref] = s.property_record_id; }); setChosen(all); }}>Select all</Button>
                    <Button size="sm" variant="outline" onClick={() => setChosen({})}>Clear</Button>
                    <span className="text-xs self-center text-slate-500">{Object.keys(chosen).length} selected</span>
                  </div>
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--phed-border)' }}>
                    <Table>
                      <TableHeader><TableRow>{['', 'Consumer', 'Consumer address', 'Suggested property', 'Confidence'].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
                      <TableBody>
                        {bulk.suggestions.map((s) => (
                          <TableRow key={s.consumer_ref} data-testid={`suggestion-${s.consumer_ref}`}>
                            <TableCell>
                              <input type="checkbox" checked={!!chosen[s.consumer_ref]}
                                onChange={(e) => setChosen((c) => { const n = { ...c }; if (e.target.checked) n[s.consumer_ref] = s.property_record_id; else delete n[s.consumer_ref]; return n; })}
                                data-testid={`suggestion-check-${s.consumer_ref}`} />
                            </TableCell>
                            <TableCell><div className="font-medium">{s.consumer_name}</div><div className="font-mono text-[10px] text-slate-500">{s.consumer_id}</div></TableCell>
                            <TableCell className="text-xs text-slate-500 max-w-[180px] truncate">{s.consumer_address} {s.consumer_locality}</TableCell>
                            <TableCell><div className="font-mono text-xs">{s.property_id}</div><div className="text-[10px] text-slate-500 truncate max-w-[180px]">{s.property_owner} · {s.property_address}</div></TableCell>
                            <TableCell><Badge className={`text-[10px] ${s.confidence === 'high' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{s.confidence}</Badge>{s.reason && <div className="text-[9px] text-slate-400 mt-0.5">{s.reason}</div>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={applyBulk} disabled={applying || !bulk?.suggestions?.length} className="text-white" style={{ background: 'var(--phed-teal)' }} data-testid="apply-bulk-link-btn">
              {applying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />} Link selected ({Object.keys(chosen).length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function Filter({ label, value, onChange, options, testid }) {
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

function Field({ label, value, mono }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--phed-muted)' }}>{label}</div>
      <div className={mono ? 'font-mono text-sm' : 'text-sm'} style={{ color: 'var(--phed-ink)' }}>{value || '—'}</div>
    </div>
  );
}
