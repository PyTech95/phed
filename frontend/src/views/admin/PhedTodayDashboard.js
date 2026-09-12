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
  UserX,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { useAuth } from '../../context/AuthContext';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = API_URL + '/phed';

const outcomeLabels = {
  already_verified: 'Already connection verified',
  new_connection: 'New PHED connection',
  property_locked: 'Property locked',
  owner_denied: 'Owner denied',
  other: 'Other field report',
};

export default function PhedTodayDashboard() {
  const { getAuthHeader } = useAuth();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${PHED}/dashboard/today`, {
        headers: getAuthHeader(),
      });
      setReport(data);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeader]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = report?.summary || {};
  const primaryCards = [
    { label: 'Today’s surveys', value: summary.total, icon: ClipboardList, color: '#1565C0' },
    { label: 'In progress', value: summary.in_progress, icon: Clock3, color: '#F57C00' },
    { label: 'Awaiting approval', value: summary.awaiting_approval, icon: Clock3, color: '#D97706' },
    { label: 'Approved today', value: summary.approved, icon: CheckCircle2, color: '#2E7D32' },
  ];
  const outcomeCards = [
    { label: 'Already verified', value: summary.already_verified, icon: BadgeCheck, color: '#1E88E5' },
    { label: 'New PHED connection', value: summary.new_connection, icon: FilePlus2, color: '#5E35B1' },
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
            <p className="text-sm" style={{ color: 'var(--phed-muted)' }}>Daily field activity</p>
            <h2 className="mt-1 text-2xl font-bold" style={{ color: 'var(--phed-ink)' }}>
              Today’s PHED survey report
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--phed-muted)' }} data-testid="today-report-date">
              {report?.report_date || 'Loading today’s report…'}
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0"
            onClick={load}
            disabled={loading}
            data-testid="refresh-today-report-button"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </section>

        <MetricGroup cards={primaryCards} loading={loading} testid="today-primary-metrics" />

        <section>
          <h2 className="mb-3 text-lg font-semibold" style={{ color: 'var(--phed-ink)' }}>
            Today’s survey outcomes
          </h2>
          <MetricGroup cards={outcomeCards} loading={loading} testid="today-outcome-metrics" />
        </section>

        <section data-testid="today-surveyor-report">
          <h2 className="mb-3 text-lg font-semibold" style={{ color: 'var(--phed-ink)' }}>
            Surveyor-wise work today
          </h2>
          <Card className="clinic-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[790px] text-sm" data-testid="today-surveyor-table">
                <thead className="border-b bg-slate-50" style={{ borderColor: 'var(--phed-border)' }}>
                  <tr className="text-left text-xs uppercase" style={{ color: 'var(--phed-muted)' }}>
                    <th className="px-4 py-3 font-semibold">Surveyor</th>
                    <th className="px-3 py-3 text-right font-semibold">Total</th>
                    <th className="px-3 py-3 text-right font-semibold">Verified</th>
                    <th className="px-3 py-3 text-right font-semibold">New</th>
                    <th className="px-3 py-3 text-right font-semibold">Locked</th>
                    <th className="px-3 py-3 text-right font-semibold">Denied</th>
                    <th className="px-3 py-3 text-right font-semibold">Pending</th>
                    <th className="px-4 py-3 text-right font-semibold">Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && (report?.by_surveyor || []).length === 0 && (
                    <tr data-testid="today-surveyor-empty-row">
                      <td colSpan="8" className="px-4 py-10 text-center" style={{ color: 'var(--phed-muted)' }}>
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
                      <td className="px-3 py-3 text-right text-violet-700">{surveyor.new_connection}</td>
                      <td className="px-3 py-3 text-right">{surveyor.property_locked}</td>
                      <td className="px-3 py-3 text-right text-red-700">{surveyor.owner_denied}</td>
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
            Today’s submitted properties
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
                      <td className="px-3 py-3">{outcomeLabels[survey.outcome] || outcomeLabels.other}</td>
                      <td className="px-3 py-3">{survey.status}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--phed-muted)' }}>
                        {survey.submitted_at ? survey.submitted_at.replace('T', ' ').slice(0, 16) : '—'}
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