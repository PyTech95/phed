import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { toast } from 'sonner';
import axios from 'axios';
import { ShieldCheck, Search, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const LIMIT = 50;

const ACTION_TONE = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  APPROVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE: 'bg-sky-50 text-sky-700 border-sky-200',
  EDIT: 'bg-sky-50 text-sky-700 border-sky-200',
  RESET: 'bg-amber-50 text-amber-700 border-amber-200',
  DEACTIVATE: 'bg-amber-50 text-amber-700 border-amber-200',
  REJECT: 'bg-rose-50 text-rose-700 border-rose-200',
  DELETE: 'bg-rose-50 text-rose-700 border-rose-200',
  CLEANUP: 'bg-rose-50 text-rose-700 border-rose-200',
};

function actionTone(action) {
  const key = Object.keys(ACTION_TONE).find((k) => action.includes(k));
  return key ? ACTION_TONE[key] : 'bg-slate-50 text-slate-700 border-slate-200';
}

function formatTs(ts) {
  try { return new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ts; }
}

function summarize(log) {
  const d = log.details || {};
  if (d.after?.username) return `user "${d.after.username}"`;
  if (d.before?.username) return `user "${d.before.username}"`;
  if (d.username) return `user "${d.username}"`;
  if (d.after?.name && d.after?.code) return `${d.after.name} (${d.after.code})`;
  if (d.name && d.code) return `${d.name} (${d.code})`;
  if (d.count !== undefined) return `${d.count} item(s)`;
  if (d.deleted !== undefined) return `${d.deleted} deleted, ${d.properties_reset} reset`;
  if (d.fields) return `fields: ${d.fields.join(', ')}`;
  if (d.after?.status) return `→ ${d.after.status}${d.remarks || d.reason ? ` · "${d.remarks || d.reason}"` : ''}`;
  return log.target_id ? `#${String(log.target_id).slice(0, 8)}` : '—';
}

export default function AuditLog() {
  const { token } = useAuth();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: 'all', target_type: 'all', q: '', date_from: '', date_to: '' });
  const [qInput, setQInput] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput })); }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filters.action !== 'all') params.action = filters.action;
      if (filters.target_type !== 'all') params.target_type = filters.target_type;
      if (filters.q.trim()) params.q = filters.q.trim();
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      const res = await axios.get(`${API_URL}/admin/audit-log`, { params, headers: { Authorization: `Bearer ${token}` } });
      setLogs(res.data.logs || []);
      setTotal(res.data.total || 0);
      setActions(res.data.actions || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [token, page, filters]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const setFilter = (key, value) => { setPage(1); setFilters((f) => ({ ...f, [key]: value })); };
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <AdminLayout title="Audit Log">
      <div className="space-y-4" data-testid="audit-log-page">
        <Card className="border" style={{ borderColor: 'var(--phed-border)' }}>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--phed-muted)' }}>Search actor / target</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input data-testid="audit-search-input" className="pl-9" placeholder="username, name or id" value={qInput}
                  onChange={(e) => setQInput(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--phed-muted)' }}>Action</label>
              <Select value={filters.action} onValueChange={(v) => setFilter('action', v)}>
                <SelectTrigger data-testid="audit-action-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--phed-muted)' }}>Target</label>
              <Select value={filters.target_type} onValueChange={(v) => setFilter('target_type', v)}>
                <SelectTrigger data-testid="audit-target-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All targets</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="town">Town</SelectItem>
                  <SelectItem value="submission">Submission</SelectItem>
                  <SelectItem value="phed_survey">PHED survey</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--phed-muted)' }}>From</label>
              <Input data-testid="audit-date-from" type="date" value={filters.date_from} onChange={(e) => setFilter('date_from', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--phed-muted)' }}>To</label>
              <Input data-testid="audit-date-to" type="date" value={filters.date_to} onChange={(e) => setFilter('date_to', e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card className="border overflow-hidden" style={{ borderColor: 'var(--phed-border)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--phed-border)' }}>
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--phed-ink)' }}>
              <ShieldCheck className="w-4 h-4" style={{ color: 'var(--phed-blue)' }} />
              <span data-testid="audit-total">{total} record{total === 1 ? '' : 's'}</span>
              <span className="text-slate-400">· append-only, admin actions on users, towns and approvals</span>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchLogs} data-testid="audit-refresh-btn"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500" data-testid="audit-empty">No audit records match these filters.</div>
          ) : (
            <Table data-testid="audit-table">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Town</TableHead>
                  <TableHead className="hidden md:table-cell">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => setSelected(log)} data-testid={`audit-row-${log.id}`}>
                    <TableCell className="whitespace-nowrap text-xs">{formatTs(log.timestamp)}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium" style={{ color: 'var(--phed-ink)' }}>{log.actor_name || log.actor_username}</div>
                      <div className="text-[11px] text-slate-500">@{log.actor_username} · {log.actor_role}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className={`font-mono text-[10px] ${actionTone(log.action)}`}>{log.action}</Badge></TableCell>
                    <TableCell className="text-sm"><span className="text-slate-500 mr-1">{log.target_type}</span>{summarize(log)}</TableCell>
                    <TableCell className="text-xs">{log.town_code}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-slate-500">{log.ip_address || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-between px-4 py-3 border-t text-xs" style={{ borderColor: 'var(--phed-border)' }}>
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="audit-prev-btn"><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} data-testid="audit-next-btn"><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </Card>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl" data-testid="audit-detail-dialog">
          <DialogHeader><DialogTitle className="font-heading">Audit record</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">When:</span> {formatTs(selected.timestamp)}</div>
                <div><span className="text-slate-500">Action:</span> <span className="font-mono">{selected.action}</span></div>
                <div><span className="text-slate-500">Actor:</span> {selected.actor_name} (@{selected.actor_username}, {selected.actor_role})</div>
                <div><span className="text-slate-500">Target:</span> {selected.target_type} {selected.target_id || ''}</div>
                <div><span className="text-slate-500">Town:</span> {selected.town_code}</div>
                <div><span className="text-slate-500">IP / Request:</span> {selected.ip_address || '—'} / {selected.request_id || '—'}</div>
              </div>
              <pre className="rounded-md p-3 text-xs overflow-auto max-h-72 border" style={{ background: 'var(--phed-bg)', borderColor: 'var(--phed-border)' }}>
                {JSON.stringify(selected.details, null, 2)}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
