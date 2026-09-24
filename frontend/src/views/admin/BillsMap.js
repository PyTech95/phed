import { useState, useEffect, useMemo } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
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
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, MapPin, FileText, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Function to spread overlapping markers in a spiral pattern
const spreadOverlappingMarkers = (bills) => {
  const coordMap = {};
  const spreadBills = [];
  const OFFSET = 0.00015; // About 15 meters offset
  
  bills.forEach((bill) => {
    const key = `${bill.latitude},${bill.longitude}`;
    if (!coordMap[key]) {
      coordMap[key] = [];
    }
    coordMap[key].push(bill);
  });
  
  Object.values(coordMap).forEach((group) => {
    if (group.length === 1) {
      // Single marker, no change
      spreadBills.push({ ...group[0], spreadLat: group[0].latitude, spreadLng: group[0].longitude });
    } else {
      // Multiple markers at same location - spread in spiral pattern
      group.forEach((bill, index) => {
        if (index === 0) {
          // First marker stays at original position
          spreadBills.push({ ...bill, spreadLat: bill.latitude, spreadLng: bill.longitude });
        } else {
          // Spread others in a spiral
          const angle = (index * 45) * (Math.PI / 180); // 45 degrees apart
          const radius = OFFSET * Math.ceil(index / 8); // Increase radius every 8 markers
          const newLat = bill.latitude + radius * Math.cos(angle);
          const newLng = bill.longitude + radius * Math.sin(angle);
          spreadBills.push({ ...bill, spreadLat: newLat, spreadLng: newLng });
        }
      });
    }
  });
  
  return spreadBills;
};

// Custom marker showing SERIAL NUMBER - Small circular 3D pins
const createPropertyIdIcon = (serialNo, status) => {
  const colors = {
    'Pending': '#ef4444',       // RED - pending
    'Completed': '#eab308',     // YELLOW - completed
    'Approved': '#22c55e',      // GREEN - approved
    'Residential': '#22c55e',   // GREEN
    'Commercial': '#f97316',    // Orange
    'Vacant Plot': '#22c55e',   // GREEN
    'Mix Use': '#a855f7',       // Purple
    'default': '#22c55e'        // Green default
  };
  const color = colors[status] || colors['default'];
  const displaySerial = serialNo || '-';
  
  // Small circular marker with 3D effect
  return L.divIcon({
    className: 'property-id-marker',
    html: `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
      ">
        <div style="
          width: 22px;
          height: 22px;
          background: radial-gradient(circle at 30% 30%, ${color}, ${color}cc);
          border-radius: 50%;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.2), inset 0 -2px 3px rgba(0,0,0,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 700;
          color: white;
          text-shadow: 0 1px 1px rgba(0,0,0,0.4);
        ">${displaySerial}</div>
        <div style="
          width: 0;
          height: 0;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-top: 5px solid ${color};
          margin-top: -2px;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3));
        "></div>
      </div>`,
    iconSize: [22, 29],
    iconAnchor: [11, 29],
    popupAnchor: [0, -25]
  });
};

