import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import {
  FileSpreadsheet, CheckCircle, Clock, Users, FolderOpen,
  MapPin, TrendingUp, XCircle, Eye, Trash2, Loader2, Download,
  ClipboardCheck, Calendar, Home, Building, Landmark, TreePine,
  UserX, Phone, Layers, Filter, SlidersHorizontal
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Label } from '../../components/ui/label';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const COLORS = ['#059669', '#f59e0b', '#3b82f6', '#ef4444'];
const ROLE_LABELS = {
  'SURVEYOR': 'Surveyor',
  'SUPERVISOR': 'Supervisor',
  'MC_OFFICER': 'MC Officer',
  'EMPLOYEE': 'Surveyor'
};

const DARK_COLORS = ['#1565C0', '#00897B', '#2E7D32', '#F59E0B', '#6A1B9A'];

export default function Dashboard() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';
  const [stats, setStats] = useState(null);
  const [submissionStats, setSubmissionStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [employeeProgress, setEmployeeProgress] = useState([]);
  const [attendanceStats, setAttendanceStats] = useState({ present: 0, total: 0 });
  const [townStats, setTownStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('all');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [colonyDialog, setColonyDialog] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [colonyProgress, setColonyProgress] = useState([]);
  const [loadingColonies, setLoadingColonies] = useState(false);
  const [removeDialog, setRemoveDialog] = useState(false);
  const [colonyToRemove, setColonyToRemove] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [reportDialog, setReportDialog] = useState(false);
  const [reportFilters, setReportFilters] = useState({
    month: (new Date().getMonth() + 1).toString(),
    year: new Date().getFullYear().toString(),
    surveyor_id: '',
    date_from: '',
    date_to: '',
    colony: '',
    category: '',
    status: ''
  });
  const [colonies, setColonies] = useState([]);
  const [downloadingReport, setDownloadingReport] = useState(false);

  useEffect(() => { fetchData(); }, [viewMode, selectedDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const todayDate = new Date().toISOString().split('T')[0];
      const dateParam = viewMode === 'today' ? `?date=${selectedDate}` : '';
      const [statsRes, progressRes, attendanceRes, submissionsRes, townStatsRes] = await Promise.all([
        axios.get(`${API_URL}/admin/dashboard${dateParam}`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/admin/employee-progress${dateParam}`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/admin/attendance?date=${todayDate}&limit=100`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { attendance: [], total: 0 } })),
        axios.get(`${API_URL}/admin/submission-stats${dateParam}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { total: 0, pending: 0, approved: 0, rejected: 0 } })),
        axios.get(`${API_URL}/admin/town-stats`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { towns: [] } }))
      ]);
      setStats(statsRes.data);
      setEmployeeProgress(progressRes.data);
      setSubmissionStats(submissionsRes.data);
      setTownStats(townStatsRes.data.towns || []);
      const attendanceTotal = attendanceRes.data?.attendance?.length || 0;
      const totalEmployees = progressRes.data?.length || 0;
      setAttendanceStats({ present: attendanceTotal, total: totalEmployees });
    } catch (error) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const downloadTodayReport = () => {
    const dateForReport = viewMode === 'today' ? selectedDate : new Date().toISOString().split('T')[0];
    const headers = ['Employee', 'Role', 'Assigned', 'Today Completed', 'Overall Completed', 'Completed', 'Pending', 'Progress %', 'Colonies'];
    const sortedData = [...employeeProgress].sort((a, b) => {
      if (viewMode === 'today') return (b.today_completed || 0) - (a.today_completed || 0);
      return (b.overall_completed || 0) - (a.overall_completed || 0);
    });
    const rows = sortedData.map(emp => {
      const pct = emp.total_assigned > 0 ? Math.round((emp.completed / emp.total_assigned) * 100) : 0;
      return [emp.employee_name, ROLE_LABELS[emp.role] || emp.role, emp.total_assigned || 0, emp.today_completed || 0, emp.overall_completed || 0, emp.completed || 0, emp.pending || 0, pct + '%', (emp.assigned_colonies || []).join('; ')];
    });
    const totalAssigned = sortedData.reduce((s, e) => s + (e.total_assigned || 0), 0);
    const totalToday = sortedData.reduce((s, e) => s + (e.today_completed || 0), 0);
    const totalOverall = sortedData.reduce((s, e) => s + (e.overall_completed || 0), 0);
    const totalCompleted = sortedData.reduce((s, e) => s + (e.completed || 0), 0);
    const totalPending = sortedData.reduce((s, e) => s + (e.pending || 0), 0);
    rows.push(['', '', '', '', '', '', '', '', '']);
    rows.push(['TOTAL', '', totalAssigned, totalToday, totalOverall, totalCompleted, totalPending, totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) + '%' : '0%', '']);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `surveyor_report_${dateForReport}.csv`;
    a.click();
    toast.success(`Downloaded surveyor report for ${dateForReport}`);
  };

  const handleViewColonyProgress = async (employee) => {
    setSelectedEmployee(employee);
    setColonyDialog(true);
    setLoadingColonies(true);
    try {
      const response = await axios.get(`${API_URL}/admin/employee-progress/${employee.employee_id}/colonies`, { headers: { Authorization: `Bearer ${token}` } });
      setColonyProgress(response.data.colonies || []);
    } catch (error) { toast.error('Failed to load colony progress'); }
    finally { setLoadingColonies(false); }
  };

  const handleOpenRemoveDialog = (colony) => { setColonyToRemove(colony); setRemoveDialog(true); };

  const handleRemoveFromColony = async () => {
    if (!selectedEmployee || !colonyToRemove) return;
    setRemoving(true);
    try {
      const formData = new FormData();
      formData.append('employee_id', selectedEmployee.employee_id);
      formData.append('colony', colonyToRemove.colony);
      const response = await axios.post(`${API_URL}/admin/employee/remove-from-colony`, formData, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(response.data.message);
      setRemoveDialog(false);
      handleViewColonyProgress(selectedEmployee);
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed to remove from colony'); }
    finally { setRemoving(false); }
  };

  const fetchColonies = async () => {
    try {
      const res = await axios.get(`${API_URL}/map/colonies`, { headers: { Authorization: `Bearer ${token}` } });
      setColonies(res.data.colonies || []);
    } catch { }
  };

  const handleOpenReportDialog = () => {
    fetchColonies();
    setReportDialog(true);
  };

  const handleDownloadReport = async () => {
    setDownloadingReport(true);
    try {
      const params = new URLSearchParams();
      if (reportFilters.month) params.append('month', reportFilters.month);
      if (reportFilters.year) params.append('year', reportFilters.year);
      if (reportFilters.surveyor_id) params.append('surveyor_id', reportFilters.surveyor_id);
      if (reportFilters.date_from) params.append('date_from', reportFilters.date_from);
      if (reportFilters.date_to) params.append('date_to', reportFilters.date_to);
      if (reportFilters.colony) params.append('colony', reportFilters.colony);
      if (reportFilters.category) params.append('category', reportFilters.category);
      if (reportFilters.status) params.append('status', reportFilters.status);
      
      const res = await axios.get(`${API_URL}/admin/surveyor-report?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `surveyor_report_${reportFilters.year}_${reportFilters.month.padStart(2, '0')}.xlsx`;
      a.click();
      toast.success('Report downloaded!');
      setReportDialog(false);
    } catch (e) {
      toast.error('Failed to download report');
    } finally {
      setDownloadingReport(false);
    }
  };

  const pieData = stats ? [
    { name: 'Approved', value: stats.approved },
    { name: 'Pending', value: stats.pending },
    { name: 'Rejected', value: stats.rejected }
  ].filter(d => d.value > 0) : [];

  // Progress calculations
  const billProgress = stats?.total > 0 ? Math.round(((stats.total - stats.pending) / stats.total) * 100) : 0;
  const surveyProgress = stats?.total > 0 ? Math.round((submissionStats.total / stats.total) * 100) : 0;

  if (loading) {
    return (
      <AdminLayout title="Dashboard">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
        </div>
      </AdminLayout>
    );
  }

  // Glass card style helper
  const glassCard = "clinic-card";
  const glassCardBg = {};

  return (
    <AdminLayout title="Dashboard">
      <div data-testid="admin-dashboard" className="space-y-5">
        
        {/* View Mode Toggle + Report Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-white p-1" style={{borderColor: 'var(--phed-border)'}}>
            <button data-testid="view-mode-all" onClick={() => setViewMode('all')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${viewMode === 'all' ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-600 hover:bg-blue-50'}`}>
              All Time
            </button>
            <button data-testid="view-mode-today" onClick={() => { setViewMode('today'); setSelectedDate(new Date().toISOString().split('T')[0]); }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${viewMode === 'today' ? 'bg-emerald-600 text-white shadow-sm' : 'text-emerald-700 hover:bg-emerald-50'}`}>
              <Calendar className="w-4 h-4 inline mr-1" /> Today Report
            </button>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <Button size="sm" className="bg-blue-700 hover:bg-blue-800 text-white shadow-sm flex items-center gap-2" data-testid="download-surveyor-report"
                onClick={handleOpenReportDialog}>
                <SlidersHorizontal className="w-4 h-4" /> Download Report
              </Button>
            )}
            {viewMode === 'today' && (
              <input type="date" data-testid="date-picker" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 border border-slate-200 bg-white rounded-lg text-sm text-slate-800 shadow-sm focus:ring-2 focus:ring-blue-500" />
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" data-testid="download-today-report" className="border-slate-200 text-blue-700 hover:bg-blue-50 flex items-center gap-2" onClick={downloadTodayReport}>
                <Download className="w-4 h-4" /> {viewMode === 'today' ? 'Download Day Report' : 'Download Report'}
              </Button>
            )}
          </div>
        </div>

        {viewMode === 'today' && (
          <div className="rounded-lg px-4 py-2 text-sm text-emerald-800 flex items-center gap-2 border border-emerald-200 bg-emerald-50">
            <Calendar className="w-4 h-4" /> Showing report for: <strong>{selectedDate === new Date().toISOString().split('T')[0] ? 'Today' : selectedDate}</strong>
          </div>
        )}

        {/* ===== TOP ROW: Total Property + Pending ===== */}
        <div className="grid grid-cols-2 gap-4">
          <div data-testid="stat-total-properties" className={`${glassCard} p-5`} style={{borderLeft: '4px solid var(--phed-blue)'}}>
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl" style={{background: 'var(--phed-blue-soft)'}}>
                <FileSpreadsheet className="w-8 h-8 text-blue-700" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Total Property</p>
                <p className="text-4xl font-bold" style={{color: 'var(--phed-ink)'}}>{stats?.total || 0}</p>
              </div>
            </div>
          </div>
          <div data-testid="stat-pending-properties" className={`${glassCard} p-5`} style={{borderLeft: '4px solid #D97706'}}>
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-50">
                <Clock className="w-8 h-8 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Pending Property</p>
                <p className="text-4xl font-bold" style={{color: 'var(--phed-ink)'}}>{stats?.pending || 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ===== CATEGORY STAT BLOCKS ===== */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-2">
          {[
            { id: 'stat-total-colony', icon: FolderOpen, value: stats?.colonies || 0, label: 'Total Colony', color: '#6A1B9A' },
            { id: 'stat-residential', icon: Home, value: stats?.category?.residential || 0, label: 'Residential', color: '#1565C0' },
            { id: 'stat-commercial', icon: Building, value: stats?.category?.commercial || 0, label: 'Commercial', color: '#3949AB' },
            { id: 'stat-vacant-plot', icon: Layers, value: stats?.category?.vacant_plot || 0, label: 'Vacant Plot', color: '#EF6C00' },
            { id: 'stat-mix-use', icon: Layers, value: stats?.category?.mix_use || 0, label: 'Mix Use', color: '#00897B' },
            { id: 'stat-industrial', icon: Building, value: stats?.category?.industrial || 0, label: 'Industrial', color: '#0277BD' },
            { id: 'stat-institutional', icon: Landmark, value: stats?.category?.institutional || 0, label: 'Institutional', color: '#2E7D32' },
            { id: 'stat-special-category', icon: Landmark, value: stats?.category?.special_category || 0, label: 'Special Cat.', color: '#AD1457' },
            { id: 'stat-agriculture', icon: TreePine, value: stats?.category?.agriculture || 0, label: 'Agriculture', color: '#558B2F' },
            { id: 'stat-owner-na', icon: UserX, value: stats?.owner_na || 0, label: 'Owner NA', color: '#C62828' },
            { id: 'stat-mobile-na', icon: Phone, value: stats?.mobile_na || 0, label: 'Mobile NA', color: '#B71C1C' },
          ].map((item) => (
            <div key={item.id} data-testid={item.id} className={`${glassCard} p-3 text-center hover:-translate-y-0.5 transition-transform cursor-default`}
              style={{borderTop: `3px solid ${item.color}`}}>
              <item.icon className="w-5 h-5 mx-auto mb-1" style={{color: item.color}} />
              <p className="text-xl font-bold" style={{color: 'var(--phed-ink)'}}>{item.value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{color: item.color}}>{item.label}</p>
            </div>
          ))}
        </div>

        {/* ===== BILL DISTRIBUTION STATUS ===== */}
        <div className={`${glassCard}`} style={glassCardBg}>
          <div className="px-5 pt-4 pb-2">
            <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-blue-700" />
              Bill Distribution Status
            </h3>
          </div>
          <div className="px-5 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { id: 'stat-total-bill-dist', label: 'Total Bill Distribution', value: submissionStats.total || 0, color: '#1565C0', bg: '#E8F1FB' },
                { id: 'stat-pending-bill-dist', label: 'Pending Bill Distribution', value: submissionStats.pending || 0, color: '#B45309', bg: '#FFFBEB' },
                { id: 'stat-approved-bill-dist', label: 'Approved Bill Distribution', value: submissionStats.approved || 0, color: '#047857', bg: '#ECFDF5' },
                { id: 'stat-rejected-bill-dist', label: 'Rejected Bill Distribution', value: submissionStats.rejected || 0, color: '#B91C1C', bg: '#FEF2F2' },
              ].map((item) => (
                <div key={item.id} data-testid={item.id} className="rounded-xl p-4 border" 
                  style={{background: item.bg, borderColor: `${item.color}33`}}>
                  <p className="text-xs font-medium text-slate-600">{item.label}</p>
                  <p className="text-2xl font-bold mt-1" style={{color: item.color}}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ===== EMPLOYEE + ATTENDANCE ===== */}
        {isAdmin && (
        <div data-testid="employee-attendance-card" className={`${glassCard} cursor-pointer hover:border-blue-300 transition-colors`}
          style={glassCardBg} onClick={() => navigate('/admin/attendance')}>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl" style={{background: 'var(--phed-blue-soft)'}}>
                    <Users className="w-7 h-7 text-blue-700" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Total Employees</p>
                    <p className="text-2xl font-bold text-slate-900">{stats?.employees || 0}</p>
                  </div>
                </div>
                <div className="w-px h-12" style={{background: 'var(--phed-border)'}} />
                <div>
                  <p className="text-xs text-slate-500">Today Attendance (This Town)</p>
                  <p className="text-2xl font-bold text-teal-700">
                    {attendanceStats.present} <span className="text-base font-normal text-slate-500">/ {attendanceStats.total}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-3xl font-bold text-teal-700">
                    {attendanceStats.total > 0 ? Math.round((attendanceStats.present / attendanceStats.total) * 100) : 0}%
                  </p>
                  <p className="text-xs text-slate-500">Attendance Rate</p>
                </div>
                <Button variant="outline" size="sm" className="border-slate-200 text-blue-700 hover:bg-blue-50">View All</Button>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ===== PROGRESS REPORTS ===== */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Town Bill Progress */}
          <div data-testid="town-bill-progress" className={glassCard} style={glassCardBg}>
            <div className="p-4">
              <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-blue-700" /> Town Bill Progress
              </h4>
              <div className="flex items-end gap-3 mb-3">
                <span className="text-3xl font-bold text-blue-700">{billProgress}%</span>
                <span className="text-sm text-slate-500 mb-1">{stats?.total - stats?.pending || 0} / {stats?.total || 0}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-slate-100">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${billProgress}%`, background: 'linear-gradient(90deg, #0D47A1, #1565C0)' }} />
              </div>
              <div className="flex justify-between mt-2 text-xs text-slate-500">
                <span>Distributed: {stats?.total - stats?.pending || 0}</span>
                <span>Pending: {stats?.pending || 0}</span>
              </div>
            </div>
          </div>

          {/* Survey Progress */}
          <div data-testid="survey-progress" className={glassCard} style={glassCardBg}>
            <div className="p-4">
              <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
                <ClipboardCheck className="w-4 h-4 text-emerald-600" /> Survey Progress
              </h4>
              <div className="flex items-end gap-3 mb-3">
                <span className="text-3xl font-bold text-emerald-600">{Math.min(surveyProgress, 100)}%</span>
                <span className="text-sm text-slate-500 mb-1">{submissionStats.total || 0} / {stats?.total || 0}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-emerald-50">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(surveyProgress, 100)}%`, background: 'linear-gradient(90deg, #047857, #10b981)' }} />
              </div>
              <div className="flex justify-between mt-2 text-xs text-slate-500">
                <span>Surveyed: {submissionStats.total || 0}</span>
                <span>Remaining: {Math.max((stats?.total || 0) - (submissionStats.total || 0), 0)}</span>
              </div>
            </div>
          </div>

          {/* Employee Work Progress */}
          <div data-testid="employee-work-progress" className={glassCard} style={glassCardBg}>
            <div className="p-4">
              <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-teal-700" /> Employee Work Progress
              </h4>
              <div className="space-y-2 max-h-[140px] overflow-y-auto">
                {employeeProgress.length > 0 ? (
                  [...employeeProgress].sort((a, b) => {
                    if (viewMode === 'today') return (b.today_completed || 0) - (a.today_completed || 0);
                    return (b.overall_completed || 0) - (a.overall_completed || 0);
                  }).slice(0, 5).map((emp) => {
                    const pct = emp.total_assigned > 0 ? Math.round((emp.completed / emp.total_assigned) * 100) : 0;
                    return (
                      <div key={emp.employee_id} className="flex items-center gap-2 text-xs">
                        <span className="w-20 truncate font-medium text-slate-700">{emp.employee_name}</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00897B, #26A69A)' }} />
                        </div>
                        <span className="text-slate-500 w-10 text-right">{pct}%</span>
                        <span className="text-emerald-600 font-semibold w-8 text-right">+{emp.today_completed || 0}</span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-400 text-center py-4">No employee data</p>
                )}
              </div>
              {employeeProgress.length > 5 && (
                <p className="text-[10px] text-slate-400 text-center mt-1">...and {employeeProgress.length - 5} more</p>
              )}
            </div>
          </div>
        </div>

        {/* ===== TOWN-WISE PROGRESS ===== */}
        {isAdmin && townStats.length > 0 && (
          <div className={glassCard} style={glassCardBg}>
            <div className="px-5 pt-4 pb-2">
              <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-700" /> Town-wise Progress
              </h3>
            </div>
            <div className="px-5 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {townStats.map((town, index) => {
                  const completionRate = town.total > 0 ? Math.round((town.completed / town.total) * 100) : 0;
                  const pendingRate = town.total > 0 ? Math.round((town.pending / town.total) * 100) : 0;
                  return (
                    <div key={town.name || index}
                      className="rounded-xl p-4 border bg-slate-50 hover:border-blue-300 transition-colors cursor-pointer"
                      style={{borderColor: 'var(--phed-border)'}}
                      onClick={() => navigate(`/admin/properties?town=${encodeURIComponent(town.name)}`)}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-slate-800 truncate" title={town.name}>{town.name || 'Unknown'}</h4>
                        <span className="text-xs px-2 py-1 rounded-full font-medium" style={{background: 'var(--phed-blue-soft)', color: 'var(--phed-blue)'}}>{town.total} properties</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden mb-2 bg-slate-100">
                        <div className="h-full flex">
                          <div className="transition-all" style={{ width: `${completionRate}%`, background: '#1565C0' }} />
                          <div className="transition-all" style={{ width: `${pendingRate}%`, background: '#F59E0B' }} />
                        </div>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-emerald-600"><CheckCircle className="w-3 h-3 inline mr-1" />{town.completed} Done</span>
                        <span className="text-amber-600"><Clock className="w-3 h-3 inline mr-1" />{town.pending} Pending</span>
                        <span className="text-slate-500">{completionRate}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ===== CHARTS ===== */}
        {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={glassCard} style={glassCardBg}>
            <div className="p-4">
              <h4 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-blue-700" /> Employee Performance
              </h4>
              {employeeProgress.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={employeeProgress} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis type="number" stroke="#94A3B8" fontSize={12} tick={{fill: '#64748B'}} />
                    <YAxis type="category" dataKey="employee_name" stroke="#94A3B8" width={80} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #DCE6F0', borderRadius: '12px', color: '#0F2A44' }} />
                    <Bar dataKey="today_completed" fill="#00897B" name="Today" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="overall_completed" fill="#1565C0" name="Overall" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="pending" fill="#F59E0B" name="Pending" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-slate-400">No employee data available</div>
              )}
            </div>
          </div>
          <div className={glassCard} style={glassCardBg}>
            <div className="p-4">
              <h4 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-4">
                <FolderOpen className="w-5 h-5 text-teal-700" /> Status Distribution
              </h4>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} innerRadius={65} fill="#8884d8" dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}
                      stroke="#FFFFFF" strokeWidth={2}>
                      {pieData.map((entry, index) => (<Cell key={`cell-${index}`} fill={DARK_COLORS[index % DARK_COLORS.length]} />))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #DCE6F0', borderRadius: '12px', color: '#0F2A44' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-slate-400">No data available</div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* ===== EMPLOYEE PROGRESS TABLE ===== */}
        {isAdmin && (
        <div className={glassCard} style={glassCardBg}>
          <div className="px-5 pt-4 pb-2 border-b" style={{borderColor: 'var(--phed-border)'}}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-600" /> Employee Progress Report
              </h3>
              <Button size="sm" variant="outline" className="border-slate-200 text-blue-700 hover:bg-blue-50 flex items-center gap-2" onClick={() => {
                const headers = ['Employee', 'Role', 'Assigned', 'Today', 'Overall Completed', 'Completed', 'Pending', 'Progress %'];
                const sortedData = [...employeeProgress].sort((a, b) => {
                  if (viewMode === 'today') return (b.today_completed || 0) - (a.today_completed || 0);
                  return (b.overall_completed || 0) - (a.overall_completed || 0);
                });
                const rows = sortedData.map(emp => {
                  const pct = emp.total_assigned > 0 ? Math.round((emp.completed / emp.total_assigned) * 100) : 0;
                  return [emp.employee_name, ROLE_LABELS[emp.role] || emp.role, emp.total_assigned || 0, emp.today_completed, emp.overall_completed || 0, emp.completed, emp.pending, pct + '%'];
                });
                const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob); const a = document.createElement('a');
                a.href = url; a.download = `employee_progress_${new Date().toISOString().split('T')[0]}.csv`; a.click();
                toast.success('Downloaded employee progress report');
              }}>
                <Download className="w-4 h-4" /> Download
              </Button>
            </div>
          </div>
          <div className="p-0">
            {employeeProgress.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Employee</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Role</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold uppercase" style={{color: '#00897B', background: '#E0F2F1'}}>Today</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold uppercase" style={{color: '#1565C0', background: '#E8F1FB'}}>Overall</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Assigned</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Completed</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Pending</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Progress</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...employeeProgress].sort((a, b) => {
                      if (viewMode === 'today') return (b.today_completed || 0) - (a.today_completed || 0);
                      return (b.overall_completed || 0) - (a.overall_completed || 0);
                    }).map((emp, idx) => {
                      const pct = emp.total_assigned > 0 ? Math.round((emp.completed / emp.total_assigned) * 100) : 0;
                      const rowColors = ['#1565C0', '#00897B', '#6A1B9A', '#2E7D32', '#EF6C00'];
                      return (
                        <tr key={emp.employee_id} className="hover:bg-slate-50 transition-colors" style={{borderBottom: '1px solid var(--phed-border)'}}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
                                style={{background: rowColors[idx % 5]}}>
                                {emp.employee_name?.charAt(0)}
                              </div>
                              <div>
                                <span className="font-medium text-slate-800 text-sm block">{emp.employee_name}</span>
                                <span className="text-[10px] text-slate-400">{emp.employee_mobile || ''}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-1 rounded-full font-medium border ${
                              emp.role === 'SUPERVISOR' ? 'border-purple-200 text-purple-700 bg-purple-50' :
                              emp.role === 'MC_OFFICER' ? 'border-amber-200 text-amber-700 bg-amber-50' : 'border-blue-200 text-blue-700 bg-blue-50'
                            }`}>{ROLE_LABELS[emp.role] || emp.role}</span>
                          </td>
                          <td className="px-4 py-3 text-center" style={{background: '#F0FAF9'}}>
                            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl font-bold text-lg text-teal-800"
                              style={{background: '#E0F2F1'}}>
                              {emp.today_completed}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center" style={{background: '#F3F8FD'}}>
                            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl font-bold text-lg text-blue-800"
                              style={{background: '#E8F1FB'}}>
                              {emp.overall_completed || 0}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center"><span className="font-semibold text-slate-800">{emp.total_assigned || 0}</span></td>
                          <td className="px-4 py-3 text-center"><span className="font-semibold text-blue-700">{emp.completed}</span></td>
                          <td className="px-4 py-3 text-center"><span className="font-semibold text-amber-600">{emp.pending}</span></td>
                          <td className="px-4 py-3 w-36">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full overflow-hidden bg-slate-100">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #0D47A1, #1565C0)' }} />
                              </div>
                              <span className="text-xs font-semibold text-slate-500 w-8">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="text-blue-700 hover:bg-blue-50 h-8 w-8 p-0" onClick={() => handleViewColonyProgress(emp)} title="View Colonies">
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-teal-700 hover:bg-teal-50 h-8 w-8 p-0" onClick={() => navigate(`/admin/submissions?employee_id=${emp.employee_id}`)} title="View Submissions">
                                <ClipboardCheck className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-30" /> No employee data available
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Employee Colony Progress Dialog */}
      <Dialog open={colonyDialog} onOpenChange={setColonyDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">
                {selectedEmployee?.employee_name?.charAt(0)}
              </div>
              <div>
                <span className="text-lg">{selectedEmployee?.employee_name}</span>
                <p className="text-sm text-slate-500 font-normal">Colony-wise Progress</p>
              </div>
            </DialogTitle>
          </DialogHeader>
          {loadingColonies ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
          ) : colonyProgress.length === 0 ? (
            <div className="text-center py-12 text-slate-400"><MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No colonies assigned</p></div>
          ) : (
            <div className="space-y-3">
              {colonyProgress.map((colony, idx) => (
                <div key={idx} className="p-4 border rounded-lg hover:border-blue-200 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-blue-500" />
                      <span className="font-semibold text-slate-900">{colony.colony}</span>
                    </div>
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleOpenRemoveDialog(colony)}>
                      <Trash2 className="w-4 h-4 mr-1" /> Remove
                    </Button>
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${colony.percentage >= 80 ? 'bg-emerald-500' : colony.percentage >= 50 ? 'bg-blue-500' : colony.percentage >= 25 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${colony.percentage}%` }} />
                    </div>
                    <span className={`text-sm font-bold ${colony.percentage >= 80 ? 'text-emerald-600' : colony.percentage >= 50 ? 'text-blue-600' : colony.percentage >= 25 ? 'text-amber-600' : 'text-red-600'}`}>
                      {colony.percentage}%
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="p-2 bg-slate-50 rounded"><p className="text-lg font-bold text-slate-700">{colony.total}</p><p className="text-xs text-slate-500">Total</p></div>
                    <div className="p-2 bg-emerald-50 rounded"><p className="text-lg font-bold text-emerald-600">{colony.completed}</p><p className="text-xs text-emerald-600">Done</p></div>
                    <div className="p-2 bg-amber-50 rounded"><p className="text-lg font-bold text-amber-600">{colony.pending}</p><p className="text-xs text-amber-600">Pending</p></div>
                    <div className="p-2 bg-red-50 rounded"><p className="text-lg font-bold text-red-600">{colony.rejected}</p><p className="text-xs text-red-600">Rejected</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setColonyDialog(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove from Colony Confirmation */}
      <AlertDialog open={removeDialog} onOpenChange={setRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600"><Trash2 className="w-5 h-5" /> Remove from Colony</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{selectedEmployee?.employee_name}</strong> from <strong>{colonyToRemove?.colony}</strong>?
              <br /><br />This will unassign <strong>{colonyToRemove?.total}</strong> properties ({colonyToRemove?.completed} completed, {colonyToRemove?.pending} pending).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveFromColony} disabled={removing} className="bg-red-600 hover:bg-red-700">
              {removing ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Removing...</>) : 'Yes, Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Report Filter Dialog */}
      <Dialog open={reportDialog} onOpenChange={setReportDialog}>
        <DialogContent className="max-w-lg" data-testid="report-filter-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-indigo-600" />
              Download Surveyor Report
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Month & Year Row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Month</Label>
                <Select value={reportFilters.month} onValueChange={(v) => setReportFilters(f => ({...f, month: v}))}>
                  <SelectTrigger data-testid="report-filter-month"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...Array(12)].map((_, i) => (
                      <SelectItem key={i+1} value={(i+1).toString()}>
                        {new Date(2000, i, 1).toLocaleString('en', {month: 'long'})}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Year</Label>
                <Select value={reportFilters.year} onValueChange={(v) => setReportFilters(f => ({...f, year: v}))}>
                  <SelectTrigger data-testid="report-filter-year"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map(y => (
                      <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Date From</Label>
                <input type="date" data-testid="report-filter-date-from" value={reportFilters.date_from}
                  onChange={(e) => setReportFilters(f => ({...f, date_from: e.target.value}))}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Date To</Label>
                <input type="date" data-testid="report-filter-date-to" value={reportFilters.date_to}
                  onChange={(e) => setReportFilters(f => ({...f, date_to: e.target.value}))}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
            </div>
            <p className="text-[10px] text-slate-400 -mt-2">Date range overrides Month/Year if both provided</p>

            {/* Surveyor */}
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1 block">Surveyor</Label>
              <Select value={reportFilters.surveyor_id} onValueChange={(v) => setReportFilters(f => ({...f, surveyor_id: v === '_all' ? '' : v}))}>
                <SelectTrigger data-testid="report-filter-surveyor"><SelectValue placeholder="All Surveyors" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Surveyors</SelectItem>
                  {employeeProgress.map(emp => (
                    <SelectItem key={emp.employee_id} value={emp.employee_id}>{emp.employee_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Colony */}
            <div>
              <Label className="text-xs font-medium text-slate-600 mb-1 block">Colony</Label>
              <Select value={reportFilters.colony} onValueChange={(v) => setReportFilters(f => ({...f, colony: v === '_all' ? '' : v}))}>
                <SelectTrigger data-testid="report-filter-colony"><SelectValue placeholder="All Colonies" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Colonies</SelectItem>
                  {colonies.map(c => (
                    <SelectItem key={c.name} value={c.name}>{c.name} ({c.count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Category & Status Row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Category</Label>
                <Select value={reportFilters.category} onValueChange={(v) => setReportFilters(f => ({...f, category: v === '_all' ? '' : v}))}>
                  <SelectTrigger data-testid="report-filter-category"><SelectValue placeholder="All Categories" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All Categories</SelectItem>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="vacant_plot">Vacant Plot</SelectItem>
                    <SelectItem value="mix_use">Mix Use</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="institutional">Institutional</SelectItem>
                    <SelectItem value="special_category">Special Category</SelectItem>
                    <SelectItem value="agriculture">Agriculture</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-600 mb-1 block">Status</Label>
                <Select value={reportFilters.status} onValueChange={(v) => setReportFilters(f => ({...f, status: v === '_all' ? '' : v}))}>
                  <SelectTrigger data-testid="report-filter-status"><SelectValue placeholder="All Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All Status</SelectItem>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" size="sm" data-testid="report-filter-reset"
              onClick={() => setReportFilters({
                month: (new Date().getMonth() + 1).toString(),
                year: new Date().getFullYear().toString(),
                surveyor_id: '', date_from: '', date_to: '', colony: '', category: '', status: ''
              })}>
              Reset Filters
            </Button>
            <Button className="bg-blue-700 hover:bg-blue-800 text-white flex items-center gap-2" 
              data-testid="report-filter-download" onClick={handleDownloadReport} disabled={downloadingReport}>
              {downloadingReport ? (<><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>) : (<><Download className="w-4 h-4" /> Download Excel</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
