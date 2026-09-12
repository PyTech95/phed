import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import {
  Users, Droplet, Waves, Link2, ClipboardList, CheckCircle2, XCircle, Clock,
  MapPin, Building2, UserCheck, GitMerge, AlertTriangle, FilePlus, HelpCircle,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = API_URL + '/phed';
const ANY = '__any__';

export default function PhedDashboard() {
  const { getAuthHeader } = useAuth();
  const H = () => ({ headers: getAuthHeader() });
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ wards: [], colonies: [], surveyors: [], statuses: [] });
  const [f, setF] = useState({ ward_id: ANY, colony: ANY, surveyor_id: ANY, status: ANY, service: ANY, category: ANY, source: ANY, linked: ANY, date_from: '', date_to: '' });

  useEffect(() => { axios.get(`${PHED}/filters`, H()).then((r) => setFilters(r.data)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setStats(null);
    const params = {}; Object.entries(f).forEach(([k, v]) => { if (v && v !== ANY) params[k] = v; });
    try { const { data } = await axios.get(`${PHED}/dashboard`, { ...H(), params }); setStats(data); }
    catch { setStats({}); }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const s = stats || {};
  const cards = [
    { label: 'Total Existing Properties', value: s.total_properties, icon: Building2, color: '#1565C0' },
    { label: 'PHED Target Properties', value: s.target_properties, icon: MapPin, color: '#1565C0' },
    { label: 'PHED Surveys Pending', value: s.properties_pending, icon: Clock, color: '#F57C00' },
    { label: 'PHED Surveys In Progress', value: s.properties_in_progress, icon: Clock, color: '#FB8C00' },
    { label: 'PHED Surveys Completed', value: s.properties_completed, icon: CheckCircle2, color: '#2E7D32' },
    { label: 'Properties Linked with PHED', value: s.properties_linked, icon: Link2, color: '#00897B' },
    { label: 'Properties Not Linked', value: s.properties_not_linked, icon: XCircle, color: '#757575' },
    { label: 'No PHED Connection', value: s.properties_no_connection, icon: XCircle, color: '#6D4C41' },
    { label: 'New/Unlisted Connections', value: s.new_unlisted_connections, icon: UserCheck, color: '#5E35B1' },
    { label: 'Total Consumers', value: s.total_consumers, icon: Users, color: '#1565C0' },
    { label: 'Total Connections', value: s.total_connections, icon: Link2, color: '#1565C0' },
    { label: 'Water Connections', value: s.water_connections, icon: Droplet, color: '#1E88E5' },
    { label: 'Sewer Connections', value: s.sewer_connections, icon: Waves, color: '#00897B' },
    { label: 'Properties with Multiple Connections', value: s.properties_multi_connection, icon: GitMerge, color: '#5E35B1' },
    { label: 'Submitted Surveys', value: s.submitted_surveys, icon: Clock, color: '#1E88E5' },
    { label: 'Approved Surveys', value: s.approved_surveys, icon: CheckCircle2, color: '#2E7D32' },
    { label: 'New Connection (survey)', value: (s.by_outcome || {}).new_connection, icon: FilePlus, color: '#5E35B1' },
    { label: 'Property Locked', value: (s.by_outcome || {}).property_locked, icon: HelpCircle, color: '#455A64' },
    { label: 'Owner Denied', value: (s.by_outcome || {}).owner_denied, icon: XCircle, color: '#C62828' },
    { label: 'Has Connection', value: (s.by_outcome || {}).has_connection, icon: Droplet, color: '#1E88E5' },
    { label: 'Rejected / Review Required', value: (s.rejected_surveys || 0) + (s.review_surveys || 0), icon: AlertTriangle, color: '#C62828' },
    { label: 'Completed Wards', value: s.completed_wards, icon: CheckCircle2, color: '#2E7D32' },
    { label: 'Completed Colonies', value: s.completed_colonies, icon: CheckCircle2, color: '#2E7D32' },
    { label: 'Active Surveyors', value: s.active_surveyors, icon: UserCheck, color: '#00897B' },
  ];

  const bySurvey = s.by_survey_type || {};

  return (
    <AdminLayout title="PHED Dashboard">
      <Card className="clinic-card mb-5">
        <CardContent className="p-4 grid md:grid-cols-4 gap-3">
          <Flt label="Ward" value={f.ward_id} onChange={(v) => setF({ ...f, ward_id: v })}
            options={[[ANY, 'All wards'], ...(filters.wards || []).map((w) => [w.id, `Ward ${w.ward_number}`])]} testid="dash-filter-ward" />
          <Flt label="Colony" value={f.colony} onChange={(v) => setF({ ...f, colony: v })}
            options={[[ANY, 'All colonies'], ...(filters.colonies || []).map((c) => [c, c])]} testid="dash-filter-colony" />
          <Flt label="Surveyor" value={f.surveyor_id} onChange={(v) => setF({ ...f, surveyor_id: v })}
            options={[[ANY, 'All surveyors'], ...(filters.surveyors || []).map((u) => [u.id, u.name])]} testid="dash-filter-surveyor" />
          <Flt label="Survey status" value={f.status} onChange={(v) => setF({ ...f, status: v })}
            options={[[ANY, 'All statuses'], ...(filters.statuses || []).map((st) => [st, st])]} testid="dash-filter-status" />
          <Flt label="Service" value={f.service} onChange={(v) => setF({ ...f, service: v })}
            options={[[ANY, 'Water + Sewer'], ...(filters.services || []).map((x) => [x, x])]} testid="dash-filter-service" />
          <Flt label="Category" value={f.category} onChange={(v) => setF({ ...f, category: v })}
            options={[[ANY, 'All categories'], ...(filters.categories || []).map((x) => [x, x])]} testid="dash-filter-category" />
          <Flt label="Existing / New" value={f.source} onChange={(v) => setF({ ...f, source: v })}
            options={[[ANY, 'Existing + New'], ...(filters.sources || [])]} testid="dash-filter-source" />
          <Flt label="Linked" value={f.linked} onChange={(v) => setF({ ...f, linked: v })}
            options={[[ANY, 'Linked + Unlinked'], ...(filters.linked || [])]} testid="dash-filter-linked" />
          <div><div className="text-[11px] font-medium mb-1" style={{ color: 'var(--phed-muted)' }}>From</div>
            <input type="date" className="h-9 w-full rounded-md border px-2 text-sm" style={{ borderColor: 'var(--phed-border)' }} value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} data-testid="dash-filter-from" /></div>
          <div><div className="text-[11px] font-medium mb-1" style={{ color: 'var(--phed-muted)' }}>To</div>
            <input type="date" className="h-9 w-full rounded-md border px-2 text-sm" style={{ borderColor: 'var(--phed-border)' }} value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} data-testid="dash-filter-to" /></div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="clinic-card" data-testid={`stat-${c.label.replace(/\s+/g, '-').toLowerCase()}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--phed-muted)' }}>{c.label}</span>
                <c.icon className="w-5 h-5" style={{ color: c.color }} />
              </div>
              <div className="text-3xl font-extrabold mt-2" style={{ color: 'var(--phed-ink)' }}>{stats === null ? '…' : (c.value ?? 0)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="clinic-card mt-5">
        <CardContent className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--phed-ink)' }}>Surveys by type</div>
          <div className="grid grid-cols-3 gap-4">
            {[['Existing linked', bySurvey.existing_linked, ClipboardList, '#1565C0'],
              ['New / unlisted', bySurvey.new_unlisted, FilePlus, '#00897B'],
              ['No connection', bySurvey.no_connection, HelpCircle, '#F57C00']].map(([label, val, Icon, color]) => (
              <div key={label} className="rounded-xl border p-4" style={{ borderColor: 'var(--phed-border)' }}>
                <Icon className="w-5 h-5 mb-1" style={{ color }} />
                <div className="text-2xl font-bold" style={{ color: 'var(--phed-ink)' }}>{val ?? 0}</div>
                <div className="text-xs" style={{ color: 'var(--phed-muted)' }}>{label}</div>
              </div>
            ))}
          </div>
          {s.gps_flagged > 0 && (
            <div className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {s.gps_flagged} survey(s) flagged for large GPS drift — needs review.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="clinic-card mt-5">
        <CardContent className="p-5">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--phed-ink)' }}>
            <UserCheck className="w-4 h-4" /> Surveyor-wise progress
          </div>
          {(s.by_surveyor || []).length === 0 ? (
            <div className="text-sm py-3" style={{ color: 'var(--phed-muted)' }}>अभी किसी surveyor ने survey नहीं किया।</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="surveyor-progress-table">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--phed-muted)' }}>
                    <th className="py-2 pr-3 font-medium">Surveyor</th>
                    <th className="py-2 px-3 font-medium text-right">Today / Target</th>
                    <th className="py-2 px-3 font-medium text-right">Total</th>
                    <th className="py-2 px-3 font-medium text-right">Yellow (pending approval)</th>
                    <th className="py-2 pl-3 font-medium text-right">Green (approved)</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.by_surveyor || []).map((sv) => {
                    const pct = Math.min(100, Math.round(((sv.today || 0) / (sv.target || 1)) * 100));
                    const met = (sv.today || 0) >= (sv.target || 0);
                    return (
                    <tr key={sv.id} className="border-t" style={{ borderColor: 'var(--phed-border)' }} data-testid={`surveyor-row-${sv.id}`}>
                      <td className="py-2 pr-3 font-medium" style={{ color: 'var(--phed-ink)' }}>{sv.name}</td>
                      <td className="py-2 px-3 text-right">
                        <span className={`font-semibold ${met ? 'text-green-600' : 'text-slate-700'}`} data-testid={`surveyor-today-${sv.id}`}>{sv.today || 0}</span>
                        <span className="text-slate-400"> / {sv.target}</span>
                        <div className="mt-1 h-1.5 w-24 ml-auto rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: met ? '#16a34a' : '#F59E0B' }} />
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right">{sv.total}</td>
                      <td className="py-2 px-3 text-right text-amber-600 font-semibold">{sv.pending}</td>
                      <td className="py-2 pl-3 text-right text-green-600 font-semibold">{sv.approved}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
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