// Keep old bill icon as fallback
const createBillIcon = (serialNumber, category) => {
  const colors = {
    'Residential': '#3b82f6',
    'Commercial': '#f97316',
    'Vacant Plot': '#22c55e',
    'Mix Use': '#a855f7',
    'default': '#ef4444'
  };
  
  let color = colors['default'];
  if (category) {
    for (const [key, value] of Object.entries(colors)) {
      if (category.toLowerCase().includes(key.toLowerCase())) {
        color = value;
        break;
      }
    }
  }
  
  return L.divIcon({
    className: 'bill-marker',
    html: `<div style="
      background-color: ${color};
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 1.5px solid white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 600;
      color: white;
      font-family: Arial, sans-serif;
      line-height: 1;
    ">${serialNumber}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9]
  });
};

// Component to fit bounds
function FitBounds({ bills }) {
  const map = useMap();
  
  useEffect(() => {
    if (bills.length > 0) {
      const validBills = bills.filter(b => b.latitude && b.longitude);
      if (validBills.length > 0) {
        const bounds = L.latLngBounds(
          validBills.map(b => [b.latitude, b.longitude])
        );
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [bills, map]);
  
  return null;
}

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export default function BillsMapPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [colonies, setColonies] = useState([]);
  const [batches, setBatches] = useState([]);
  const [filters, setFilters] = useState({
    batch_id: '',
    colony: ''
  });
  const [stats, setStats] = useState({
    total: 0,
    withGPS: 0
  });

  useEffect(() => {
    fetchBatches();
    fetchColonies();
  }, []);

  useEffect(() => {
    fetchBillsMapData();
  }, [filters]);

  const fetchBatches = async () => {
    try {
      const response = await axios.get(`${API_URL}/admin/batches`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const pdfBatches = (response.data || []).filter(b => b.type === 'PDF_BILLS');
      setBatches(pdfBatches);
    } catch (error) {
      console.error('Failed to fetch batches:', error);
    }
  };

  const fetchColonies = async () => {
    try {
      const response = await axios.get(`${API_URL}/admin/bills/colonies`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setColonies(response.data.colonies || []);
    } catch (error) {
      console.error('Failed to fetch colonies:', error);
    }
  };

  const fetchBillsMapData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.batch_id) params.append('batch_id', filters.batch_id);
      if (filters.colony) params.append('colony', filters.colony);

      const response = await axios.get(`${API_URL}/admin/bills/map-data?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setBills(response.data.bills || []);
      setStats({
        total: response.data.total || 0,
        withGPS: response.data.bills?.length || 0
      });
    } catch (error) {
      toast.error('Failed to load map data');
    } finally {
      setLoading(false);
    }
  };

  // Default center (India)
  const defaultCenter = [29.9502, 76.8385];

  return (
    <AdminLayout title="Bills Map">
      <div data-testid="bills-map-page" className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/admin/bills')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Bills
            </Button>
            <div>
              <h1 className="text-2xl font-heading font-bold text-slate-900">Bills Map</h1>
              <p className="text-slate-500">View bill locations with serial numbers</p>
            </div>
          </div>
        </div>

        {/* Filters & Stats */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-4">
              <Select
                value={filters.batch_id}
                onValueChange={(value) => setFilters({ ...filters, batch_id: value })}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Batch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All Batches</SelectItem>
                  {batches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.colony}
                onValueChange={(value) => setFilters({ ...filters, colony: value })}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Colony" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All Colonies</SelectItem>
                  {colonies.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex-1" />

              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold">{stats.withGPS}</span>
                  <span className="text-slate-500">Bills on Map</span>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-6 mt-4 pt-4 border-t">
              <span className="text-sm text-slate-500">Categories:</span>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-blue-500" />
                <span className="text-sm">Residential</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-orange-500" />
                <span className="text-sm">Commercial</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-green-500" />
                <span className="text-sm">Vacant Plot</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-purple-500" />
                <span className="text-sm">Mix Use</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Map */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="h-[600px] flex items-center justify-center bg-slate-100">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : (
              <div style={{ height: '600px' }}>
                <MapContainer
                  center={defaultCenter}
                  zoom={18}
                  minZoom={5}
                  maxZoom={21}
                  maxBounds={[[-85, -180], [85, 180]]}
                  maxBoundsViscosity={1.0}
                  style={{ height: '100%', width: '100%' }}
                  scrollWheelZoom={true}
                >
                  {/* Google Satellite - High quality */}
                  <TileLayer
                    url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                    maxZoom={21}
                  />
                  
                  <FitBounds bills={bills} />
                  
                  {/* Property markers with SERIAL NUMBER labels - circular 3D */}
                  {spreadOverlappingMarkers(bills).map((bill) => (
                    <Marker
                      key={bill.id}
                      position={[bill.spreadLat, bill.spreadLng]}
                      icon={createPropertyIdIcon(
                        bill.bill_sr_no || bill.serial_number || '-',
                        bill.category
                      )}
                    >
                      <Popup maxWidth={350}>
                        <div className="p-2 min-w-[250px]">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <span className="text-xl font-bold text-amber-600">
                                Sr: {bill.bill_sr_no || bill.serial_number || '-'}
                              </span>
                              <p className="font-mono text-sm text-blue-600">{bill.property_id}</p>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              bill.category === 'Residential' ? 'bg-green-100 text-green-700' :
                              bill.category === 'Commercial' ? 'bg-orange-100 text-orange-700' :
                              'bg-slate-100 text-slate-700'
                            }`}>{bill.category || 'N/A'}</span>
                          </div>
                          <div className="space-y-1 text-sm">
                            <p><strong>Owner:</strong> {bill.owner_name || '-'}</p>
                            <p><strong>Mobile:</strong> {bill.mobile || '-'}</p>
                            <p><strong>Colony:</strong> {bill.colony || '-'}</p>
                            <p><strong>Outstanding:</strong> ₹{bill.total_outstanding || '0'}</p>
                            <p className="text-xs text-slate-500">
                              GPS: {bill.latitude?.toFixed(6)}, {bill.longitude?.toFixed(6)}
                            </p>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
