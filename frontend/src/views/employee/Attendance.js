import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import 'leaflet/dist/leaflet.css';
import {
  Camera,
  CheckCircle,
  MapPin,
  Loader2,
  ArrowLeft,
  Clock,
  CalendarCheck,
  User,
  AlertTriangle,
  Download,
  Navigation,
  FileText,
  List
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom numbered marker
const createNumberedIcon = (number, status) => {
  const colors = {
    'Pending': '#f97316',
    'Completed': '#22c55e',
    'Approved': '#22c55e',
    'In Progress': '#3b82f6',
    'Rejected': '#ef4444',
    'default': '#6b7280'
  };
  const color = colors[status] || colors['default'];
  
  return L.divIcon({
    className: 'custom-numbered-marker',
    html: `<div style="
      background-color: ${color};
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      color: white;
    ">${number}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11]
  });
};

// Component to fit map bounds
function FitBounds({ properties }) {
  const map = useMap();
  useEffect(() => {
    if (properties.length > 0) {
      const validProps = properties.filter(p => p.latitude && p.longitude);
      if (validProps.length > 0) {
        const bounds = L.latLngBounds(validProps.map(p => [p.latitude, p.longitude]));
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      }
    }
  }, [properties, map]);
  return null;
}

export default function Attendance() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hasAttendance, setHasAttendance] = useState(false);
  const [attendanceData, setAttendanceData] = useState(null);
  
  // GPS State
  const [gpsStatus, setGpsStatus] = useState('idle');
  const [location, setLocation] = useState({ latitude: null, longitude: null });
  
  // Selfie State
  const [selfie, setSelfie] = useState(null);
  const [selfiePreview, setSelfiePreview] = useState(null);
  const [capturing, setCapturing] = useState(false);
  
  // Properties/Map State
  const [properties, setProperties] = useState([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [stats, setStats] = useState({ total: 0, pending: 0, completed: 0 });
  const mapContainerRef = useRef(null);
  
  const cameraRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    checkTodayAttendance();
  }, []);

  // Fetch properties when attendance is marked
  useEffect(() => {
    if (hasAttendance) {
      fetchProperties();
    }
  }, [hasAttendance]);

  const fetchProperties = async () => {
    setLoadingProps(true);
    try {
      const response = await axios.get(`${API_URL}/employee/properties?limit=1000`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const props = response.data.properties || [];
      setProperties(props);
      
      const pending = props.filter(p => p.status === 'Pending').length;
      const completed = props.filter(p => ['Completed', 'Approved'].includes(p.status)).length;
      setStats({ total: props.length, pending, completed });
    } catch (error) {
      console.error('Failed to load properties:', error);
    } finally {
      setLoadingProps(false);
    }
  };

  const getDefaultCenter = () => {
    const validProps = properties.filter(p => p.latitude && p.longitude);
    if (validProps.length > 0) {
      return [validProps[0].latitude, validProps[0].longitude];
    }
    return [29.9695, 76.8783];
  };

  // Download map as PDF
  const handlePrintMap = async () => {
    if (!mapContainerRef.current) {
      toast.error('Map not ready');
      return;
    }
    setDownloading(true);
    toast.info('Generating PDF...');
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const canvas = await html2canvas(mapContainerRef.current, {
        useCORS: true, allowTaint: true, scale: 2, logging: false, backgroundColor: '#ffffff'
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('PUBLIC HEALTH ENGINEERING DEPARTMENT - (PHED)', 105, 12, { align: 'center' });
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Property Survey Map', 105, 18, { align: 'center' });
      pdf.text(`Surveyor: ${user?.name || '-'}  |  Date: ${new Date().toLocaleDateString('en-IN')}`, 105, 24, { align: 'center' });
      pdf.text(`Total: ${stats.total}  |  Pending: ${stats.pending}  |  Done: ${stats.completed}`, 105, 30, { align: 'center' });
      
      const imgWidth = 190;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 10, 35, imgWidth, Math.min(imgHeight, 240));
      
      pdf.setFontSize(8);
      pdf.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 10, 287);
      
      pdf.save(`survey_map_${new Date().toISOString().split('T')[0]}.pdf`);
      toast.success('Map PDF downloaded!');
    } catch (error) {
      toast.error('Failed to generate PDF');
    } finally {
      setDownloading(false);
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
    } finally {
      setLoading(false);
    }
  };

  const getLocation = () => {
    setGpsStatus('loading');
    if (!navigator.geolocation) {
      setGpsStatus('error');
      toast.error('GPS not supported on this device');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        setGpsStatus('success');
        toast.success('GPS location captured!');
      },
      (error) => {
        setGpsStatus('error');
        toast.error('Failed to get GPS. Please enable location services.');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const startCamera = async () => {
    try {
      setCapturing(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      toast.error('Failed to access camera. Please grant camera permissions.');
      setCapturing(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);
    
    canvas.toBlob((blob) => {
      const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
      setSelfie(file);
      setSelfiePreview(URL.createObjectURL(blob));
      stopCamera();
      toast.success('Selfie captured!');
    }, 'image/jpeg', 0.9);
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCapturing(false);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelfie(file);
      setSelfiePreview(URL.createObjectURL(file));
      toast.success('Selfie uploaded!');
    }
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (!location.latitude || !location.longitude) {
      toast.error('Please capture GPS location first');
      return;
    }
    if (!selfie) {
      toast.error('Please take a selfie');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('selfie', selfie);
      formData.append('latitude', location.latitude);
      formData.append('longitude', location.longitude);
      formData.append('authorization', `Bearer ${token}`);

      await axios.post(`${API_URL}/employee/attendance`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      toast.success('Attendance marked successfully!');
      // Stay on page and show map
      checkTodayAttendance();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to mark attendance');
    } finally {
      setSubmitting(false);
    }
  };

  const retakeSelfie = () => {
    setSelfie(null);
    setSelfiePreview(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="flex items-center px-4 h-14">
          <button
            onClick={() => navigate('/employee')}
            className="mr-3 text-slate-500"
            data-testid="back-btn"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-heading font-semibold text-slate-900">Daily Attendance</h1>
            <p className="text-xs text-slate-500">{today}</p>
          </div>
        </div>
      </header>

      <main className="p-4 space-y-4" data-testid="attendance-page">
        {hasAttendance ? (
          // Already marked attendance - Show map below
          <div className="space-y-4">
            <Card className="border-emerald-300 bg-emerald-50">
              <CardContent className="py-6 text-center">
                <div className="w-16 h-16 mx-auto mb-3 bg-emerald-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
                <h2 className="text-lg font-bold text-emerald-800 mb-1">Attendance Marked!</h2>
                {attendanceData && (
                  <p className="text-sm text-emerald-600">
                    {new Date(attendanceData.marked_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Stats Bar */}
            <div className="bg-white rounded-lg border p-3">
              <div className="flex items-center justify-around text-center">
                <div>
                  <p className="text-xl font-bold text-slate-800">{stats.total}</p>
                  <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div>
                  <p className="text-xl font-bold text-orange-600">{stats.pending}</p>
                  <p className="text-xs text-slate-500">Pending</p>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div>
                  <p className="text-xl font-bold text-emerald-600">{stats.completed}</p>
                  <p className="text-xs text-slate-500">Done</p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                onClick={handlePrintMap}
                disabled={downloading || properties.length === 0}
              >
                {downloading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                Print Map PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/employee/properties')}
              >
                <List className="w-4 h-4 mr-1" />
                List View
              </Button>
            </div>

            {/* Property Map */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-slate-500 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Survey Properties Map
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div ref={mapContainerRef} style={{ height: '400px' }} className="rounded-b-lg overflow-hidden">
                  {loadingProps ? (
                    <div className="h-full flex items-center justify-center bg-slate-100">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                  ) : properties.length === 0 ? (
                    <div className="h-full flex items-center justify-center bg-slate-100">
                      <div className="text-center text-slate-500">
                        <MapPin className="w-12 h-12 mx-auto mb-2 opacity-30" />
                        <p>No properties assigned</p>
                      </div>
                    </div>
                  ) : (
                    <MapContainer
                      center={getDefaultCenter()}
                      zoom={14}
                      minZoom={5}
                      maxZoom={18}
                      maxBounds={[[-85, -180], [85, 180]]}
                      maxBoundsViscosity={1.0}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={true}
                    >
                      <TileLayer
                        attribution='&copy; OpenStreetMap'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <FitBounds properties={properties} />
                      
                      {properties.filter(p => p.latitude && p.longitude).map((property, index) => (
                        <Marker
                          key={property.id}
                          position={[property.latitude, property.longitude]}
                          icon={createNumberedIcon(property.serial_number || index + 1, property.status)}
                        >
                          <Popup maxWidth={250}>
                            <div className="p-1 min-w-[180px]">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-blue-600">#{property.serial_number || index + 1}</span>
                                <span className={`px-1.5 py-0.5 rounded text-xs ${
                                  property.status === 'Pending' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
                                }`}>{property.status}</span>
                              </div>
                              <p className="font-semibold text-sm">{property.owner_name}</p>
                              <p className="text-xs text-slate-500 mb-2">{property.address || property.colony}</p>
                              <div className="flex gap-1">
                                <Button size="sm" className="flex-1 h-7 text-xs bg-blue-600" onClick={() => navigate(`/employee/phed-survey/${property.id}`)}>
                                  <FileText className="w-3 h-3 mr-1" /> Survey
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${property.latitude},${property.longitude}`, '_blank')}>
                                  <Navigation className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                    </MapContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-center text-slate-400">
              Tap marker for details • Click "Print Map PDF" for hard copy
            </p>
          </div>
        ) : (
          // Mark attendance
          <div className="space-y-4">
            {/* User Info */}
            <Card className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-blue-100 text-sm">Good Morning,</p>
                    <p className="text-xl font-bold">{user?.name}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Instructions */}
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-amber-800">Mark Your Attendance</p>
                    <p className="text-sm text-amber-700">
                      Take a selfie to mark your morning attendance. This is required once per day before starting surveys.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* GPS Capture */}
            <Card className={`${
              gpsStatus === 'success' ? 'border-emerald-300 bg-emerald-50' :
              gpsStatus === 'error' ? 'border-red-300 bg-red-50' :
              'border-slate-200'
            }`}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {gpsStatus === 'loading' ? (
                      <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                    ) : gpsStatus === 'success' ? (
                      <CheckCircle className="w-6 h-6 text-emerald-600" />
                    ) : (
                      <MapPin className="w-6 h-6 text-slate-400" />
                    )}
                    <div>
                      <p className="font-semibold text-slate-900">
                        {gpsStatus === 'success' ? '✓ Location Captured' : 'Step 1: Capture Location'}
                      </p>
                      {location.latitude ? (
                        <p className="text-xs font-mono text-slate-600">
                          {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">Required for attendance</p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={getLocation}
                    className={gpsStatus === 'success' ? 'bg-emerald-600' : 'bg-blue-600'}
                    data-testid="capture-gps-btn"
                  >
                    <MapPin className="w-4 h-4 mr-1" />
                    {gpsStatus === 'success' ? 'Recapture' : 'Capture'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Selfie Capture */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-slate-500">
                  Step 2: Take a Selfie
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Hidden file input */}
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {capturing ? (
                  <div className="space-y-3">
                    <div className="relative rounded-lg overflow-hidden bg-black">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-64 object-cover"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700"
                        onClick={capturePhoto}
                      >
                        <Camera className="w-5 h-5 mr-2" />
                        Capture
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 h-12"
                        onClick={stopCamera}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : selfiePreview ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <img
                        src={selfiePreview}
                        alt="Selfie"
                        className="w-full h-64 object-cover rounded-lg border-2 border-emerald-200"
                      />
                      <div className="absolute top-2 right-2 px-2 py-1 bg-emerald-500 text-white text-xs font-bold rounded">
                        ✓ Selfie Ready
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full h-12"
                      onClick={retakeSelfie}
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Retake Selfie
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="h-48 flex flex-col items-center justify-center bg-slate-100 rounded-lg border-2 border-dashed border-slate-300">
                      <Camera className="w-12 h-12 text-slate-300 mb-2" />
                      <p className="text-slate-500 text-sm">Take a selfie for attendance</p>
                    </div>
                    <Button
                      className="w-full h-14 bg-blue-600 hover:bg-blue-700"
                      onClick={startCamera}
                      disabled={!location.latitude}
                    >
                      <Camera className="w-5 h-5 mr-2" />
                      Take Selfie
                    </Button>
                    {!location.latitude && (
                      <p className="text-center text-amber-600 text-sm">
                        Please capture GPS location first
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Submit Button */}
      {!hasAttendance && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-200 shadow-lg">
          <Button
            onClick={handleSubmit}
            disabled={submitting || !location.latitude || !selfie}
            className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400"
            data-testid="submit-attendance-btn"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <CalendarCheck className="w-5 h-5 mr-2" />
                Mark Attendance
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
