import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import {
  CheckCircle, Clock, ArrowRight, FileSpreadsheet, TrendingUp,
  XCircle, CalendarCheck, Camera, Loader2, ChevronLeft, ChevronRight,
  BarChart3, Lock, UserX, MapPinOff, AlertTriangle, Droplet
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function EmployeeDashboard() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [progress, setProgress] = useState(null);
  const [phed, setPhed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasAttendance, setHasAttendance] = useState(false);
  const [attendanceData, setAttendanceData] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  useEffect(() => {
    fetchProgress();
    fetchPhed();
    checkTodayAttendance();
  }, []);

  useEffect(() => {
    fetchDailyProgress();
  }, [selectedMonth, selectedYear]);

  const fetchProgress = async () => {
    try {
      const response = await axios.get(`${API_URL}/employee/progress`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProgress(response.data);
    } catch (error) {
      toast.error('Failed to load progress');
    } finally {
      setLoading(false);
    }
  };

  const fetchPhed = async () => {
    try {
      const response = await axios.get(`${API_URL}/phed/my-progress`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPhed(response.data);
    } catch (error) {
      // non-blocking
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

  const fetchDailyProgress = async () => {
    try {
      const res = await axios.get(`${API_URL}/employee/daily-progress?month=${selectedMonth}&year=${selectedYear}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDailyData(res.data);
    } catch { }
  };

  const changeMonth = (dir) => {
    let m = selectedMonth + dir;
    let y = selectedYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setSelectedMonth(m);
    setSelectedYear(y);
  };

  const percentage = progress?.total_assigned > 0
    ? Math.round((progress.completed / progress.total_assigned) * 100)
    : 0;

  const maxDaily = dailyData ? Math.max(...dailyData.daily.map(d => d.count), 1) : 1;
  const todayDay = new Date().getDate();
  const isCurrentMonth = selectedMonth === (new Date().getMonth() + 1) && selectedYear === new Date().getFullYear();

  if (loading) {
    return (
      <EmployeeLayout title="Dashboard">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
        </div>
      </EmployeeLayout>
    );
  }

  return (
    <EmployeeLayout title="Dashboard">
      <div data-testid="employee-dashboard" className="space-y-4 pb-4">
        
        {/* Greeting */}
        <div className="text-center pt-2 pb-1">
          <h2 className="text-xl font-heading font-bold" style={{color: 'var(--phed-ink)'}}>
            Ram Ram, {user?.name}!
          </h2>
          <p className="text-sm" style={{color: 'var(--phed-muted)'}}>Aaj ke surveys ke liye taiyaar?</p>
        </div>

        {/* Attendance Card */}
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

        {/* Today's Progress + Overall */}
        <div className="clinic-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs" style={{color: 'var(--phed-muted)'}}>Aaj Ka Kaam</p>
              <p className="text-3xl font-bold" style={{color: 'var(--phed-ink)'}}>
                {progress?.today_completed || 0} <span className="text-base font-normal text-slate-400">surveys</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold" style={{color: 'var(--phed-blue)'}}>{percentage}%</p>
              <p className="text-xs" style={{color: 'var(--phed-muted)'}}>Overall</p>
            </div>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden bg-slate-100">
            <div className="h-full rounded-full transition-all duration-700" style={{width: `${percentage}%`, background: 'linear-gradient(90deg, var(--phed-blue-dark), var(--phed-blue))'}} />
          </div>
          <div className="mt-3 pt-3 flex items-center justify-between border-t" style={{borderColor: 'var(--phed-border)'}}>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span className="text-sm text-slate-600">Total Complete</span>
            </div>
            <span className="text-lg font-bold text-emerald-600">{progress?.total_completed || 0}</span>
          </div>
        </div>

        {/* Water Severage Bill Survey progress (separate from property survey) */}
        {phed && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Droplet className="w-4 h-4" style={{ color: 'var(--phed-blue, #1565C0)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--phed-ink, #0f172a)' }}>Water Severage Bill Survey</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Total Properties', phed.total_properties, '#1565C0'],
                ['PHED Pending', phed.phed_pending, '#F57C00'],
                ['Submitted', phed.total_submitted, '#2E7D32'],
                ['New Properties Added', phed.field_properties, '#7C3AED'],
              ].map(([label, val, color]) => (
                <div key={label} className="rounded-xl bg-white border p-3" style={{ borderColor: '#e2e8f0' }} data-testid={`phed-stat-${String(label).replace(/\s+/g,'-').toLowerCase()}`}>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="text-2xl font-extrabold" style={{ color }}>{val ?? 0}</div>
                </div>
              ))}
            </div>

            {/* Connection outcome breakdown (submitted surveys) */}
            <p className="text-[11px] font-medium uppercase tracking-wide mt-3 mb-2" style={{color: 'var(--phed-muted)'}}>Submitted surveys — breakdown</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Already Connection', phed.already_connection, '#0369A1'],
                ['Sewer Connection', phed.sewer_connection, '#00897B'],
                ['New Connection', phed.new_connection, '#B45309'],
                ['Ownership Change', phed.ownership_change, '#7C3AED'],
                ['Death Transfer', phed.death_transfer, '#B91C1C'],
              ].map(([label, val, color]) => (
                <div key={label} className="rounded-xl bg-white border p-3" style={{ borderColor: '#e2e8f0' }} data-testid={`phed-breakdown-${String(label).replace(/\s+/g,'-').toLowerCase()}`}>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="text-2xl font-extrabold" style={{ color }}>{val ?? 0}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Date-wise Progress */}
        <div className="clinic-card overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{color: 'var(--phed-ink)'}}>
              <BarChart3 className="w-4 h-4 text-blue-700" /> Date-wise Progress
            </h3>
            <div className="flex items-center gap-2">
              <button onClick={() => changeMonth(-1)} className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-700 hover:bg-blue-50 border border-slate-200">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium min-w-[80px] text-center" style={{color: 'var(--phed-ink)'}}>{MONTHS[selectedMonth - 1]} {selectedYear}</span>
              <button onClick={() => changeMonth(1)} className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-700 hover:bg-blue-50 border border-slate-200">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Monthly Total */}
          <div className="px-4 pb-2 flex items-center justify-between">
            <span className="text-xs" style={{color: 'var(--phed-muted)'}}>Monthly Total</span>
            <span className="text-lg font-bold text-blue-700">{dailyData?.total || 0}</span>
          </div>

          {/* Date Grid */}
          {dailyData && (
            <div className="px-3 pb-3">
              <div className="grid grid-cols-7 gap-1">
                {/* Day headers */}
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={i} className="text-center text-[9px] text-slate-400 font-medium py-1">{d}</div>
                ))}
                
                {/* Empty cells for first day offset */}
                {(() => {
                  const firstDay = new Date(selectedYear, selectedMonth - 1, 1).getDay();
                  return Array(firstDay).fill(null).map((_, i) => <div key={`e${i}`} />);
                })()}
                
                {/* Day cells */}
                {dailyData.daily.map(({ day, count }) => {
                  const isToday = isCurrentMonth && day === todayDay;
                  const intensity = count > 0 ? Math.max(0.2, count / maxDaily) : 0;
                  return (
                    <div key={day} className={`rounded-lg text-center py-1.5 relative ${isToday ? 'ring-2 ring-blue-500/60' : ''}`}
                      style={{background: count > 0 ? `rgba(21, 101, 192, ${intensity * 0.35})` : '#F4F8FB'}}>
                      <div className="text-[9px] text-slate-400">{day}</div>
                      <div className={`text-xs font-bold ${count > 0 ? 'text-blue-900' : 'text-slate-300'}`}>{count}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Condition Summary */}
          {dailyData && dailyData.total > 0 && (
            <div className="px-4 pb-4 pt-2 border-t" style={{borderColor: 'var(--phed-border)'}}>
              <p className="text-[10px] uppercase tracking-wider mb-2" style={{color: 'var(--phed-muted)'}}>Survey Conditions</p>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: 'Normal', value: dailyData.conditions?.normal || 0, icon: CheckCircle, color: '#047857' },
                  { label: 'Locked', value: dailyData.conditions?.locked || 0, icon: Lock, color: '#B45309' },
                  { label: 'Denied', value: dailyData.conditions?.denied || 0, icon: UserX, color: '#B91C1C' },
                  { label: 'Vacant', value: dailyData.conditions?.vacant || 0, icon: MapPinOff, color: '#6A1B9A' },
                  { label: 'Wrong', value: dailyData.conditions?.wrong || 0, icon: AlertTriangle, color: '#C2410C' },
                ].map((c) => (
                  <div key={c.label} className="text-center rounded-lg p-1.5 bg-slate-50 border border-slate-100">
                    <c.icon className="w-3 h-3 mx-auto" style={{color: c.color}} />
                    <p className="text-sm font-bold mt-0.5" style={{color: 'var(--phed-ink)'}}>{c.value}</p>
                    <p className="text-[8px] uppercase font-semibold" style={{color: c.color}}>{c.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <Button
          onClick={() => navigate('/employee/phed-survey')}
          className="w-full h-12 rounded-xl text-white font-semibold flex items-center justify-between px-5 shadow-md shadow-blue-700/20 hover:shadow-lg transition-[box-shadow,transform] hover:-translate-y-px"
          style={{background: 'var(--phed-blue)'}}
          data-testid="start-phed-survey-btn"
        >
          <span className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> Water Survey Shuru Karo</span>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <Button
          onClick={() => navigate('/employee/property-map')}
          variant="outline"
          className="w-full h-11 rounded-xl font-semibold flex items-center justify-between px-5"
          data-testid="open-map-btn"
        >
          <span className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> Properties Map / List</span>
          <ArrowRight className="w-5 h-5" />
        </Button>

        {progress?.pending > 0 && (
          <p className="text-center text-xs" style={{color: 'var(--phed-muted)'}}>
            {progress.pending} properties pending PHED survey
          </p>
        )}
      </div>
    </EmployeeLayout>
  );
}
