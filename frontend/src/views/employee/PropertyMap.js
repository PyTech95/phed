import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import 'leaflet/dist/leaflet.css';
import {
  ArrowLeft,
  Printer,
  Loader2,
  MapPin,
  Navigation,
  FileText,
  List,
  Map as MapIcon,
  Download,
  Lock,
  RefreshCw
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

const CATEGORIES = ['Residential', 'Commercial', 'Institutional', 'Industrial', 'Mixed', 'Other'];

// Center-crosshair placement: as the surveyor pans the map, the point under the
// fixed centre crosshair becomes the new property's location. Tapping recentres there too.
function CenterPicker({ active, onCenter }) {
  const map = useMap();
  useMapEvents({
    moveend() {
      if (!active) return;
      const c = map.getCenter();
      onCenter({ latitude: c.lat, longitude: c.lng });
    },
    click(e) {
      if (active) map.setView(e.latlng, map.getZoom());
    },
  });
  useEffect(() => {
    if (active) {
      const c = map.getCenter();
      onCenter({ latitude: c.lat, longitude: c.lng });
    }
  }, [active, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom numbered marker - SAME COLORS AS ADMIN MAP
const createNumberedIcon = (number, status) => {
  const colors = {
    'Pending': '#ef4444',       // RED - same as admin
    'Not Started': '#ef4444',
    'In Progress': '#eab308',   // YELLOW - same as admin
    'Draft': '#eab308',
    'Completed': '#eab308',     // YELLOW - same as admin
    'Submitted': '#3b82f6',     // BLUE - awaiting review
    'Requires Review': '#f59e0b',
    'Approved': '#22c55e',      // GREEN - same as admin
    'No PHED Connection': '#64748b',
    'Rejected': '#f97316',      // ORANGE - same as admin
    'default': '#ef4444'        // RED
  };
  
  const color = colors[status] || colors['default'];
  
  return L.divIcon({
    className: 'custom-numbered-marker',
    html: `<div style="
      background-color: ${color};
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      color: white;
      font-family: Arial, sans-serif;
    ">${number}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
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
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      }
    }
  }, [properties, map]);
  
  return null;
}

export default function PropertyMap() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [stats, setStats] = useState({ total: 0, pending: 0, completed: 0 });
  const [showAdd, setShowAdd] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addGps, setAddGps] = useState(null);
  const [addForm, setAddForm] = useState({ owner_name: '', mobile: '', alternate_mobile: '', ward: '', colony: '', address: '', category: 'Residential' });
  const [nearbyDupes, setNearbyDupes] = useState([]);
  const [wards, setWards] = useState([]);

  const findNearby = (lat, lng, radiusM = 30) => {
    const toR = (d) => (d * Math.PI) / 180, R = 6371000;
    return (properties || []).filter((p) => p.latitude != null && p.longitude != null).map((p) => {
      const dLat = toR(p.latitude - lat), dLng = toR(p.longitude - lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat)) * Math.cos(toR(p.latitude)) * Math.sin(dLng / 2) ** 2;
      return { p, d: Math.round(2 * R * Math.asin(Math.sqrt(h))) };
    }).filter((x) => x.d <= radiusM).sort((a, b) => a.d - b.d);
  };

  // Set the new-property location (from a map tap, marker drag, or GPS) and refresh the nearby-duplicate hint
  const pickLocation = (g) => {
    setAddGps({ latitude: g.latitude, longitude: g.longitude, accuracy: g.accuracy ?? null });
    setNearbyDupes(findNearby(g.latitude, g.longitude));
  };

  const useMyLocationForAdd = () => {
    if (!navigator.geolocation) return toast.error('इस device पर GPS नहीं है');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const g = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
        if (mapRef.current) mapRef.current.setView([g.latitude, g.longitude], Math.max(mapRef.current.getZoom(), 18));
        pickLocation(g);
        toast.success('आपकी location पर पहुँच गए — बीच के निशान को सही जगह ले जाएँ');
      },
      () => toast.error('Location नहीं मिली — GPS on करें'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const openAddProperty = () => {
    setAddForm({ owner_name: '', mobile: '', alternate_mobile: '', ward: '', colony: '', address: '', category: 'Residential' });
    setAddGps(null); setNearbyDupes([]); setShowAdd(false); setPlacing(true);
    toast.info('📍 Map को हिलाकर बीच के हरे निशान को property की जगह पर ले जाएँ — या "मेरी location" दबाएँ');
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const g = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
          if (mapRef.current) mapRef.current.setView([g.latitude, g.longitude], Math.max(mapRef.current.getZoom(), 18));
          pickLocation(g);
        },
        () => { /* no GPS — user will move the map under the crosshair */ },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    }
  };

  const cancelPlacing = () => { setPlacing(false); setAddGps(null); setNearbyDupes([]); };

  const confirmPin = () => {
    if (!addGps) return toast.error('पहले map हिलाकर बीच के निशान से जगह चुनें');
    setPlacing(false); setShowAdd(true);
  };

  const changeLocation = () => { setShowAdd(false); setPlacing(true); toast.info('📍 Map हिलाकर बीच के निशान को सही जगह ले जाएँ'); };

  const submitAddProperty = async () => {
    toast.dismiss();
    if (!addForm.owner_name.trim()) return toast.error('Owner नाम ज़रूरी है');
    if (!addForm.mobile.trim()) return toast.error('Mobile number ज़रूरी है');
    if (!addForm.ward.trim()) return toast.error('Ward number ज़रूरी है');
    if (!addForm.colony.trim()) return toast.error('Colony ज़रूरी है');
    if (!addForm.category.trim()) return toast.error('Category ज़रूरी है');
    if (!addGps) return toast.error('Location ज़रूरी है — map पर जगह चुनें');
    setAdding(true);
    try {
      const { data } = await axios.post(`${API_URL}/phed/field-properties`,
        { ...addForm, latitude: addGps.latitude, longitude: addGps.longitude },
        { headers: { Authorization: `Bearer ${token}` } });
      toast.success('नई property add हो गई');
      setShowAdd(false); setPlacing(false); setAddGps(null);
      navigate(`/employee/phed-survey/${data.id}`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Add failed'); } finally { setAdding(false); }
  };

  useEffect(() => {
    fetchProperties();
    
    // Auto-refresh every 30 seconds to get updated statuses
    const refreshInterval = setInterval(() => {
      fetchProperties();
    }, 30000);
    
    return () => clearInterval(refreshInterval);
  }, []);

  // Load ward -> colony master (Thanesar ward-wise colony list) for the Add Property form
  useEffect(() => {
    axios.get(`${API_URL}/phed/wards`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setWards((r.data.wards || []).slice().sort((a, b) => (parseInt(a.ward_number, 10) || 0) - (parseInt(b.ward_number, 10) || 0))))
      .catch(() => {});
  }, [token]);

  const fetchProperties = async () => {
    try {
      // Fetch all properties (no pagination limit)
      const response = await axios.get(`${API_URL}/employee/properties?limit=1000`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const props = response.data.properties || [];
      setProperties(props);
      
      // Calculate stats
      const pending = props.filter(p => p.status === 'Pending').length;
      const completed = props.filter(p => ['Completed', 'Approved'].includes(p.status)).length;
      setStats({
        total: props.length,
        pending,
        completed
      });
    } catch (error) {
      toast.error('Failed to load properties');
    } finally {
      setLoading(false);
    }
  };

  // Get default center from properties or fallback
  const getDefaultCenter = () => {
    const validProps = properties.filter(p => p.latitude && p.longitude);
    if (validProps.length > 0) {
      return [validProps[0].latitude, validProps[0].longitude];
    }
    return [29.9695, 76.8783]; // Default Kurukshetra
  };

  // Download map as A4 PDF
  const handlePrintMap = async () => {
    if (!mapContainerRef.current) {
      toast.error('Map not ready');
      return;
    }

    setDownloading(true);
    toast.info('Generating PDF... Please wait');

    try {
      // Wait for map to fully render
      await new Promise(resolve => setTimeout(resolve, 1000));

      const canvas = await html2canvas(mapContainerRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      // A4 dimensions
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10;
      
      // Add header
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('PUBLIC HEALTH ENGINEERING DEPARTMENT - (PHED)', pageWidth / 2, 15, { align: 'center' });
      
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.text('PHED Consumer Survey Map', pageWidth / 2, 22, { align: 'center' });
      
      // Add surveyor info
      pdf.setFontSize(10);
      pdf.text(`Surveyor: ${user?.name || '-'}`, margin, 32);
      pdf.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, margin, 38);
      pdf.text(`Total Properties: ${stats.total}`, pageWidth - margin - 50, 32);
      pdf.text(`Pending: ${stats.pending} | Completed: ${stats.completed}`, pageWidth - margin - 50, 38);
      
      // Add map image
      const imgWidth = pageWidth - (margin * 2);
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const maxImgHeight = pageHeight - 60; // Leave space for header and footer
      
      const finalHeight = Math.min(imgHeight, maxImgHeight);
      const finalWidth = (finalHeight === maxImgHeight) ? (canvas.width * finalHeight) / canvas.height : imgWidth;
      
      const xPos = (pageWidth - finalWidth) / 2;
      pdf.addImage(imgData, 'PNG', xPos, 45, finalWidth, finalHeight);
      
      // Add legend
      const legendY = 45 + finalHeight + 5;
      if (legendY < pageHeight - 20) {
        pdf.setFontSize(8);
        pdf.setFillColor(249, 115, 22); // Orange
        pdf.circle(margin + 3, legendY, 2, 'F');
        pdf.text('Pending', margin + 8, legendY + 1);
        
        pdf.setFillColor(34, 197, 94); // Green
        pdf.circle(margin + 35, legendY, 2, 'F');
        pdf.text('Completed', margin + 40, legendY + 1);
      }
      
      // Add footer
      pdf.setFontSize(8);
      pdf.text(`Generated: ${new Date().toLocaleString('en-IN')}`, margin, pageHeight - 10);
      pdf.text('PHED Survey & Notice Distribution', pageWidth - margin, pageHeight - 10, { align: 'right' });

      // Save PDF
      const filename = `survey_map_${user?.username || 'surveyor'}_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(filename);
      toast.success('Map PDF downloaded!');
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-[1000]">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center">
            <button
              onClick={() => navigate('/employee')}
              className="mr-3 text-slate-500"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-heading font-semibold text-slate-900">Survey Map</h1>
              <p className="text-xs text-slate-500">{stats.total} properties assigned</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/employee/properties')}
            >
              <List className="w-4 h-4 mr-1" />
              List
            </Button>
            <Button
              size="sm"
              onClick={handlePrintMap}
              disabled={downloading || properties.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              Print PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setLoading(true); fetchProperties(); }}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </header>

      {/* Stats Bar with Color Legend */}
      <div className="bg-white border-b px-4 py-2">
        <div className="flex items-center justify-around text-center">
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
            <p className="text-xs text-slate-500">Total</p>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <p className="text-2xl font-bold text-red-500">{stats.pending}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <p className="text-2xl font-bold text-emerald-600">{stats.completed}</p>
            <p className="text-xs text-slate-500">Done</p>
          </div>
        </div>
        {/* Color Legend - Same as Admin Map (decorative; never intercept marker clicks) */}
        <div className="flex items-center justify-center gap-4 mt-2 pt-2 border-t pointer-events-none">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-xs text-slate-600">Pending</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="text-xs text-slate-600">In Progress</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-xs text-slate-600">Approved</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-orange-500" />
            <span className="text-xs text-slate-600">Rejected</span>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative" ref={mapContainerRef}>
        {/* Fixed centre crosshair shown while placing a new property */}
        {placing && (
          <div className="pointer-events-none absolute inset-0 z-[1150] flex items-center justify-center" data-testid="center-crosshair">
            <div style={{ transform: 'translateY(-15px)' }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50% 50% 50% 0',
                background: '#16a34a', border: '3px solid white', transform: 'rotate(-45deg)',
                boxShadow: '0 3px 10px rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ transform: 'rotate(45deg)', color: 'white', fontWeight: 800, fontSize: 18, lineHeight: 1 }}>+</span>
              </div>
            </div>
          </div>
        )}
        {(
          <MapContainer
            center={getDefaultCenter()}
            zoom={14}
            minZoom={5}
            maxZoom={18}
            maxBounds={[[-85, -180], [85, 180]]}
            maxBoundsViscosity={1.0}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
            ref={mapRef}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds properties={properties} />
            <CenterPicker active={placing} onCenter={pickLocation} />
            
            {properties.filter(p => p.latitude && p.longitude).map((property, index) => (
              <Marker
                key={property.id}
                position={[property.latitude, property.longitude]}
                icon={createNumberedIcon(property.serial_number || index + 1, property.phed_survey_status || property.status)}
              >
                <Popup maxWidth={280}>
                  <div className="p-2 min-w-[200px]">
                    <div className="flex items-center justify-end mb-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        property.status === 'Pending' ? 'bg-red-100 text-red-700' :
                        property.status === 'In Progress' ? 'bg-yellow-100 text-yellow-700' :
                        property.status === 'Completed' ? 'bg-yellow-100 text-yellow-700' :
                        property.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
                        property.status === 'Rejected' ? 'bg-orange-100 text-orange-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {property.status}
                      </span>
                    </div>
                    
                    <p className="font-semibold text-slate-800">{property.owner_name}</p>
                    <p className="text-xs text-slate-500 mb-2">{property.address || property.colony}</p>
                    
                    {property.mobile && (
                      <p className="text-xs text-slate-600 mb-2">📱 {property.mobile}</p>
                    )}
                    
                    <div className="flex gap-2 mt-2">
                      <div className="w-full text-[11px] mb-1" data-testid={`map-phed-status-${property.id}`}>
                        PHED: <span className="font-semibold">{property.phed_survey_status || 'Not Started'}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs bg-blue-600"
                        onClick={() => navigate(`/employee/phed-survey/${property.id}`)}
                        data-testid={`map-phed-survey-${property.id}`}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        {['Submitted', 'Requires Review', 'Approved', 'No PHED Connection'].includes(property.phed_survey_status) ? 'View PHED Survey' : 'Water Bill Survey Update'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => {
                          window.open(`https://www.google.com/maps/dir/?api=1&destination=${property.latitude},${property.longitude}`, '_blank');
                        }}
                      >
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

      {/* Placement mode: tap map / drag pin / use GPS to set the new property's location */}
      {placing && (
        <>
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[1200] bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2" data-testid="placing-banner">
            <MapPin className="w-4 h-4 text-green-400" /> Map हिलाकर बीच के हरे निशान को property पर ले जाएँ
          </div>
          <div className="fixed left-4 right-4 bottom-24 z-[1200] bg-white rounded-2xl shadow-2xl p-3 flex items-center gap-2" data-testid="placing-bar">
            <Button variant="outline" className="h-11" onClick={cancelPlacing} data-testid="placing-cancel-btn">Cancel</Button>
            <Button variant="outline" className="h-11" onClick={useMyLocationForAdd} data-testid="use-my-location-btn"><Navigation className="w-4 h-4 mr-1" /> मेरी location</Button>
            <Button className="flex-1 h-11 text-white" style={{ background: addGps ? '#16a34a' : '#94a3b8' }} onClick={confirmPin} disabled={!addGps} data-testid="confirm-pin-btn">
              {addGps ? 'यहाँ details भरें →' : 'जगह चुनें'}
            </Button>
          </div>
        </>
      )}

      {/* Add Property floating button */}
      {!placing && !showAdd && (
      <button
        onClick={openAddProperty}
        className="fixed z-[1000] right-4 bottom-24 h-14 px-5 rounded-full shadow-lg text-white font-semibold flex items-center gap-2"
        style={{ background: '#2563eb' }}
        data-testid="add-property-btn"
      >
        <MapPin className="w-5 h-5" /> Add Property
      </button>
      )}

      {/* Add Property modal */}
      {showAdd && (
        <div className="fixed inset-0 z-[1100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !adding && setShowAdd(false)} data-testid="add-property-modal">
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">नई Property जोड़ें</h3>
              <button onClick={() => !adding && setShowAdd(false)} className="text-slate-400"><ArrowLeft className="w-5 h-5" /></button>
            </div>
            <div className="text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-1.5" style={{ background: '#eff6ff' }} data-testid="add-gps-status">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" style={{ color: addGps ? '#16a34a' : '#dc2626' }} />
                {addGps ? <>जगह चुन ली ✓ <span className="font-mono text-[10px] text-slate-500">{addGps.latitude.toFixed(5)}, {addGps.longitude.toFixed(5)}</span></> : 'जगह नहीं चुनी'}
              </span>
              <button type="button" className="text-blue-700 font-medium underline shrink-0" onClick={changeLocation} data-testid="change-location-btn">Map पर जगह बदलें</button>
            </div>
            <div><label className="text-xs font-medium text-slate-600">Owner name *</label><input className="w-full h-11 border rounded-lg px-3 mt-1" value={addForm.owner_name} onChange={(e) => setAddForm({ ...addForm, owner_name: e.target.value })} data-testid="add-owner-input" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium text-slate-600">Mobile *</label><input className="w-full h-11 border rounded-lg px-3 mt-1" inputMode="tel" value={addForm.mobile} onChange={(e) => setAddForm({ ...addForm, mobile: e.target.value })} data-testid="add-mobile-input" /></div>
              <div><label className="text-xs font-medium text-slate-600">Alternate</label><input className="w-full h-11 border rounded-lg px-3 mt-1" inputMode="tel" value={addForm.alternate_mobile} onChange={(e) => setAddForm({ ...addForm, alternate_mobile: e.target.value })} data-testid="add-alt-mobile-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium text-slate-600">Ward *</label>
                <select className="w-full h-11 border rounded-lg px-3 mt-1 bg-white" value={addForm.ward} onChange={(e) => setAddForm({ ...addForm, ward: e.target.value, colony: '' })} data-testid="add-ward-select">
                  <option value="">चुनें…</option>
                  {wards.map((w) => <option key={w.ward_number} value={w.ward_number}>Ward {w.ward_number}</option>)}
                </select>
              </div>
              <div><label className="text-xs font-medium text-slate-600">Category *</label>
                <select className="w-full h-11 border rounded-lg px-3 mt-1 bg-white" value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })} data-testid="add-category-select">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div><label className="text-xs font-medium text-slate-600">Colony *</label>
              {(() => {
                const wardColonies = wards.find((w) => w.ward_number === addForm.ward)?.colonies || [];
                if (addForm.ward && wardColonies.length === 0) {
                  return (
                    <input className="w-full h-11 border rounded-lg px-3 mt-1" placeholder="Colony का नाम लिखें" value={addForm.colony} onChange={(e) => setAddForm({ ...addForm, colony: e.target.value })} data-testid="add-colony-input" />
                  );
                }
                return (
                  <select className="w-full h-11 border rounded-lg px-3 mt-1 bg-white disabled:bg-slate-100" value={addForm.colony} onChange={(e) => setAddForm({ ...addForm, colony: e.target.value })} disabled={!addForm.ward} data-testid="add-colony-select">
                    <option value="">{addForm.ward ? 'Colony चुनें…' : 'पहले Ward चुनें'}</option>
                    {wardColonies.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                );
              })()}
            </div>
            <div><label className="text-xs font-medium text-slate-600">Address</label><input className="w-full h-11 border rounded-lg px-3 mt-1" value={addForm.address} onChange={(e) => setAddForm({ ...addForm, address: e.target.value })} data-testid="add-address-input" /></div>
            {nearbyDupes.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800" data-testid="duplicate-warning">
                <div className="font-semibold">⚠ पास में {nearbyDupes.length} property पहले से है (~{nearbyDupes[0].d} m):</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {nearbyDupes.slice(0, 3).map(({ p, d }) => (<li key={p.id}>{p.owner_name || 'Unknown'} <span className="font-mono">{p.property_id}</span> · {d} m</li>))}
                </ul>
                <div className="mt-1">क्या यह अलग property है? हाँ तो नीचे add करें।</div>
              </div>
            )}
            <Button onClick={submitAddProperty} disabled={adding || !addGps} className="w-full h-12 text-white" style={{ background: '#2563eb' }} data-testid="add-property-submit">
              {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />} {nearbyDupes.length > 0 ? 'फिर भी Add करें & Start Survey' : 'Add & Start Survey'}
            </Button>
          </div>
        </div>
      )}

      {/* Bottom Navigation Hint */}
      <div className="bg-white border-t px-4 py-3 text-center">
        <p className="text-xs text-slate-500">
          Tap a marker to view details • Use <strong>Print PDF</strong> for hard copy
        </p>
      </div>
    </div>
  );
}
