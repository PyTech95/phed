import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import {
  CheckCircle, ArrowRight, FileSpreadsheet, TrendingUp,
  CalendarCheck, Camera, Loader2, Droplet, ClipboardList
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

// Connection-type tiles (colours match the admin "today" report)
const CONNECTION_TILES = [
  { key: 'my_already_connection', label: 'Already Connection', color: '#15803D' },
  { key: 'my_water_connection', label: 'Water Connection', color: '#1D4ED8' },
  { key: 'my_sewer_connection', label: 'Sewer Connection', color: '#C2410C' },
  { key: 'my_new_connection', label: 'New Connection', color: '#B45309' },
  { key: 'my_ownership_change', label: 'Ownership Change', color: '#7C3AED' },
  { key: 'my_death_transfer', label: 'Death Transfer', color: '#B91C1C' },
];

export default function EmployeeDashboard() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [phed, setPhed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasAttendance, setHasAttendance] = useState(false);
  const [attendanceData, setAttendanceData] = useState(null);

  useEffect(() => {
    const refresh = () => fetchPhed();
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    fetchPhed();
    checkTodayAttendance();
    window.addEventListener('phed-survey-saved', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('phed-survey-saved', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPhed = async () => {
    try {
      const response = await axios.get(`${API_URL}/phed/my-progress`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPhed(response.data);
    } catch (error) {
      toast.error('Failed to load progress');
    } finally {
      setLoading(false);
    }
  };

  const checkTodayAttendance = async () => {
    try {
      const response = await axios.get(`${API_URL}/employee/attendance/today`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setHasAttendance(response.data.has_attendance);
      setAttendanceData(response.data.attendance);
    } catch (error) {
      console.error('Failed to check attendance:', error);
    }
  };

  if (loading) {
    return (
      <EmployeeLayout title="Dashboard">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
        </div>
      </EmployeeLayout>
    );
  }

  const todayCount = phed?.my_today_submitted ?? 0;
  const totalCount = phed?.my_total_submitted ?? 0;
  const assignedTotal = phed?.total_properties ?? 0;
  const doneCount = phed?.phed_completed ?? 0;
  const pct = assignedTotal > 0 ? Math.round((doneCount / assignedTotal) * 100) : 0;

  return (
    <EmployeeLayout title="Dashboard">
      <div data-testid="employee-dashboard" className="space-y-4 pb-4">

        {/* Greeting */}
        <div className="text-center pt-2 pb-1">
          <h2 className="text-xl font-heading font-bold" style={{ color: 'var(--phed-ink)' }}>
            Ram Ram, {user?.name}!
          </h2>
          <p className="text-sm" style={{ color: 'var(--phed-muted)' }}>Aaj ke surveys ke liye taiyaar?</p>
        </div>

        {/* Attendance */}
        {!hasAttendance ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-100">
                  <CalendarCheck className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="font-semibold text-amber-800 text-sm">Attendance Lagao</p>
                  <p className="text-xs text-amber-700/70">Survey se pehle zaroori hai</p>
                </div>
              </div>
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => navigate('/employee/attendance')} data-testid="mark-attendance-btn">
                <Camera className="w-4 h-4 mr-1" /> Mark
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-100">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-emerald-800 text-sm">Attendance Done</p>
                <p className="text-xs text-emerald-700/70">
                  {attendanceData?.marked_at && new Date(attendanceData.marked_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Today + Total work (hero) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="clinic-card p-4" data-testid="today-work-card">
            <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--phed-muted)' }}>Aaj Ka Kaam</p>
            <p className="text-4xl font-extrabold mt-1" style={{ color: 'var(--phed-blue)' }} data-testid="today-count">{todayCount}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--phed-muted)' }}>surveys aaj submit kiye</p>
          </div>
          <div className="clinic-card p-4" data-testid="total-work-card">
            <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--phed-muted)' }}>Ab Tak Total</p>
            <p className="text-4xl font-extrabold mt-1 text-emerald-600" data-testid="total-count">{totalCount}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--phed-muted)' }}>kul surveys aapne kiye</p>
          </div>
        </div>

        {/* Assigned scope progress */}
        <div className="clinic-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-semibold" style={{ color: 'var(--phed-ink)' }}>Assigned Properties</span>
            </div>
            <span className="text-lg font-bold" style={{ color: 'var(--phed-blue)' }}>{pct}%</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden bg-slate-100">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--phed-blue-dark), var(--phed-blue))' }} />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 text-center">
            {[
              ['Total', phed?.total_properties, '#1565C0'],
              ['Pending', phed?.phed_pending, '#F57C00'],
              ['Done', phed?.phed_completed, '#2E7D32'],
              ['In Progress', phed?.phed_in_progress, '#B45309'],
            ].map(([label, val, color]) => (
              <div key={label} data-testid={`scope-${String(label).replace(/\s+/g, '-').toLowerCase()}`}>
                <div className="text-xl font-extrabold" style={{ color }}>{val ?? 0}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Connection breakdown — kis type ka connection kiya */}
        <div className="clinic-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Droplet className="w-4 h-4" style={{ color: 'var(--phed-blue)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--phed-ink)' }}>Connection Type — Aapne Kya Kiya</span>
          </div>
          <div className="grid grid-cols-2 gap-3" data-testid="connection-breakdown">
            {CONNECTION_TILES.map((t) => (
              <div key={t.key} className="rounded-xl bg-white border p-3" style={{ borderColor: '#e2e8f0' }} data-testid={`conn-${t.key.replace('my_', '').replace(/_/g, '-')}`}>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{t.label}</div>
                <div className="text-2xl font-extrabold" style={{ color: t.color }}>{phed?.[t.key] ?? 0}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <Button
          onClick={() => navigate('/employee/properties')}
          className="w-full h-12 rounded-xl text-white font-semibold flex items-center justify-between px-5 shadow-md shadow-blue-700/20 hover:shadow-lg transition-[box-shadow,transform] hover:-translate-y-px"
          style={{ background: 'var(--phed-blue)' }}
          data-testid="start-phed-survey-btn"
        >
          <span className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> Water Survey Shuru Karo</span>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <Button
          onClick={() => navigate('/employee/phed-survey')}
          variant="outline"
          className="w-full h-11 rounded-xl font-semibold flex items-center justify-between px-5"
          data-testid="open-list-btn"
        >
          <span className="flex items-center gap-2"><ClipboardList className="w-5 h-5" /> Properties List (search)</span>
          <ArrowRight className="w-5 h-5" />
        </Button>
      </div>
    </EmployeeLayout>
  );
}
