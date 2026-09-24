import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FilePlus2,
  Link2,
  Lock,
  RefreshCw,
  RotateCcw,
  UserX,
  X,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { IndianDateInput } from '../../components/IndianDateInput';
import { useAuth } from '../../context/AuthContext';
import { ConnectionTypeBadge } from '../../components/ConnectionStatus';
import { formatISTDateTime, formatIndianDate } from '../../lib/indianDateTime';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = API_URL + '/phed';

export default function PhedTodayDashboard() {
  const { getAuthHeader } = useAuth();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState('today');
  const [options, setOptions] = useState({ wards: [], colonies: [] });
  const [f, setF] = useState({ ward_id: '', colony: '', date_from: '', date_to: '' });

  useEffect(() => {
    axios.get(`${PHED}/filters`, { headers: getAuthHeader() })
      .then((r) => setOptions({ wards: r.data.wards || [], colonies: r.data.colonies || [] }))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (scope === 'all') params.scope = 'all';
      if (f.ward_id) params.ward_id = f.ward_id;
      if (f.colony) params.colony = f.colony;
      if (f.date_from) params.date_from = f.date_from;
      if (f.date_to) params.date_to = f.date_to;
      const { data } = await axios.get(`${PHED}/dashboard/today`, {
        headers: getAuthHeader(),
        params,
      });
      setReport(data);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeader, scope, f]);

  useEffect(() => {
    load();
  }, [load]);

  const filtersActive = !!(f.ward_id || f.colony || f.date_from || f.date_to);
  const resetFilters = () => setF({ ward_id: '', colony: '', date_from: '', date_to: '' });

  const summary = report?.summary || {};
  const primaryCards = [
    { label: scope === 'all' ? 'Total surveys' : 'Today’s surveys', value: summary.total, icon: ClipboardList, color: '#1565C0' },
    { label: 'In progress', value: summary.in_progress, icon: Clock3, color: '#F57C00' },
    { label: 'Awaiting approval', value: summary.awaiting_approval, icon: Clock3, color: '#D97706' },
    { label: scope === 'all' ? 'Approved' : 'Approved today', value: summary.approved, icon: CheckCircle2, color: '#2E7D32' },
    { label: 'Returned for correction', value: summary.returned_for_correction, icon: RotateCcw, color: '#EA580C' },
    { label: 'Marked pending', value: summary.marked_pending, icon: Clock3, color: '#B45309' },
    { label: 'Auto-linked / locked', value: summary.locked_consumers, icon: Lock, color: '#0F766E' },
    { label: 'Locked (imported)', value: summary.locked_consumers_imported, icon: Lock, color: '#334155' },
  ];
  const outcomeCards = [
    { label: 'Already Connection', value: summary.already_verified, icon: BadgeCheck, color: '#15803D' },
    { label: 'Water Connection Only', value: summary.water_connection, icon: BadgeCheck, color: '#1D4ED8' },
    { label: 'Sewer Connection Only', value: summary.sewer_connection, icon: BadgeCheck, color: '#C2410C' },
    { label: 'New Connection', value: summary.new_connection, icon: FilePlus2, color: '#0F766E' },
    { label: 'Death Transfer', value: summary.death_transfer, icon: FilePlus2, color: '#BE123C' },
    { label: 'Ownership Change', value: summary.ownership_change, icon: FilePlus2, color: '#A16207' },
    { label: 'Property locked', value: summary.property_locked, icon: Lock, color: '#455A64' },
    { label: 'Owner denied', value: summary.owner_denied, icon: UserX, color: '#C62828' },
    { label: 'No PHED connection', value: summary.no_phed_connection, icon: UserX, color: '#6D4C41' },
    { label: 'Properties linked', value: summary.properties_linked, icon: Link2, color: '#00897B' },
  ];

  return (
    <AdminLayout title="Today’s PHED Report">
      <div className="space-y-7" data-testid="today-phed-dashboard">
        <section className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm" style={{ color: 'var(--phed-muted)' }}>{scope === 'all' ? 'All-time field activity' : 'Daily field activity'}</p>
            <h2 className="mt-1 text-2xl font-bold" style={{ color: 'var(--phed-ink)' }}>
              {scope === 'all' ? 'All-time PHED survey report' : 'Today’s PHED survey report'}
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--phed-muted)' }} data-testid="today-report-date">
              {f.date_from || f.date_to
                ? `${f.date_from ? formatIndianDate(f.date_from) : 'Shuruaat'} – ${f.date_to ? formatIndianDate(f.date_to) : 'Aaj'} · IST`
                : scope === 'all'
                ? 'Poora data — shuruaat se ab tak · IST'
                : (report?.report_date ? `${formatIndianDate(report.report_date)} · IST` : 'Loading today’s report…')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--phed-border)' }} data-testid="report-scope-toggle">
              <button
                type="button"
                onClick={() => setScope('today')}
                className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${scope === 'today' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                data-testid="report-scope-today"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${scope === 'all' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                data-testid="report-scope-all"
              >
                All-time
              </button>
            </div>
            <Button
              variant="outline"
              onClick={load}
              disabled={loading}
              data-testid="refresh-today-report-button"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </section>

        <Card className="clinic-card" data-testid="report-filters-card">
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label className="text-xs">Colony</Label>
              <Input
                list="report-colony-options"
                value={f.colony}
                placeholder="Search colony name"
                onChange={(e) => setF({ ...f, colony: e.target.value })}
                className="mt-1"
                data-testid="report-filter-colony"
              />
              <datalist id="report-colony-options">
                {options.colonies.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <Label className="text-xs">From date (IST)</Label>
              <IndianDateInput
                value={f.date_from}
                onChange={(value) => setF({ ...f, date_from: value })}
                label="From date"
                testId="report-filter-date-from"
              />
            </div>
            <div>
              <Label className="text-xs">To date (IST)</Label>
              <IndianDateInput
                value={f.date_to}
                onChange={(value) => setF({ ...f, date_to: value })}
                label="To date"
                testId="report-filter-date-to"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                className="w-full"
                onClick={resetFilters}
                disabled={!filtersActive}
                data-testid="report-filter-reset"
              >
                <X className="mr-2 h-4 w-4" /> Clear filters
              </Button>
            </div>
          </CardContent>
        </Card>

        <MetricGroup cards={primaryCards} loading={loading} testid="today-primary-metrics" />

        <section>
          <h2 className="mb-3 text-lg font-semibold" style={{ color: 'var(--phed-ink)' }}>
            {scope === 'all' ? 'All-time survey outcomes' : 'Today’s survey outcomes'}
          </h2>
          <MetricGroup cards={outcomeCards} loading={loading} testid="today-outcome-metrics" />
        </section>

        <section data-testid="today-surveyor-report">
          <h2 className="mb-3 text-lg font-semibold" style={{ color: 'var(--phed-ink)' }}>
            {scope === 'all' ? 'Surveyor-wise work (all-time)' : 'Surveyor-wise work today'}
          </h2>
          <Card className="clinic-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm" data-testid="today-surveyor-table">
                <thead className="border-b bg-slate-50" style={{ borderColor: 'var(--phed-border)' }}>
                  <tr className="text-left text-xs uppercase" style={{ color: 'var(--phed-muted)' }}>
                    <th className="px-4 py-3 font-semibold">Surveyor</th>
                    <th className="px-3 py-3 text-right font-semibold">Total</th>
                    <th className="px-3 py-3 text-right font-semibold">Both connected</th>
                    <th className="px-3 py-3 text-right font-semibold">Water only</th>
                    <th className="px-3 py-3 text-right font-semibold">Sewer only</th>
                    <th className="px-3 py-3 text-right font-semibold">Death transfer</th>
                    <th className="px-3 py-3 text-right font-semibold">Ownership change</th>
                    <th className="px-3 py-3 text-right font-semibold">New</th>
                    <th className="px-3 py-3 text-right font-semibold">Locked</th>
                    <th className="px-3 py-3 text-right font-semibold">Denied</th>
                    <th className="px-3 py-3 text-right font-semibold">Returned</th>
                    <th className="px-3 py-3 text-right font-semibold">Pending</th>
                    <th className="px-4 py-3 text-right font-semibold">Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && (report?.by_surveyor || []).length === 0 && (
                    <tr data-testid="today-surveyor-empty-row">
                      <td colSpan="13" className="px-4 py-10 text-center" style={{ color: 'var(--phed-muted)' }}>
                        No PHED survey activity recorded today.
                      </td>
                    </tr>
                  )}
                  {(report?.by_surveyor || []).map((surveyor) => (
                    <tr
                      key={surveyor.id}
                      className="border-b last:border-0"
                      style={{ borderColor: 'var(--phed-border)' }}
                      data-testid={`today-surveyor-row-${surveyor.id}`}
                    >
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--phed-ink)' }}>
                        {surveyor.name}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">{surveyor.total}</td>
                      <td className="px-3 py-3 text-right text-blue-700">{surveyor.already_verified}</td>
                      <td className="px-3 py-3 text-right" data-testid={`today-water-only-${surveyor.id}`}>{surveyor.water_connection ?? 0}</td>
                      <td className="px-3 py-3 text-right" data-testid={`today-sewer-only-${surveyor.id}`}>{surveyor.sewer_connection ?? 0}</td>
                      <td className="px-3 py-3 text-right" data-testid={`today-death-transfer-${surveyor.id}`}>{surveyor.death_transfer ?? 0}</td>
                      <td className="px-3 py-3 text-right" data-testid={`today-ownership-change-${surveyor.id}`}>{surveyor.ownership_change ?? 0}</td>
                      <td className="px-3 py-3 text-right text-violet-700">{surveyor.new_connection}</td>
                      <td className="px-3 py-3 text-right">{surveyor.property_locked}</td>
                      <td className="px-3 py-3 text-right text-red-700">{surveyor.owner_denied}</td>
                      <td className="px-3 py-3 text-right font-semibold text-orange-700" data-testid={`today-returned-${surveyor.id}`}>{surveyor.returned_for_correction ?? 0}</td>
                      <td className="px-3 py-3 text-right text-amber-700">{surveyor.awaiting_approval}</td>
                      <td className="px-4 py-3 text-right text-green-700">{surveyor.approved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <section data-testid="today-recent-report">
          <h2 className="mb-3 text-lg font-semibold" style={{ color: 'var(--phed-ink)' }}>
            {scope === 'all' ? 'Recently submitted properties' : 'Today’s submitted properties'}
          </h2>
          <Card className="clinic-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[660px] text-sm" data-testid="today-recent-surveys-table">
                <thead className="border-b bg-slate-50" style={{ borderColor: 'var(--phed-border)' }}>
                  <tr className="text-left text-xs uppercase" style={{ color: 'var(--phed-muted)' }}>
                    <th className="px-4 py-3 font-semibold">Property ID</th>
                    <th className="px-3 py-3 font-semibold">Surveyor</th>
                    <th className="px-3 py-3 font-semibold">Report</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && (report?.recent_surveys || []).length === 0 && (
                    <tr data-testid="today-recent-empty-row">
                      <td colSpan="5" className="px-4 py-10 text-center" style={{ color: 'var(--phed-muted)' }}>
                        No submitted PHED surveys today.
                      </td>
                    </tr>
                  )}
                  {(report?.recent_surveys || []).map((survey) => (
                    <tr
                      key={survey.id}
                      className="border-b last:border-0"
                      style={{ borderColor: 'var(--phed-border)' }}
                      data-testid={`today-recent-survey-${survey.id}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium">{survey.property_id}</td>
                      <td className="px-3 py-3">{survey.surveyor_name}</td>
                      <td className="px-3 py-3"><ConnectionTypeBadge survey={survey} testId={`today-connection-${survey.id}`} /></td>
                      <td className="px-3 py-3">{survey.status}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--phed-muted)' }} data-testid={`today-submitted-${survey.id}`}>
                        {formatISTDateTime(survey.submitted_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </div>
    </AdminLayout>
  );
}

function MetricGroup({ cards, loading, testid }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" data-testid={testid}>
      {cards.map((card) => (
        <Card key={card.label} className="clinic-card">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--phed-muted)' }}>
                {card.label}
              </span>
              <card.icon className="h-5 w-5 shrink-0" style={{ color: card.color }} />
            </div>
            <div
              className="mt-2 text-3xl font-extrabold"
              style={{ color: 'var(--phed-ink)' }}
              data-testid={`${testid}-${card.label.replace(/\s+/g, '-').toLowerCase()}`}
            >
              {loading ? '…' : (card.value ?? 0)}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}