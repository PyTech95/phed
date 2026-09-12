import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { 
  MapPin, Navigation, FileText, Loader2, RefreshCw, 
  Compass, LocateFixed, Search, X, CheckCircle, XCircle, AlertTriangle, Lock, Plus
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const ADD_CATEGORIES = ['Residential', 'Commercial', 'Institutional', 'Industrial', 'Mixed', 'Other'];

// PERFORMANCE: Memoized marker component to prevent re-renders - TINY SIZE
const PropertyMarker = memo(({ property, onClick, withinReach, completed, status }) => {
  // Color based on status: Pending=Red, Completed=Yellow, Approved=Green
  const getColor = () => {
    if (status === 'Approved') return '#16a34a';  // Green
    if (status === 'Completed') return '#eab308'; // Yellow
    if (status === 'In Progress') return '#f59e0b'; // Amber
    return '#ef4444'; // Red for Pending
  };
  const markerColor = getColor();
  const serialNum = property.bill_sr_no || property.serial_number || '-';
  
  return (
    <Marker
      latitude={property.latitude}
      longitude={property.longitude}
      anchor="bottom"
      onClick={onClick}
    >
      <div className="cursor-pointer">
        <svg 
          width="18" 
          height="22" 
          viewBox="0 0 36 44" 
          style={{ 
            filter: withinReach && status === 'Pending' ? 'drop-shadow(0 0 3px rgba(59, 130, 246, 0.7))' : 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))'
          }}
        >
          <path 
            d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 26 18 26s18-13.4 18-26C36 8.06 27.94 0 18 0z" 
            fill={markerColor}
            stroke="#fff"
            strokeWidth="2.5"
          />
        </svg>
        <div 
          className="absolute top-0 left-0 right-0 flex items-center justify-center"
          style={{ height: '14px', marginTop: '1px' }}
        >
          <span 
            className="font-bold text-white"
            style={{ fontSize: '6px', textShadow: '0 0 1px rgba(0,0,0,0.5)' }}
          >
            {completed ? '✓' : serialNum}
          </span>
        </div>
      </div>
    </Marker>
  );
});
PropertyMarker.displayName = 'PropertyMarker';

// Create a GeoJSON circle polygon for 40m radius - OPTIMIZED with fewer points
const createCircleGeoJSON = (centerLat, centerLng, radiusMeters = 40, points = 32) => {
  const coords = [];
  const distanceX = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180));
  const distanceY = radiusMeters / 110540;
  
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = centerLng + (distanceX * Math.cos(theta));
    const y = centerLat + (distanceY * Math.sin(theta));
    coords.push([x, y]);
  }
  coords.push(coords[0]); // Close the polygon
  
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coords]
    }
  };
};

// Calculate distance (Haversine)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const formatDistance = (meters) => meters < 1000 ? `${Math.round(meters)}m` : `${(meters/1000).toFixed(1)}km`;

// Marker colors based on status - Completed=Yellow, Approved=Green
const getMarkerColor = (status) => {
  const colors = {
    'Pending': '#ef4444',      // Red
    'Completed': '#eab308',    // Yellow - submitted but not approved
    'Approved': '#16a34a',     // Green - approved/locked  
    'In Progress': '#f59e0b',  // Amber
    'Rejected': '#f97316'      // Orange
  };
  return colors[status] || '#ef4444';
};

// Check if property is within 40m reach
const isWithinReach = (distance) => distance !== null && distance <= 40;

// Check if property is completed/locked — only admin-approved surveys are locked
const isCompleted = (status) => status === 'Approved';

// 3-colour rule from the PHED survey: red = not surveyed, yellow = surveyor submitted, green = admin approved.
// Uses phed_survey_state (raw survey status) so a just-submitted survey turns yellow even for "No PHED Connection".
const withPhedStatus = (p) => {
  const st = p.phed_survey_state || p.phed_survey_status;
  const status = st === 'Approved' ? 'Approved'
    : ['Submitted', 'Requires Review', 'Document Pending', 'Draft'].includes(st) ? 'Completed'
    : (!p.phed_survey_state && p.phed_survey_status === 'No PHED Connection') ? 'Approved'
    : 'Pending';
  return { ...p, mc_status: p.status, status, phed_outcome: p.phed_outcome || null };
};

