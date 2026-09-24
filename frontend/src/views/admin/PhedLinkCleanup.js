import { useState, useEffect, useCallback, useRef } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
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
  Search, Unlink, Loader2, ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react';

const PHED = process.env.REACT_APP_BACKEND_URL + '/api/phed';
const ANY = '__any__';
const SOURCE_LABELS = { office: 'Office receipt', import: 'Excel import', 'manual/bulk': 'Manual / bulk' };

export default function PhedLinkCleanup() {
  const { getAuthHeader } = useAuth();
  const H = () => ({ headers: getAuthHeader() });
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', colony: '', link_source: ANY });
  const [selected, setSelected] = useState({});
  const [confirmMode, setConfirmMode] = useState(null); // 'selected' | 'all'
  const [confirmText, setConfirmText] = useState('');
  const [removeSurveys, setRemoveSurveys] = useState(true);
  const [deleteConsumers, setDeleteConsumers] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setRows(null);
    const params = { page, limit: 25 };
    if (f.search.trim()) params.search = f.search.trim();
    if (f.colony.trim()) params.colony = f.colony.trim();
    if (f.link_source !== ANY) params.link_source = f.link_source;
    try {
      const { data } = await axios.get(`${PHED}/links`, { ...H(), params });
      if (requestId !== loadRequestRef.current) return;
      setRows(data.links); setTotal(data.total); setPages(data.pages); setSelected({});
    } catch (e) {
      if (requestId !== loadRequestRef.current) return;
      toast.error(e.response?.data?.detail || 'Failed to load links'); setRows([]); setTotal(0); setPages(0);
    }
  }, [page, f]);

  useEffect(() => {
    load();
    return () => { ++loadRequestRef.current; };
  }, [load]);

  const selectedRefs = Object.keys(selected).filter((k) => selected[k]);
  const allChecked = rows && rows.length > 0 && rows.every((r) => selected[r.consumer_ref]);
  const toggleAll = () => {
    const next = { ...selected };
    (rows || []).forEach((r) => { next[r.consumer_ref] = !allChecked; });
    setSelected(next);
  };

  const runUnlink = async () => {
    if (confirmText !== 'UNLINK') return toast.error('Type UNLINK to confirm');
    setBusy(true);
    const body = {
      confirm: 'UNLINK',
      remove_office_surveys: removeSurveys,
      delete_consumers: deleteConsumers,
    };
    if (confirmMode === 'all') {
      body.all_matching = true;
      if (f.colony.trim()) body.colony = f.colony.trim();
      if (f.link_source !== ANY) body.link_source = f.link_source;
    } else {
      body.consumer_refs = selectedRefs;
    }
    try {
      const { data } = await axios.post(`${PHED}/links/bulk-unlink`, body, H());
      toast.success(
        `${data.unlinked} link(s) removed · ${data.office_surveys_removed} office survey(s) removed · ${data.properties_unblocked} propert(ies) unblocked` +
        (data.deleted_consumers ? ` · ${data.deleted_consumers} consumer(s) deleted` : '')
      );
      setConfirmMode(null); setConfirmText(''); load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Unlink failed');
    } finally { setBusy(false); }
  };

  return (
    <AdminLayout title="Fix Wrong Links (Consumer ↔ Property)">
      <div className="p-4 md:p-6 space-y-4" data-testid="link-cleanup-page">
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="link-cleanup-warning">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Galat attachment hatayein</p>
            <p>Yahan woh saare PHED consumers dikhte hain jo kisi MC property se linked hain. Galat links select karke hatayein — property dobara survey ke liye open ho jayegi. Link karna hota hai to PHED Consumers page se karein.</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56">
                <label className="text-xs text-slate-500">Search (ID / name / phone / property)</label>
                <Input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (setPage(1), load())}
                  placeholder="Search…" data-testid="link-cleanup-search" />
              </div>
              <div className="w-48">
                <label className="text-xs text-slate-500">Colony</label>
                <Input value={f.colony} onChange={(e) => setF({ ...f, colony: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (setPage(1), load())}
                  placeholder="Colony name" data-testid="link-cleanup-colony" />
              </div>
              <div className="w-44">
                <label className="text-xs text-slate-500">Link source</label>
                <Select value={f.link_source} onValueChange={(v) => { setPage(1); setF({ ...f, link_source: v }); }}>
                  <SelectTrigger data-testid="link-cleanup-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>All sources</SelectItem>
                    <SelectItem value="office">Office receipt</SelectItem>
                    <SelectItem value="import">Excel import</SelectItem>
                    <SelectItem value="manual">Manual / bulk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={() => { setPage(1); load(); }} data-testid="link-cleanup-apply-filters">
                <Search className="w-4 h-4 mr-1.5" /> Apply
              </Button>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" disabled={selectedRefs.length === 0}
                  onClick={() => { setConfirmText(''); setConfirmMode('selected'); }}
                  data-testid="unlink-selected-btn">
                  <Unlink className="w-4 h-4 mr-1.5" /> Unlink selected ({selectedRefs.length})
                </Button>
                <Button variant="destructive" disabled={total === 0}
                  onClick={() => { setConfirmText(''); setConfirmMode('all'); }}
                  data-testid="unlink-all-btn">
                  <Unlink className="w-4 h-4 mr-1.5" /> Unlink all {total} matching
                </Button>
              </div>
            </div>

            {rows === null ? (
              <div className="flex justify-center py-10" data-testid="link-cleanup-loading"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            ) : rows.length === 0 ? (
              <p className="text-center text-slate-500 py-10" data-testid="link-cleanup-empty">Koi linked consumer nahi mila — sab clean hai.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input type="checkbox" checked={!!allChecked} onChange={toggleAll} data-testid="select-all-links-checkbox" />
                    </TableHead>
                    <TableHead>Consumer ID</TableHead>
                    <TableHead>Consumer Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Colony</TableHead>
                    <TableHead>Linked Property ID</TableHead>
                    <TableHead>Property Owner</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Property Survey</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.consumer_ref} data-testid={`link-row-${r.consumer_ref}`}>
                      <TableCell>
                        <input type="checkbox" checked={!!selected[r.consumer_ref]}
                          onChange={() => setSelected({ ...selected, [r.consumer_ref]: !selected[r.consumer_ref] })}
                          data-testid={`link-checkbox-${r.consumer_ref}`} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.consumer_id}</TableCell>
                      <TableCell>{r.consumer_name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.phone || '—'}</TableCell>
                      <TableCell>{r.colony_name || '—'}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{r.linked_property_number || '—'}</TableCell>
                      <TableCell>{r.property_owner || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{SOURCE_LABELS[r.link_source] || r.link_source}</Badge></TableCell>
                      <TableCell>
                        {r.property_survey_status
                          ? <Badge variant={r.property_survey_status === 'Approved' ? 'default' : 'secondary'}>{r.property_survey_status}</Badge>
                          : <span className="text-slate-400 text-xs">None</span>}
                        {r.has_office_survey && <Badge variant="outline" className="ml-1 text-amber-700 border-amber-300">auto-survey</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="link-cleanup-prev">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span data-testid="link-cleanup-pageinfo">Page {page} / {pages}</span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="link-cleanup-next">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!confirmMode} onOpenChange={(o) => !o && setConfirmMode(null)}>
        <DialogContent data-testid="unlink-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {confirmMode === 'all' ? `Unlink ALL ${total} matching links?` : `Unlink ${selectedRefs.length} selected link(s)?`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>Consumer ↔ property attachment hat jayegi (consumer data bana rahega).</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={removeSurveys} onChange={(e) => setRemoveSurveys(e.target.checked)} data-testid="remove-office-surveys-checkbox" />
              <span>Auto-created office surveys bhi delete karein aur properties ko dobara survey ke liye <b>unblock</b> karein (recommended)</span>
            </label>
            <label className="flex items-start gap-2 text-red-700">
              <input type="checkbox" checked={deleteConsumers} onChange={(e) => setDeleteConsumers(e.target.checked)} data-testid="delete-consumers-checkbox" />
              <span><b>Danger:</b> consumer records bhi permanently delete kar dein (connections samet)</span>
            </label>
            <div>
              <label className="text-xs text-slate-500">Confirm karne ke liye UNLINK type karein</label>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="UNLINK" data-testid="confirm-unlink-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmMode(null)} data-testid="unlink-cancel-btn">Cancel</Button>
            <Button variant="destructive" disabled={busy || confirmText !== 'UNLINK'} onClick={runUnlink} data-testid="confirm-unlink-btn">
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Unlink className="w-4 h-4 mr-1.5" />}
              Unlink now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
