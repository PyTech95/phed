import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Calendar,
  User,
  Clock,
  MapPin,
  Search,
  CheckCircle,
  XCircle,
  Loader2,
  Image,
  ChevronLeft,
  ChevronRight,
  Map,
  Navigation
} from 'lucide-react';

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom marker for employee location
const createEmployeeIcon = (name) => {
  return L.divIcon({
    className: 'employee-marker',
    html: `<div style="
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: white;
    ">${name.charAt(0).toUpperCase()}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
  });
};

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export default function AttendancePage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [attendance, setAttendance] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [filters, setFilters] = useState({
    employee_id: '',
    date: new Date().toISOString().split('T')[0]
  });
  const [stats, setStats] = useState({
    present: 0,
    absent: 0,
    total: 0
  });
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    fetchAttendance();
  }, [filters, pagination.page]);

  const fetchEmployees = async () => {
    try {
      const response = await axios.get(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const empList = (response.data || []).filter(u => u.role !== 'ADMIN');
      setEmployees(empList);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
    }
  };

  const fetchAttendance = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.employee_id) params.append('employee_id', filters.employee_id);
      if (filters.date) params.append('date', filters.date);
      params.append('page', pagination.page);
      params.append('limit', 20);

      const response = await axios.get(`${API_URL}/admin/attendance?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setAttendance(response.data.attendance || []);
      setPagination(prev => ({
        ...prev,
        total: response.data.total || 0,
        pages: response.data.pages || 1
      }));
      
      // Calculate stats
      const present = response.data.attendance?.length || 0;
      const total = employees.length;
      setStats({
        present,
        absent: total - present,
        total
      });
    } catch (error) {
      console.error('Failed to fetch attendance:', error);
      setAttendance([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <AdminLayout title="Attendance">
      <div data-testid="attendance-page" className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-heading font-bold text-slate-900">Employee Attendance</h1>
            <p className="text-slate-500">Track daily attendance of field employees</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-600">{stats.present}</p>
                  <p className="text-sm text-slate-500">Present Today</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{stats.absent}</p>
                  <p className="text-sm text-slate-500">Absent Today</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <User className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
                  <p className="text-sm text-slate-500">Total Employees</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                <Input
                  type="date"
                  value={filters.date}
                  onChange={(e) => setFilters({ ...filters, date: e.target.value })}
                  className="w-40"
                />
              </div>

              <Select
                value={filters.employee_id}
                onValueChange={(value) => setFilters({ ...filters, employee_id: value })}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All Employees</SelectItem>
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={() => setFilters({ employee_id: '', date: new Date().toISOString().split('T')[0] })}
              >
                Clear Filters
              </Button>

              <Button
                variant={showMap ? "default" : "outline"}
                onClick={() => setShowMap(!showMap)}
                className={showMap ? "bg-blue-600 hover:bg-blue-700" : ""}
              >
                <Map className="w-4 h-4 mr-2" />
                {showMap ? 'Hide Map' : 'View GPS Locations'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* GPS Tracker Map */}
        {showMap && attendance.filter(r => r.latitude && r.longitude).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Navigation className="w-4 h-4" />
                Employee GPS Locations ({attendance.filter(r => r.latitude && r.longitude).length} tracked)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg overflow-hidden border border-slate-200" style={{ height: '400px' }}>
                <MapContainer
                  center={[
                    attendance.filter(r => r.latitude)[0]?.latitude || 28.6139,
                    attendance.filter(r => r.longitude)[0]?.longitude || 77.209
                  ]}
                  zoom={10}
                  minZoom={5}
                  maxZoom={18}
                  style={{ height: '100%', width: '100%' }}
                  scrollWheelZoom={true}
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {attendance.filter(r => r.latitude && r.longitude).map((record) => (
                    <Marker
                      key={record.id}
                      position={[record.latitude, record.longitude]}
                      icon={createEmployeeIcon(record.employee_name)}
                    >
                      <Popup>
                        <div className="p-1 min-w-[180px]">
                          <div className="flex items-center gap-2 mb-2">
                            {record.selfie_url && (
                              <img
                                src={`${process.env.REACT_APP_BACKEND_URL}${record.selfie_url}`}
                                alt="Selfie"
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            )}
                            <div>
                              <p className="font-bold text-slate-800">{record.employee_name}</p>
                              <p className="text-xs text-slate-500">{record.date}</p>
                            </div>
                          </div>
                          <div className="text-xs space-y-1">
                            <p className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTime(record.marked_at)}
                            </p>
                            <p className="flex items-center gap-1 font-mono text-slate-600">
                              <MapPin className="w-3 h-3" />
                              {record.latitude?.toFixed(6)}, {record.longitude?.toFixed(6)}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full mt-2 h-7 text-xs"
                            onClick={() => window.open(`https://www.google.com/maps?q=${record.latitude},${record.longitude}`, '_blank')}
                          >
                            <Navigation className="w-3 h-3 mr-1" />
                            Open in Google Maps
                          </Button>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
              <p className="text-xs text-slate-400 mt-2 text-center">
                Click on markers to view employee details • Green markers show attendance check-in locations
              </p>
            </CardContent>
          </Card>
        )}

        {/* Attendance List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : attendance.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar className="w-12 h-12 mx-auto text-slate-300 mb-4" />
              <h3 className="font-heading font-semibold text-slate-900 mb-2">No attendance records</h3>
              <p className="text-slate-500">No attendance marked for the selected date</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {attendance.map((record) => (
              <Card key={record.id}>
                <CardContent className="py-4">
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Selfie */}
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                      {record.selfie_url ? (
                        <img
                          src={`${process.env.REACT_APP_BACKEND_URL}${record.selfie_url}`}
                          alt="Selfie"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Image className="w-6 h-6 text-slate-400" />
                        </div>
                      )}
                    </div>

                    {/* Employee Info */}
                    <div className="flex-1 min-w-[200px]">
                      <h3 className="font-semibold text-slate-900">{record.employee_name}</h3>
                      <p className="text-sm text-slate-500">{record.employee_username}</p>
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="font-medium">{formatTime(record.marked_at)}</p>
                        <p className="text-xs text-slate-500">{formatDate(record.marked_at)}</p>
                      </div>
                    </div>

                    {/* Location */}
                    {record.latitude && record.longitude && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="w-4 h-4 text-slate-400" />
                        <div>
                          <p className="font-mono text-xs">
                            {record.latitude?.toFixed(6)}, {record.longitude?.toFixed(6)}
                          </p>
                          <Button
                            size="sm"
                            variant="link"
                            className="h-auto p-0 text-xs text-blue-600"
                            onClick={() => window.open(`https://www.google.com/maps?q=${record.latitude},${record.longitude}`, '_blank')}
                          >
                            View on Google Maps →
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Status */}
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                        <CheckCircle className="w-3 h-3" />
                        Present
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
              disabled={pagination.page <= 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-slate-600">
              Page {pagination.page} of {pagination.pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
              disabled={pagination.page >= pagination.pages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