export default function Properties() {
  const navigate = useNavigate();
  const { token } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [allProperties, setAllProperties] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  
  // GPS & Map state
  const [userLocation, setUserLocation] = useState(null);
  const [gpsTracking, setGpsTracking] = useState(false);
  const [viewState, setViewState] = useState({
    latitude: 29.9695,
    longitude: 76.8783,
    zoom: 17,
    bearing: 0, // This is the rotation!
    pitch: 0
  });
  const [deviceHeading, setDeviceHeading] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  
  const mapRef = useRef(null);
  const watchIdRef = useRef(null);
  
  // Stats
  const [stats, setStats] = useState({ total: 0, pending: 0, completed: 0 });
  const [mapFilter, setMapFilter] = useState(null); // 'Pending' | 'Completed' | 'Approved' | null (legend tap filter)

  // Add-new-property (surveyor) state
  const [wards, setWards] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addLoc, setAddLoc] = useState(null);
  const [nearbyDupes, setNearbyDupes] = useState([]);
  const [addForm, setAddForm] = useState({ owner_name: '', mobile: '', alternate_mobile: '', ward: '', colony: '', category: 'Residential', address: '' });
  // Pin adjust mode: drag a single red pin on the map, then confirm
  const [pinMode, setPinMode] = useState(null); // { kind: 'add' } | { kind: 'move', property }
  const [pinLoc, setPinLoc] = useState(null);
  const [savingPin, setSavingPin] = useState(false);

  const startAdjustAddPin = () => {
    setPinLoc(addLoc || { latitude: viewState.latitude, longitude: viewState.longitude });
    setPinMode({ kind: 'add' });
    setShowAdd(false);
    setViewState((v) => ({ ...v, latitude: (addLoc || v).latitude, longitude: (addLoc || v).longitude, zoom: Math.max(v.zoom, 18) }));
  };

  const startMovePin = (property) => {
    setPinLoc({ latitude: property.latitude, longitude: property.longitude });
    setPinMode({ kind: 'move', property });
    setSelectedProperty(null);
    setViewState((v) => ({ ...v, latitude: property.latitude, longitude: property.longitude, zoom: Math.max(v.zoom, 18) }));
  };

  const cancelPin = () => {
    if (pinMode?.kind === 'add') setShowAdd(true);
    setPinMode(null); setPinLoc(null);
  };

  const confirmPin = async () => {
    if (!pinMode || !pinLoc) return;
    if (pinMode.kind === 'add') {
      setAddLoc(pinLoc); setPinMode(null); setShowAdd(true);
      toast.success('जगह set हो गई');
      return;
    }
    setSavingPin(true);
    try {
      await axios.put(`${API_URL}/phed/properties/${pinMode.property.id}/location`, pinLoc, { headers: { Authorization: `Bearer ${token}` } });
      setAllProperties((ps) => ps.map((p) => (p.id === pinMode.property.id ? { ...p, ...pinLoc } : p)));
      localStorage.removeItem('surveyor_properties_cache');
      toast.success('Pin की जगह save हो गई');
      setPinMode(null); setPinLoc(null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); } finally { setSavingPin(false); }
  };

  // Load ward -> colony master for the Add Property form
  useEffect(() => {
    if (!token) return;
    axios.get(`${API_URL}/phed/wards`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setWards((r.data.wards || []).slice().sort((a, b) => (parseInt(a.ward_number, 10) || 0) - (parseInt(b.ward_number, 10) || 0))))
      .catch(() => {});
  }, [token]);

  const openAddProperty = () => {
    const loc = userLocation
      ? { latitude: userLocation.lat, longitude: userLocation.lng }
      : { latitude: viewState.latitude, longitude: viewState.longitude };
    setAddLoc(loc);
    // Warn about nearby existing points (within ~25m)
    const dupes = allProperties
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({ p, d: Math.round(calculateDistance(loc.latitude, loc.longitude, p.latitude, p.longitude)) }))
      .filter((x) => x.d <= 25)
      .sort((a, b) => a.d - b.d);
    setNearbyDupes(dupes);
    setAddForm({ owner_name: '', mobile: '', alternate_mobile: '', ward: '', colony: '', category: 'Residential', address: '' });
    setShowAdd(true);
  };

  const useMyLocationForAdd = () => {
    if (!navigator.geolocation) return toast.error('GPS not supported');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setAddLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); toast.success('Location updated'); },
      () => toast.error('Location नहीं मिली'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const submitAddProperty = async () => {
    toast.dismiss();
    if (!addForm.owner_name.trim()) return toast.error('Owner नाम ज़रूरी है');
    if (!addForm.mobile.trim()) return toast.error('Mobile number ज़रूरी है');
    if (!addForm.ward.trim()) return toast.error('Ward ज़रूरी है');
    if (!addForm.colony.trim()) return toast.error('Colony ज़रूरी है');
    if (!addForm.category.trim()) return toast.error('Category ज़रूरी है');
    if (!addLoc) return toast.error('Location नहीं मिली — "मेरी location" दबाएँ');
    setAdding(true);
    try {
      const { data } = await axios.post(`${API_URL}/phed/field-properties`,
        { ...addForm, latitude: addLoc.latitude, longitude: addLoc.longitude },
        { headers: { Authorization: `Bearer ${token}` } });
      toast.success('नई property add हो गई — survey शुरू करें');
      localStorage.removeItem('surveyor_properties_cache');
      localStorage.removeItem('surveyor_properties_cache_time');
      setShowAdd(false);
      navigate(`/employee/phed-survey/${data.id}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Add failed');
    } finally { setAdding(false); }
  };

  // Restore saved position
  useEffect(() => {
    const savedPosition = localStorage.getItem('surveyor_map_position');
    if (savedPosition) {
      try {
        const { lat, lng, zoom, bearing } = JSON.parse(savedPosition);
        setViewState(prev => ({
          ...prev,
          latitude: lat,
          longitude: lng,
          zoom: zoom || 17,
          bearing: bearing || 0
        }));
      } catch (e) {
        console.log('Could not restore map position');
      }
    }
  }, []);

  // Fetch ALL properties - NO LIMIT
  useEffect(() => {
    fetchProperties();
    startGPSTracking();
    startCompass();
    
    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // OPTIMIZED: Fetch with localStorage caching for faster reload
  const fetchProperties = async (forceRefresh = false) => {
    try {
      // Check cache first (valid for 2 minutes)
      const cacheKey = 'surveyor_properties_cache';
      const cacheTimeKey = 'surveyor_properties_cache_time';
      const cached = localStorage.getItem(cacheKey);
      const cacheTime = localStorage.getItem(cacheTimeKey);
      
      if (!forceRefresh && cached && cacheTime) {
        const age = Date.now() - parseInt(cacheTime);
        if (age < 120000) { // 2 minutes cache
          const props = JSON.parse(cached).map(withPhedStatus);
          setAllProperties(props);
          const pending = props.filter(p => p.status === 'Pending').length;
          const completed = props.filter(p => ['Completed', 'Approved', 'In Progress'].includes(p.status)).length;
          setStats({ total: props.length, pending, completed });
          setLoading(false);
          toast.success(`Loaded ${props.length} properties (cached)`);
          return;
        }
      }
      
      // Fetch from API
      const response = await axios.get(`${API_URL}/map/employee-properties`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const props = (response.data.properties || []).map(withPhedStatus);
      setAllProperties(props);
      
      // Update cache
      localStorage.setItem(cacheKey, JSON.stringify(props));
      localStorage.setItem(cacheTimeKey, Date.now().toString());
      
      const pending = props.filter(p => p.status === 'Pending').length;
      const completed = props.filter(p => ['Completed', 'Approved', 'In Progress'].includes(p.status)).length;
      setStats({ total: props.length, pending, completed });
      
      // Set initial center if no saved position
      const savedPosition = localStorage.getItem('surveyor_map_position');
      if (!savedPosition && props.length > 0) {
        const firstWithGPS = props.find(p => p.latitude && p.longitude);
        if (firstWithGPS) {
          setViewState(prev => ({
            ...prev,
            latitude: firstWithGPS.latitude,
            longitude: firstWithGPS.longitude
          }));
        }
      }
      
      toast.success(`Loaded ${props.length} properties`);
    } catch (error) {
      toast.error('Failed to load properties');
    } finally {
      setLoading(false);
    }
  };

  const startGPSTracking = () => {
    if (!navigator.geolocation) return;
    setGpsTracking(true);
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        const savedPosition = localStorage.getItem('surveyor_map_position');
        if (!savedPosition) {
          setViewState(prev => ({
            ...prev,
            latitude: loc.lat,
            longitude: loc.lng
          }));
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000 }
    );
    
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation(prev => {
          if (prev) {
            const dist = calculateDistance(prev.lat, prev.lng, pos.coords.latitude, pos.coords.longitude);
            if (dist < 30) return prev;
          }
          return { lat: pos.coords.latitude, lng: pos.coords.longitude };
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 }
    );
  };

  const startCompass = () => {
    if (window.DeviceOrientationEvent) {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
          .then(permission => {
            if (permission === 'granted') {
              window.addEventListener('deviceorientation', handleOrientation, true);
            }
          })
          .catch(console.error);
      } else {
        window.addEventListener('deviceorientationabsolute', handleOrientation, true);
        window.addEventListener('deviceorientation', handleOrientation, true);
      }
    }
  };

  const handleOrientation = useCallback((event) => {
    let heading = event.webkitCompassHeading || (event.alpha !== null ? (360 - event.alpha) % 360 : null);
    if (heading !== null && heading !== undefined) {
      setDeviceHeading(Math.round(heading));
      if (autoRotate) {
        setViewState(prev => ({ ...prev, bearing: heading }));
      }
    }
  }, [autoRotate]);

  // Save position on map move
  const onMoveEnd = useCallback(() => {
    localStorage.setItem('surveyor_map_position', JSON.stringify({
      lat: viewState.latitude,
      lng: viewState.longitude,
      zoom: viewState.zoom,
      bearing: viewState.bearing
    }));
  }, [viewState]);

  const refreshLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setViewState(prev => ({
          ...prev,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        }));
        toast.success('Location updated!');
      },
      () => toast.error('Location failed'),
      { enableHighAccuracy: true }
    );
  };

  const toggleAutoRotate = () => {
    if (!autoRotate) {
      setAutoRotate(true);
      setViewState(prev => ({ ...prev, bearing: deviceHeading }));
      toast.success('Auto-rotate ON - follows compass');
    } else {
      setAutoRotate(false);
      toast.info('Auto-rotate OFF');
    }
  };

  const resetNorth = () => {
    setViewState(prev => ({ ...prev, bearing: 0 }));
    setAutoRotate(false);
    toast.info('Reset to North');
  };

  // Search functionality
  const handleSearch = (query) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    
    const searchLower = query.toLowerCase().trim();
    
    // Search by property_id, bill_sr_no, serial_number, owner_name, mobile
    const results = allProperties.filter(p => {
      const propertyId = (p.property_id || '').toLowerCase();
      const billSrNo = String(p.bill_sr_no || '').toLowerCase();
      const serialNo = String(p.serial_number || '').toLowerCase();
      const ownerName = (p.owner_name || '').toLowerCase();
      const mobile = (p.mobile || '').toLowerCase();
      
      return propertyId.includes(searchLower) ||
             billSrNo.includes(searchLower) ||
             serialNo.includes(searchLower) ||
             ownerName.includes(searchLower) ||
             mobile.includes(searchLower);
    }).slice(0, 10); // Limit to 10 results
    
    setSearchResults(results);
    setShowSearchResults(results.length > 0);
  };

  const selectSearchResult = (property) => {
    // Center map on selected property
    setViewState(prev => ({
      ...prev,
      latitude: property.latitude,
      longitude: property.longitude,
      zoom: 19
    }));
    
    // Select the property to show popup
    setSelectedProperty(property);
    
    // Clear search
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    
    toast.success(`Found: ${property.owner_name}`);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
  };

  // Filter and sort by distance - optimized for performance
  const sortedProperties = useMemo(() => {
    let props = [...allProperties].filter(p => p.latitude && p.longitude);
    
    if (userLocation) {
      props = props.map(p => ({
        ...p,
        distance: calculateDistance(userLocation.lat, userLocation.lng, p.latitude, p.longitude)
      }));
      // Sort: Pending first, then by distance
      props.sort((a, b) => {
        const statusOrder = { 'Pending': 0, 'Rejected': 1, 'In Progress': 2, 'Completed': 3, 'Approved': 4 };
        if ((statusOrder[a.status] || 0) !== (statusOrder[b.status] || 0)) {
          return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
        }
        return (a.distance || Infinity) - (b.distance || Infinity);
      });
    }
    
    return props;
  }, [allProperties, userLocation]);

  // OPTIMIZED: Smart marker limiting based on zoom level
  const visibleMarkers = useMemo(() => {
    let base = sortedProperties;
    if (mapFilter) base = base.filter(p => p.status === mapFilter); // legend colour filter
    // Progressive limits based on zoom - prioritize pending properties
    if (viewState.zoom < 13) {
      const pending = base.filter(p => p.status === 'Pending').slice(0, 100);
      return mapFilter ? base.slice(0, 200) : pending;
    } else if (viewState.zoom < 15) {
      return base.slice(0, 300);
    } else if (viewState.zoom < 17) {
      return base.slice(0, 500);
    }
    return base.slice(0, 1000);
  }, [sortedProperties, viewState.zoom, mapFilter]);

  if (loading) {
    return (
      <EmployeeLayout>
        <div className="fixed inset-0 flex items-center justify-center bg-slate-900">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto" />
            <p className="text-white mt-4">Loading Map...</p>
          </div>
        </div>
      </EmployeeLayout>
    );
  }

  return (
    <EmployeeLayout>
      {/* FULLSCREEN MAP with native 360° rotation */}
      <div className="fixed inset-0 z-0">
        <Map
          ref={mapRef}
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          onMoveEnd={onMoveEnd}
          style={{ width: '100%', height: '100%' }}
          mapStyle={{
            version: 8,
            sources: {
              'satellite': {
                type: 'raster',
                tiles: [
                  'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
                ],
                tileSize: 256,
                maxzoom: 21
              }
            },
            layers: [
              {
                id: 'satellite-layer',
                type: 'raster',
                source: 'satellite',
                minzoom: 0,
                maxzoom: 21
              }
            ]
          }}
          maxZoom={21}
          minZoom={10}
          touchZoomRotate={true}
          touchPitch={false}
          dragRotate={true}
          pitchWithRotate={false}
        >
          {/* 40m Radius Circle around user location */}
          {userLocation && (
            <Source 
              id="radius-circle" 
              type="geojson" 
              data={createCircleGeoJSON(userLocation.lat, userLocation.lng, 40)}
            >
              {/* Fill layer - semi-transparent blue */}
              <Layer
                id="radius-fill"
                type="fill"
                paint={{
                  'fill-color': '#3b82f6',
                  'fill-opacity': 0.2
                }}
              />
              {/* Border layer - solid blue */}
              <Layer
                id="radius-border"
                type="line"
                paint={{
                  'line-color': '#3b82f6',
                  'line-width': 3,
                  'line-opacity': 0.8
                }}
              />
            </Source>
          )}
          
          {/* User GPS dot marker - OPTIMIZED simpler design */}
          {userLocation && (
            <Marker 
              latitude={userLocation.lat} 
              longitude={userLocation.lng}
              anchor="center"
            >
              <div className="relative">
                <div className="absolute -inset-4 bg-blue-500/20 rounded-full animate-pulse" />
                <div className="w-8 h-8 bg-blue-600 rounded-full border-3 border-white shadow-lg flex items-center justify-center">
                  <div className="w-2 h-2 bg-white rounded-full" />
                </div>
              </div>
            </Marker>
          )}
          
          {/* Property markers - OPTIMIZED with memoized component */}
          {visibleMarkers.filter((property) => !(pinMode?.kind === 'move' && pinMode.property.id === property.id)).map((property) => (
            <PropertyMarker
              key={property.id}
              property={property}
              withinReach={isWithinReach(property.distance)}
              completed={isCompleted(property.status)}
              status={property.status}
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                if (!pinMode) setSelectedProperty(property);
              }}
            />
          ))}

          {/* Draggable pin (add / move mode) */}
          {pinMode && pinLoc && (
            <Marker
              latitude={pinLoc.latitude}
              longitude={pinLoc.longitude}
              anchor="bottom"
              draggable
              onDragEnd={(e) => setPinLoc({ latitude: e.lngLat.lat, longitude: e.lngLat.lng })}
            >
              <div className="cursor-grab active:cursor-grabbing" data-testid="adjust-pin">
                <svg width="36" height="44" viewBox="0 0 36 44" style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))' }}>
                  <path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 26 18 26s18-13.4 18-26C36 8.06 27.94 0 18 0z" fill="#dc2626" stroke="#fff" strokeWidth="2.5" />
                  <circle cx="18" cy="18" r="6" fill="#fff" />
                </svg>
              </div>
            </Marker>
          )}
        </Map>
      </div>

      {pinMode && (
        <>
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[1200] bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2" data-testid="pin-banner">
            <MapPin className="w-4 h-4 text-red-400" /> लाल pin को दबाकर सही जगह पर खींचें
          </div>
          <div className="fixed left-4 right-4 bottom-24 z-[1200] bg-white rounded-2xl shadow-2xl p-3 flex items-center gap-2" data-testid="pin-bar">
            <div className="flex-1 text-[11px] text-slate-600">
              <div className="font-semibold text-slate-800">{pinMode.kind === 'add' ? 'नई property की जगह' : pinMode.property.property_id}</div>
              <div className="font-mono text-[10px]">{pinLoc?.latitude.toFixed(5)}, {pinLoc?.longitude.toFixed(5)}</div>
            </div>
            <Button variant="outline" className="h-11" onClick={cancelPin} data-testid="pin-cancel-btn">Cancel</Button>
            <Button className="h-11 text-white bg-green-600 hover:bg-green-700" onClick={confirmPin} disabled={savingPin} data-testid="pin-confirm-btn">
              {savingPin ? <Loader2 className="w-4 h-4 animate-spin" /> : (pinMode.kind === 'add' ? 'यहाँ ठीक है ✓' : 'Save location')}
            </Button>
          </div>
        </>
      )}

      {/* CENTERED MODAL for selected property - Click outside to close */}
      {selectedProperty && (
        <div 
          className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
          onClick={() => setSelectedProperty(null)}
          data-testid="property-modal-overlay"
        >
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          
          {/* Modal Content - Stop propagation to prevent closing when clicking inside */}
          <div 
            className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Big Close Button */}
            <button
              onClick={() => setSelectedProperty(null)}
              className="absolute top-3 right-3 z-10 w-10 h-10 bg-gray-100 hover:bg-red-100 rounded-full flex items-center justify-center transition-colors"
              data-testid="close-modal-btn"
            >
              <X className="w-6 h-6 text-gray-600 hover:text-red-600" />
            </button>
            
            <div className="p-4">
              {/* Header - Property ID */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
                <div className="text-xs text-blue-600 font-medium uppercase tracking-wide">Property ID</div>
                <div className="text-2xl font-bold text-blue-700 mt-1">{selectedProperty.property_id || '-'}</div>
              </div>
              
              {/* Status Badge */}
              <div className="mb-4">
                <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${
                  selectedProperty.status === 'Pending' ? 'bg-red-100 text-red-700' : 
                  selectedProperty.status === 'In Progress' ? 'bg-yellow-100 text-yellow-700' : 
                  'bg-green-100 text-green-700'
                }`}>
                  {selectedProperty.status === 'Completed' || selectedProperty.status === 'Approved' ? '✓ ' : ''}
                  {selectedProperty.status}
                </span>
              </div>
              
              {/* Property Details Grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Owner</div>
                  <div className="font-semibold text-gray-900">{selectedProperty.owner_name || '-'}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Mobile</div>
                  {selectedProperty.mobile ? (
                    <a href={`tel:${selectedProperty.mobile}`} className="font-semibold text-blue-600 underline">
                      {selectedProperty.mobile}
                    </a>
                  ) : (
                    <div className="text-gray-400">-</div>
                  )}
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Colony</div>
                  <div className="font-medium text-gray-800">{selectedProperty.colony || selectedProperty.ward || '-'}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Total Area</div>
                  <div className="font-medium text-gray-800">{selectedProperty.total_area || '-'}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Category</div>
                  <div className="font-medium text-gray-800">{selectedProperty.category || 'Residential'}</div>
                </div>
              </div>
              
              {/* Address */}
              {selectedProperty.address && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Address</div>
                  <div className="text-sm text-gray-800">{selectedProperty.address}</div>
                </div>
              )}
              
              {/* GPS & Distance */}
              <div className="mt-3 flex justify-between items-center bg-blue-50 rounded-lg p-3">
                <div>
                  <div className="text-xs text-blue-600 font-medium">GPS</div>
                  <div className="text-xs font-mono text-gray-600 mt-1">
                    {selectedProperty.latitude?.toFixed(6)}, {selectedProperty.longitude?.toFixed(6)}
                  </div>
                </div>
                {selectedProperty.distance && (
                  <div className="text-right">
                    <div className="text-xs text-emerald-600 font-medium">Distance</div>
                    <div className="font-bold text-emerald-700 text-lg">{formatDistance(selectedProperty.distance)}</div>
                  </div>
                )}
              </div>
              
              {/* Action Buttons - Big */}
              <div className="flex gap-3 mt-4">
                {isCompleted(selectedProperty.status) ? (
                  <button 
                    className="flex-1 bg-slate-400 text-white px-4 py-4 rounded-xl text-base font-semibold flex items-center justify-center gap-2 shadow-lg cursor-not-allowed"
                    disabled
                    data-testid="survey-btn-locked"
                  >
                    <Lock className="w-5 h-5" />
                    {selectedProperty.status === 'Approved' ? 'Approved' : 'Submitted'}
                  </button>
                ) : (
                  <button 
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-4 rounded-xl text-base font-semibold flex items-center justify-center gap-2 shadow-lg"
                    onClick={() => {
                      localStorage.setItem('surveyor_map_position', JSON.stringify({
                        lat: selectedProperty.latitude,
                        lng: selectedProperty.longitude,
                        zoom: viewState.zoom,
                        bearing: viewState.bearing
                      }));
                      navigate(`/employee/phed-survey/${selectedProperty.id}`);
                    }}
                    data-testid="survey-btn"
                  >
                    <FileText className="w-5 h-5" />
                    Start Survey
                  </button>
                )}
                <button 
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-4 rounded-xl shadow"
                  onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selectedProperty.latitude},${selectedProperty.longitude}`, '_blank')}
                  data-testid="navigate-btn"
                >
                  <Navigation className="w-6 h-6" />
                </button>
              </div>
              {!isCompleted(selectedProperty.status) && (
                <button
                  className="w-full mt-3 h-11 rounded-xl border-2 border-dashed border-red-300 text-red-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-red-50"
                  onClick={() => startMovePin(selectedProperty)}
                  data-testid="move-pin-btn"
                >
                  <MapPin className="w-4 h-4" /> Pin की जगह ठीक करें (खींचकर)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADD NEW PROPERTY modal (surveyor) */}
      {showAdd && (
        <div className="fixed inset-0 z-[2100] flex items-end sm:items-center justify-center" onClick={() => !adding && setShowAdd(false)} data-testid="add-property-modal">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">नई Property जोड़ें</h3>
              <button onClick={() => !adding && setShowAdd(false)} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center" data-testid="add-close-btn"><X className="w-5 h-5 text-gray-600" /></button>
            </div>
            <div className="text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-1.5 bg-blue-50" data-testid="add-gps-status">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" style={{ color: addLoc ? '#16a34a' : '#dc2626' }} />
                {addLoc ? <>जगह चुन ली ✓ <span className="font-mono text-[10px] text-slate-500">{addLoc.latitude.toFixed(5)}, {addLoc.longitude.toFixed(5)}</span></> : 'जगह नहीं मिली'}
              </span>
              <button type="button" className="text-blue-700 font-medium underline shrink-0 flex items-center gap-1" onClick={useMyLocationForAdd} data-testid="add-use-location-btn"><Navigation className="w-3.5 h-3.5" /> मेरी location</button>
            </div>
            <button type="button" onClick={startAdjustAddPin} className="w-full h-11 rounded-lg border-2 border-dashed border-red-300 text-red-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-red-50" data-testid="add-adjust-pin-btn">
              <MapPin className="w-4 h-4" /> Map पर pin खींचकर जगह ठीक करें
            </button>
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
                  {ADD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div><label className="text-xs font-medium text-slate-600">Colony *</label>
              {(() => {
                const wardColonies = wards.find((w) => w.ward_number === addForm.ward)?.colonies || [];
                if (addForm.ward && wardColonies.length === 0) {
                  return <input className="w-full h-11 border rounded-lg px-3 mt-1" placeholder="Colony का नाम लिखें" value={addForm.colony} onChange={(e) => setAddForm({ ...addForm, colony: e.target.value })} data-testid="add-colony-input" />;
                }
                return (
                  <select className="w-full h-11 border rounded-lg px-3 mt-1 bg-white disabled:bg-slate-100" value={addForm.colony} onChange={(e) => setAddForm({ ...addForm, colony: e.target.value })} disabled={!addForm.ward} data-testid="add-colony-select">
                    <option value="">{addForm.ward ? 'Colony चुनें…' : 'पहले Ward चुनें'}</option>
                    {wardColonies.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                );
              })()}
            </div>
            <div><label className="text-xs font-medium text-slate-600">Address (building detail)</label><input className="w-full h-11 border rounded-lg px-3 mt-1" value={addForm.address} onChange={(e) => setAddForm({ ...addForm, address: e.target.value })} data-testid="add-address-input" /></div>
            {nearbyDupes.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800" data-testid="add-duplicate-warning">
                <div className="font-semibold">⚠ पास में {nearbyDupes.length} property पहले से है (~{nearbyDupes[0].d} m):</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {nearbyDupes.slice(0, 3).map(({ p, d }) => (<li key={p.id}>{p.owner_name || 'Unknown'} <span className="font-mono">{p.property_id}</span> · {d} m</li>))}
                </ul>
                <div className="mt-1">क्या यह अलग property है? हाँ तो नीचे add करें।</div>
              </div>
            )}
            <button onClick={submitAddProperty} disabled={adding || !addLoc} className="w-full h-12 rounded-xl text-white font-semibold flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60" data-testid="add-property-submit">
              {adding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} {nearbyDupes.length > 0 ? 'फिर भी Add करें & Survey शुरू' : 'Add करें & Survey शुरू'}
            </button>
          </div>
        </div>
      )}

      {/* FIXED UI OVERLAY */}
      <div className="fixed inset-0 z-[1000] pointer-events-none">
        {/* TOP STATUS BAR */}
        <div className="absolute top-0 left-0 right-0 bg-white/95 backdrop-blur-sm text-slate-800 border-b border-slate-200 px-4 py-3 pointer-events-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {gpsTracking && (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-xs text-emerald-600 font-semibold">GPS</span>
                  </div>
                )}
              </div>
              <div className="text-sm">
                <span className="text-red-600 font-bold">{stats.pending}</span>
                <span className="text-slate-500"> pending</span>
                <span className="mx-2 text-slate-300">|</span>
                <span className="text-emerald-600 font-bold">{stats.completed}</span>
                <span className="text-slate-500"> done</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Add new property (surveyor) */}
              <button
                onClick={openAddProperty}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white shadow"
                data-testid="add-property-btn"
                title="नई property add करें"
              >
                <Plus className="w-4 h-4" /> <span className="text-xs font-semibold">Add</span>
              </button>
              {/* Rotation indicator */}
              <div 
                className={`flex items-center gap-1 px-2 py-1 rounded-lg ${autoRotate ? 'bg-emerald-600' : 'bg-blue-700'}`}
                onClick={toggleAutoRotate}
              >
                <Compass 
                  className="w-5 h-5 text-white"
                  style={{ transform: `rotate(${viewState.bearing}deg)`, transition: 'transform 0.15s ease-out' }}
                />
                <span className="text-xs font-mono text-white">{Math.round(viewState.bearing)}°</span>
              </div>
            </div>
          </div>
        </div>

        {/* SEARCH BAR */}
        <div className="absolute top-14 left-3 right-3 pointer-events-auto">
          <div className="relative">
            <div className="flex items-center bg-white rounded-xl shadow-lg overflow-hidden">
              <div className="pl-4">
                <Search className="w-5 h-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search Property ID, Serial No, Name..."
                className="flex-1 px-3 py-3 text-gray-800 placeholder-gray-400 outline-none text-sm"
                data-testid="property-search-input"
              />
              {searchQuery && (
                <button 
                  onClick={clearSearch}
                  className="pr-4 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            
            {/* Search Results Dropdown */}
            {showSearchResults && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg max-h-64 overflow-y-auto z-50">
                {searchResults.map((property, index) => (
                  <div
                    key={property.id}
                    onClick={() => selectSearchResult(property)}
                    className={`px-4 py-3 cursor-pointer hover:bg-blue-50 flex items-center gap-3 ${index !== searchResults.length - 1 ? 'border-b border-gray-100' : ''}`}
                    data-testid={`search-result-${index}`}
                  >
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: getMarkerColor(property.status) }}
                    >
                      {isCompleted(property.status) ? '✓' : (property.bill_sr_no || property.serial_number || '-')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">{property.owner_name}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <span className="font-mono">{property.property_id}</span>
                        <span>•</span>
                        <span>{property.colony}</span>
                      </div>
                    </div>
                    <div className={`text-xs px-2 py-0.5 rounded-full ${
                      property.status === 'Pending' ? 'bg-red-100 text-red-700' : 
                      property.status === 'Completed' ? 'bg-yellow-100 text-yellow-700' : 
                      property.status === 'Approved' ? 'bg-green-100 text-green-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {property.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* No results message */}
            {showSearchResults && searchResults.length === 0 && searchQuery.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg p-4 text-center text-gray-500 text-sm">
                No properties found for &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
        </div>

        {/* MAP CONTROLS - Right Side */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 pointer-events-auto">
          {/* Center on Location */}
          <Button
            size="sm"
            className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 shadow-lg"
            onClick={refreshLocation}
            title="My location"
          >
            <LocateFixed className="w-6 h-6" />
          </Button>
          
          {/* Auto Rotate Toggle */}
          <Button
            size="sm"
            className={`w-12 h-12 rounded-full shadow-lg ${autoRotate ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-700 hover:bg-slate-600'}`}
            onClick={toggleAutoRotate}
            title="Auto-rotate with compass"
          >
            <Compass className="w-6 h-6" />
          </Button>
          
          {/* Reset North */}
          {Math.round(viewState.bearing) !== 0 && (
            <Button
              size="sm"
              className="w-12 h-12 rounded-full bg-orange-600 hover:bg-orange-700 shadow-lg"
              onClick={resetNorth}
              title="Reset to North"
            >
              <span className="text-xs font-bold">N↑</span>
            </Button>
          )}
          
          {/* Refresh Properties - Force refresh */}
          <Button
            size="sm"
            variant="outline"
            className="w-12 h-12 rounded-full bg-white shadow-lg"
            onClick={() => fetchProperties(true)}
            title="Refresh properties"
          >
            <RefreshCw className="w-5 h-5 text-slate-700" />
          </Button>
        </div>

        {/* BOTTOM INFO BAR with Color Legend */}
        <div className="absolute bottom-[68px] left-0 right-0 bg-white/95 backdrop-blur-sm text-slate-800 border-t border-slate-200 px-4 py-2.5 pointer-events-auto" data-testid="map-bottom-info-bar">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-slate-500">Total: </span>
              <span className="font-bold text-lg text-slate-900">{sortedProperties.length}</span>
              <span className="text-slate-500"> properties</span>
            </div>
            
            {/* Color Legend with live counts — tap a colour to filter pins */}
            <div className="flex items-center gap-2 text-xs" data-testid="surveyor-legend-counts">
              <button type="button" onClick={() => setMapFilter((s) => (s === 'Pending' ? null : 'Pending'))} data-testid="surveyor-legend-red"
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 border ${mapFilter === 'Pending' ? 'border-red-500 bg-red-50' : 'border-transparent'}`}>
                <div className="w-3 h-3 rounded-full bg-red-500 border border-white"></div>
                <span className="text-red-700">Pending <b>{stats.pending}</b></span>
              </button>
              <button type="button" onClick={() => setMapFilter((s) => (s === 'Completed' ? null : 'Completed'))} data-testid="surveyor-legend-yellow"
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 border ${mapFilter === 'Completed' ? 'border-yellow-500 bg-yellow-50' : 'border-transparent'}`}>
                <div className="w-3 h-3 rounded-full bg-yellow-500 border border-white"></div>
                <span className="text-yellow-700">Submitted <b>{sortedProperties.filter(p => p.status === 'Completed').length}</b></span>
              </button>
              <button type="button" onClick={() => setMapFilter((s) => (s === 'Approved' ? null : 'Approved'))} data-testid="surveyor-legend-green"
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 border ${mapFilter === 'Approved' ? 'border-green-600 bg-green-50' : 'border-transparent'}`}>
                <div className="w-3 h-3 rounded-full bg-green-600 border border-white"></div>
                <span className="text-emerald-700">Approved <b>{sortedProperties.filter(p => p.status === 'Approved').length}</b></span>
              </button>
              {mapFilter && <button type="button" onClick={() => setMapFilter(null)} className="text-slate-500 underline" data-testid="surveyor-legend-clear">clear</button>}
            </div>
            
            {sortedProperties.length > 0 && sortedProperties[0].distance && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span className="text-sm">
                  Nearest: <strong>{formatDistance(sortedProperties[0].distance)}</strong>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Rotation hint - only show initially */}
        <div className="absolute bottom-[132px] left-1/2 -translate-x-1/2">
          <div className="bg-slate-900/80 text-white text-xs px-3 py-1.5 rounded-full">
            👆👆 Two fingers to rotate 360°
          </div>
        </div>
      </div>
    </EmployeeLayout>
  );
}
