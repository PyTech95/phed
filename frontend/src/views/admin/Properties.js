import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { Search, UserPlus, FileSpreadsheet, ChevronLeft, ChevronRight, MapPin, Eye, User, Phone, Home, Navigation, ExternalLink, Trash2, UserMinus, Users, Image, Loader2 } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom red marker for highlighted property
const redIcon = L.divIcon({
  className: 'custom-marker',
  html: `<div style="
    background-color: #ef4444;
    width: 32px;
    height: 32px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    border: 4px solid white;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  "></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export default function Properties() {
  const { token } = useAuth();
  const [properties, setProperties] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [batches, setBatches] = useState([]);
  const [areas, setAreas] = useState([]);
  const [towns, setTowns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  
  // Filters
  const [filters, setFilters] = useState({
    batch_id: '',
    area: '',
    town: '',
    status: '',
    employee_id: '',
    search: ''
  });

  // Assignment dialog
  const [assignDialog, setAssignDialog] = useState(false);
  const [selectedProperties, setSelectedProperties] = useState([]);
  const [assignEmployeeIds, setAssignEmployeeIds] = useState([]); // Changed to array for multi-select
  const [bulkAssignArea, setBulkAssignArea] = useState('');
  const [customDistribution, setCustomDistribution] = useState({}); // { empId: count }
  const [useCustomDistribution, setUseCustomDistribution] = useState(false);
  const [areaPropertyCount, setAreaPropertyCount] = useState(0); // Total properties in selected area
  
  // Range-based assignment (for large colonies like Sector 5)
  const [useRangeAssign, setUseRangeAssign] = useState(false);
  const [serialRangeFrom, setSerialRangeFrom] = useState('');
  const [serialRangeTo, setSerialRangeTo] = useState('');
  
  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleteAllDialog, setDeleteAllDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  // Delete Colony dialog
  const [deleteColonyDialog, setDeleteColonyDialog] = useState(false);
  const [selectedColony, setSelectedColony] = useState('');
  const [keepSurveyed, setKeepSurveyed] = useState(true);
  const [deletingColony, setDeletingColony] = useState(false);
  
  // Delete Duplicates dialog
  const [deleteDuplicatesDialog, setDeleteDuplicatesDialog] = useState(false);
  const [deletingDuplicates, setDeletingDuplicates] = useState(false);
  
  // Unassign dialog
  const [unassignDialog, setUnassignDialog] = useState(false);
  const [unassignEmployeeId, setUnassignEmployeeId] = useState('');
  const [unassignArea, setUnassignArea] = useState(''); // NEW: Bulk unassign by area
  const [unassigning, setUnassigning] = useState(false);
  
  // Property detail dialog
  const [detailDialog, setDetailDialog] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [propertyPhotos, setPropertyPhotos] = useState([]);
  const [propertySubmission, setPropertySubmission] = useState(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  // Block Assign Colonies dialog
  const [blockColonyDialog, setBlockColonyDialog] = useState(false);
  const [blockColonyMode, setBlockColonyMode] = useState('assign'); // 'assign' or 'unassign'
  const [allColonies, setAllColonies] = useState([]);
  const [selectedColonies, setSelectedColonies] = useState([]);
  const [blockColonyEmployees, setBlockColonyEmployees] = useState([]);
  const [blockColonyLoading, setBlockColonyLoading] = useState(false);

  // Toggle employee selection for multi-assign
  const toggleEmployeeSelection = (empId) => {
    setAssignEmployeeIds(prev => {
      if (prev.includes(empId)) {
        return prev.filter(id => id !== empId);
      } else {
        return [...prev, empId];
      }
    });
  };

  const fetchInitialData = async () => {
    try {
      console.log('Fetching initial data...');
      const [empRes, batchRes, areaRes, townRes] = await Promise.all([
        axios.get(`${API_URL}/admin/users`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_URL}/admin/batches`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_URL}/admin/areas`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_URL}/admin/towns`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      console.log('Users fetched:', empRes.data.length);
      const nonAdminUsers = empRes.data.filter(u => u.role !== 'ADMIN');
      console.log('Non-admin users:', nonAdminUsers.length);
      setEmployees(nonAdminUsers);
      setBatches(batchRes.data || []);
      setAreas(areaRes.data.areas || []);
      setTowns(townRes.data.towns || []);
    } catch (error) {
      console.error('Failed to fetch initial data:', error);
      toast.error('Failed to load employees');
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, [token]);

  useEffect(() => {
    fetchProperties();
  }, [filters, pagination.page]);

  const fetchProperties = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.batch_id) params.append('batch_id', filters.batch_id);
      if (filters.area) params.append('ward', filters.area);
      if (filters.town) params.append('town', filters.town);
      if (filters.status) params.append('status', filters.status);
      if (filters.employee_id) params.append('employee_id', filters.employee_id);
      if (filters.search) params.append('search', filters.search);
      params.append('page', pagination.page);
      params.append('limit', 20);

      const response = await axios.get(`${API_URL}/admin/properties?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setProperties(response.data.properties);
      setPagination(prev => ({
        ...prev,
        pages: response.data.pages,
        total: response.data.total
      }));
    } catch (error) {
      toast.error('Failed to load properties');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (assignEmployeeIds.length === 0) {
      toast.error('Please select at least one employee');
      return;
    }

    try {
      // Assign to multiple employees (they work together)
      await axios.post(`${API_URL}/admin/assign`, {
        property_ids: selectedProperties,
        employee_ids: assignEmployeeIds  // Send array of employee IDs
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(`Properties assigned to ${assignEmployeeIds.length} employee(s)`);
      setAssignDialog(false);
      setSelectedProperties([]);
      setAssignEmployeeIds([]);
      fetchProperties();
    } catch (error) {
      toast.error('Failed to assign properties');
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkAssignArea || assignEmployeeIds.length === 0) {
      toast.error('Please select area and at least one employee');
      return;
    }

    // Validate range if enabled
    if (useRangeAssign) {
      if (!serialRangeFrom || !serialRangeTo) {
        toast.error('Please enter both From and To serial numbers');
        return;
      }
      const from = parseInt(serialRangeFrom);
      const to = parseInt(serialRangeTo);
      if (isNaN(from) || isNaN(to) || from > to) {
        toast.error('Invalid serial number range');
        return;
      }
    }

    // Validate custom distribution if enabled
    if (useCustomDistribution && !useRangeAssign) {
      const totalAssigned = Object.values(customDistribution).reduce((sum, count) => sum + (parseInt(count) || 0), 0);
      if (totalAssigned !== areaPropertyCount) {
        toast.error(`Distribution total (${totalAssigned}) must equal total properties (${areaPropertyCount})`);
        return;
      }
    }

    try {
      const payload = {
        area: bulkAssignArea,
        employee_ids: assignEmployeeIds,
        custom_distribution: useCustomDistribution && !useRangeAssign ? customDistribution : null
      };
      
      // Add range parameters if enabled
      if (useRangeAssign) {
        payload.serial_from = parseInt(serialRangeFrom);
        payload.serial_to = parseInt(serialRangeTo);
      }
      
      const response = await axios.post(`${API_URL}/admin/assign-bulk`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(response.data.message);
      setAssignDialog(false);
      setBulkAssignArea('');
      setAssignEmployeeIds([]);
      setCustomDistribution({});
      setUseCustomDistribution(false);
      setUseRangeAssign(false);
      setSerialRangeFrom('');
      setSerialRangeTo('');
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to assign properties');
    }
  };

  // Fetch property count when area is selected
  const fetchAreaPropertyCount = async (area) => {
    try {
      const response = await axios.get(`${API_URL}/admin/properties?ward=${encodeURIComponent(area)}&limit=1`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAreaPropertyCount(response.data.total || 0);
    } catch (error) {
      setAreaPropertyCount(0);
    }
  };

  // Handle bulk unassign by area
  const handleBulkUnassignByArea = async () => {
    if (!unassignArea) {
      toast.error('Please select an area');
      return;
    }

    setUnassigning(true);
    try {
      const response = await axios.post(`${API_URL}/admin/unassign-bulk`, {
        area: unassignArea,
        employee_id: unassignEmployeeId || null // Optional: unassign specific employee only
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(response.data.message);
      setUnassignDialog(false);
      setUnassignArea('');
      setUnassignEmployeeId('');
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to unassign properties');
    } finally {
      setUnassigning(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProperties.length === 0) {
      toast.error('No properties selected');
      return;
    }

    setDeleting(true);
    try {
      const response = await axios.post(`${API_URL}/admin/properties/bulk-delete`, {
        property_ids: selectedProperties
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(response.data.message || `Deleted ${selectedProperties.length} properties`);
      setDeleteDialog(false);
      setSelectedProperties([]);
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete properties');
    } finally {
      setDeleting(false);
    }
  };

  // Block Assign/Unassign Colonies
  const openBlockColonyDialog = async (mode) => {
    setBlockColonyMode(mode);
    setSelectedColonies([]);
    setBlockColonyEmployees([]);
    setBlockColonyDialog(true);
    try {
      const res = await axios.get(`${API_URL}/admin/colonies`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAllColonies(res.data.colonies || []);
    } catch (error) {
      toast.error('Failed to load colonies');
    }
  };

  const toggleColonySelection = (colony) => {
    setSelectedColonies(prev =>
      prev.includes(colony) ? prev.filter(c => c !== colony) : [...prev, colony]
    );
  };

  const handleBlockColonyAction = async () => {
    if (selectedColonies.length === 0) {
      toast.error('Please select at least one colony');
      return;
    }
    if (blockColonyMode === 'assign' && blockColonyEmployees.length === 0) {
      toast.error('Please select at least one employee');
      return;
    }
    setBlockColonyLoading(true);
    try {
      const url = blockColonyMode === 'assign'
        ? `${API_URL}/admin/block-assign-colonies`
        : `${API_URL}/admin/block-unassign-colonies`;
      const payload = blockColonyMode === 'assign'
        ? { colonies: selectedColonies, employee_ids: blockColonyEmployees }
        : { colonies: selectedColonies };
      const res = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(res.data.message);
      setBlockColonyDialog(false);
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setBlockColonyLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      // Build query params same as current filters
      const params = new URLSearchParams();
      if (filters.batch_id && filters.batch_id.trim()) params.append('batch_id', filters.batch_id);
      if (filters.area && filters.area.trim()) params.append('ward', filters.area);
      if (filters.status && filters.status.trim()) params.append('status', filters.status);
      if (filters.employee_id && filters.employee_id.trim()) params.append('employee_id', filters.employee_id);
      if (filters.search) params.append('search', filters.search);
      
      const response = await axios.post(`${API_URL}/admin/properties/delete-all?${params}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(response.data.message || `Deleted all properties`);
      setDeleteAllDialog(false);
      setSelectedProperties([]);
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete properties');
    } finally {
      setDeleting(false);
    }
  };

  // Delete single colony
  const handleDeleteColony = async () => {
    if (!selectedColony) {
      toast.error('Please select a colony');
      return;
    }
    
    setDeletingColony(true);
    try {
      const formData = new FormData();
      formData.append('colony', selectedColony);
      formData.append('keep_surveyed', keepSurveyed.toString());
      
      const response = await axios.post(`${API_URL}/admin/properties/delete-colony`, formData, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      
      toast.success(response.data.message);
      if (response.data.kept_surveyed > 0) {
        toast.info(`Kept ${response.data.kept_surveyed} properties with surveys`);
      }
      setDeleteColonyDialog(false);
      setSelectedColony('');
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete colony');
    } finally {
      setDeletingColony(false);
    }
  };

  // Delete duplicate properties (keep surveyed)
  const handleDeleteDuplicates = async () => {
    setDeletingDuplicates(true);
    try {
      const formData = new FormData();
      if (filters.area) formData.append('colony', filters.area);
      
      const response = await axios.post(`${API_URL}/admin/properties/delete-duplicates`, formData, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      
      toast.success(response.data.message);
      setDeleteDuplicatesDialog(false);
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete duplicates');
    } finally {
      setDeletingDuplicates(false);
    }
  };

  // Unassign properties
  const handleUnassign = async () => {
    if (selectedProperties.length === 0) {
      toast.error('No properties selected');
      return;
    }

    setUnassigning(true);
    try {
      const response = await axios.post(`${API_URL}/admin/unassign`, {
        property_ids: selectedProperties,
        employee_id: unassignEmployeeId || null  // null = unassign all
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(response.data.message);
      setUnassignDialog(false);
      setSelectedProperties([]);
      setUnassignEmployeeId('');
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to unassign properties');
    } finally {
      setUnassigning(false);
    }
  };

  // Unassign all properties from an employee (when they leave)
  const handleUnassignAllFromEmployee = async (employeeId) => {
    if (!employeeId) {
      toast.error('Please select an employee');
      return;
    }

    setUnassigning(true);
    try {
      const response = await axios.post(`${API_URL}/admin/unassign-by-employee?employee_id=${employeeId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(response.data.message);
      setUnassignDialog(false);
      setUnassignEmployeeId('');
      fetchProperties();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to unassign properties');
    } finally {
      setUnassigning(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedProperties(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleViewProperty = async (prop) => {
    setSelectedProperty(prop);
    setDetailDialog(true);
    setPropertyPhotos([]);
    setPropertySubmission(null);
    setLoadingPhotos(true);
    
    const photos = [];
    
    // 1. Add OLD photo from property itself (uploaded via CSV)
    if (prop.photo_url && prop.photo_url.trim()) {
      const oldUrl = prop.photo_url.startsWith('http') 
        ? prop.photo_url 
        : `${process.env.REACT_APP_BACKEND_URL}${prop.photo_url}`;
      // Use proxy for external government URLs
      const proxyUrl = prop.photo_url.includes('property.ulbharyana.gov.in') || prop.photo_url.includes('http')
        ? `${process.env.REACT_APP_BACKEND_URL}/api/proxy-image?url=${encodeURIComponent(prop.photo_url)}`
        : oldUrl;
      photos.push({
        url: proxyUrl,
        label: 'Old Property Photo'
      });
    }
    
    try {
      const res = await axios.get(`${API_URL}/submission/by-property/${prop.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const sub = res.data?.submission;
      setPropertySubmission(sub);
      if (sub) {
        // 2. Add old photo from submission's property_photo_url if not already added
        if (sub.property_photo_url && sub.property_photo_url.trim() && !prop.photo_url) {
          const subOldUrl = sub.property_photo_url.includes('http')
            ? `${process.env.REACT_APP_BACKEND_URL}/api/proxy-image?url=${encodeURIComponent(sub.property_photo_url)}`
            : `${process.env.REACT_APP_BACKEND_URL}${sub.property_photo_url}`;
          photos.push({
            url: subOldUrl,
            label: 'Old Property Photo'
          });
        }
        // 3. Add survey submission photos
        if (sub.photos && Array.isArray(sub.photos)) {
          sub.photos.forEach(p => {
            const url = typeof p === 'string' ? p : (p.file_url || p.url || p.path || '');
            if (url) {
              const isExternal = url.startsWith('http');
              photos.push({
                url: isExternal ? url : `${process.env.REACT_APP_BACKEND_URL}${url}`,
                label: typeof p === 'object' ? (p.photo_type || 'Survey Photo') : 'Survey Photo'
              });
            }
          });
        }
      }
    } catch (e) {
      // No submission found - that's fine, old photo still shows
    } finally {
      setPropertyPhotos(photos);
      setLoadingPhotos(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedProperties.length === properties.length) {
      setSelectedProperties([]);
    } else {
      setSelectedProperties(properties.map(p => p.id));
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      'Pending': 'badge-pending',
      'Completed': 'badge-completed',
      'In Progress': 'badge-in-progress',
      'Flagged': 'badge-flagged'
    };
    return <span className={badges[status] || 'badge-pending'}>{status}</span>;
  };

  return (
    <AdminLayout title="Property Management">
      <div data-testid="admin-properties" className="space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search by Property ID, Owner, Mobile..."
                    data-testid="property-search-input"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-10"
                  />
                </div>
              </div>
              
              <Select
                value={filters.batch_id}
                onValueChange={(value) => setFilters({ ...filters, batch_id: value })}
              >
                <SelectTrigger className="w-[180px]" data-testid="batch-filter">
                  <SelectValue placeholder="All Batches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All Batches</SelectItem>
                  {batches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.area}
                onValueChange={(value) => setFilters({ ...filters, area: value })}
              >
                <SelectTrigger className="w-[150px]" data-testid="area-filter">
                  <SelectValue placeholder="All Areas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All Areas</SelectItem>
                  {areas.map(a => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.town}
                onValueChange={(value) => setFilters({ ...filters, town: value })}
              >
                <SelectTrigger className="w-[150px]" data-testid="town-filter">
                  <SelectValue placeholder="All Towns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All Towns</SelectItem>
                  {towns.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.status}
                onValueChange={(value) => setFilters({ ...filters, status: value })}
              >
                <SelectTrigger className="w-[150px]" data-testid="status-filter">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All Status</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Flagged">Flagged</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={() => setFilters({ batch_id: '', area: '', town: '', status: '', employee_id: '', search: '' })}
              >
                Clear
              </Button>

              {selectedProperties.length > 0 && (
                <>
                  <Button
                    data-testid="assign-selected-btn"
                    onClick={() => setAssignDialog(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Assign ({selectedProperties.length})
                  </Button>
                  <Button
                    data-testid="unassign-selected-btn"
                    onClick={() => setUnassignDialog(true)}
                    variant="outline"
                    className="border-orange-500 text-orange-600 hover:bg-orange-50"
                  >
                    <UserMinus className="w-4 h-4 mr-2" />
                    Unassign ({selectedProperties.length})
                  </Button>
                  <Button
                    data-testid="delete-selected-btn"
                    onClick={() => setDeleteDialog(true)}
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete ({selectedProperties.length})
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                data-testid="bulk-assign-btn"
                onClick={() => {
                  setSelectedProperties([]);
                  setAssignDialog(true);
                }}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Bulk Assign by Area
              </Button>

              <Button
                variant="outline"
                data-testid="unassign-employee-btn"
                onClick={() => {
                  setSelectedProperties([]);
                  setUnassignDialog(true);
                }}
                className="border-orange-400 text-orange-600 hover:bg-orange-50"
              >
                <UserMinus className="w-4 h-4 mr-2" />
                Unassign Employee
              </Button>

              <Button
                variant="outline"
                data-testid="block-assign-colonies-btn"
                onClick={() => openBlockColonyDialog('assign')}
                className="border-green-500 text-green-600 hover:bg-green-50"
              >
                <Users className="w-4 h-4 mr-2" />
                Bulk Assign Colonies
              </Button>

              <Button
                variant="outline"
                data-testid="block-unassign-colonies-btn"
                onClick={() => openBlockColonyDialog('unassign')}
                className="border-red-400 text-red-600 hover:bg-red-50"
              >
                <UserMinus className="w-4 h-4 mr-2" />
                Bulk Unassign Colonies
              </Button>

              {/* Delete Colony Button */}
              <Button
                variant="outline"
                className="border-orange-500 text-orange-600 hover:bg-orange-50"
                onClick={() => setDeleteColonyDialog(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Colony
              </Button>

              {/* Delete Duplicates Button */}
              <Button
                variant="outline"
                className="border-purple-500 text-purple-600 hover:bg-purple-50"
                onClick={() => setDeleteDuplicatesDialog(true)}
              >
                <Users className="w-4 h-4 mr-2" />
                Delete Duplicates
              </Button>

              {/* Delete All Button - Always visible when there are properties */}
              {pagination.total > 0 && (
                <Button
                  variant="destructive"
                  data-testid="delete-all-btn"
                  onClick={() => setDeleteAllDialog(true)}
                  className="bg-red-600 hover:bg-red-700"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All ({pagination.total})
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Properties Table */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-pulse-slow text-slate-500">Loading...</div>
          </div>
        ) : properties.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileSpreadsheet className="w-12 h-12 mx-auto text-slate-300 mb-4" />
              <h3 className="font-heading font-semibold text-slate-900 mb-2">No properties found</h3>
              <p className="text-slate-500">Upload a dataset to see properties here</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="shadow-lg border-0">
              <CardContent className="p-0 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={selectedProperties.length === properties.length && properties.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <th>Property ID</th>
                      <th>Owner</th>
                      <th>Mobile</th>
                      <th>Address</th>
                      <th>Area</th>
                      <th className="text-center">GPS</th>
                      <th>Assigned To</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {properties.map((prop) => (
                      <tr key={prop.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedProperties.includes(prop.id)}
                            onChange={() => toggleSelect(prop.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="font-mono text-sm font-medium text-blue-600">{prop.property_id}</td>
                        <td>{prop.owner_name}</td>
                        <td className="font-mono text-sm">{prop.mobile}</td>
                        <td className="max-w-[200px] truncate" title={prop.address || prop.plot_address}>
                          {prop.address || prop.plot_address || '-'}
                        </td>
                        <td>{prop.colony || prop.area || '-'}</td>
                        <td className="text-center">
                          {prop.latitude && prop.longitude ? (
                            <a 
                              href={`https://www.google.com/maps?q=${prop.latitude},${prop.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-colors"
                              title={`${prop.latitude?.toFixed(6)}, ${prop.longitude?.toFixed(6)}`}
                            >
                              <MapPin className="w-4 h-4" />
                            </a>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td>{prop.assigned_employee_name || <span className="text-slate-400">Unassigned</span>}</td>
                        <td>{getStatusBadge(prop.status)}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewProperty(prop)}
                              className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              title="View Details"
                              data-testid={`view-property-${prop.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Pagination */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                Showing {((pagination.page - 1) * 20) + 1} to {Math.min(pagination.page * 20, pagination.total)} of {pagination.total} properties
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-3 py-1 text-sm">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Assignment Dialog */}
        <Dialog open={assignDialog} onOpenChange={setAssignDialog}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading">
                {selectedProperties.length > 0 ? 'Assign Selected Properties' : 'Bulk Assign by Area'}
              </DialogTitle>
              <DialogDescription>
                {selectedProperties.length > 0 
                  ? `Assign ${selectedProperties.length} selected properties to employees (they can work together)`
                  : 'Assign all unassigned properties in an area to employees'
                }
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {selectedProperties.length === 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Area/Zone</label>
                  <Select 
                    value={bulkAssignArea} 
                    onValueChange={(v) => {
                      setBulkAssignArea(v);
                      fetchAreaPropertyCount(v);
                    }}
                  >
                    <SelectTrigger data-testid="bulk-area-select">
                      <SelectValue placeholder="Select area" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(a => (
                        <SelectItem key={a} value={a}>{a}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {bulkAssignArea && areaPropertyCount > 0 && (
                    <p className="text-sm text-blue-600 font-medium">
                      📊 {areaPropertyCount} properties in this area
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Select Employees ({assignEmployeeIds.length} selected)
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Select multiple employees to work together on these properties
                </p>
                <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1">
                  {employees.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">
                      No employees found
                    </p>
                  ) : (
                    employees.map((emp) => (
                      <div
                        key={emp.id}
                        className={`flex items-center gap-3 p-2 rounded cursor-pointer hover:bg-slate-50 ${
                          assignEmployeeIds.includes(emp.id) ? 'bg-blue-50 border border-blue-200' : ''
                        }`}
                        onClick={() => toggleEmployeeSelection(emp.id)}
                      >
                        <Checkbox
                          checked={assignEmployeeIds.includes(emp.id)}
                          onCheckedChange={() => toggleEmployeeSelection(emp.id)}
                        />
                        <div className="flex-1">
                          <p className="font-medium text-slate-900 text-sm">{emp.name}</p>
                          <p className="text-xs text-slate-500">
                            {emp.username} • {emp.role}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Range Assignment - For large colonies */}
              {selectedProperties.length === 0 && bulkAssignArea && (
                <div className="space-y-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useRangeAssign}
                      onCheckedChange={(checked) => {
                        setUseRangeAssign(checked);
                        if (!checked) {
                          setSerialRangeFrom('');
                          setSerialRangeTo('');
                        }
                      }}
                    />
                    <label className="text-sm font-medium text-blue-800">
                      📊 Assign by Serial Number Range (for large colonies)
                    </label>
                  </div>

                  {useRangeAssign && (
                    <div className="space-y-2">
                      <p className="text-xs text-blue-700">
                        Assign properties within a serial number range to selected employee(s)
                      </p>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <Label className="text-xs text-blue-700">From Serial</Label>
                          <Input
                            type="number"
                            min="1"
                            value={serialRangeFrom}
                            onChange={(e) => setSerialRangeFrom(e.target.value)}
                            placeholder="e.g., 1"
                            className="h-9"
                          />
                        </div>
                        <span className="mt-5 text-slate-400">→</span>
                        <div className="flex-1">
                          <Label className="text-xs text-blue-700">To Serial</Label>
                          <Input
                            type="number"
                            min="1"
                            value={serialRangeTo}
                            onChange={(e) => setSerialRangeTo(e.target.value)}
                            placeholder="e.g., 200"
                            className="h-9"
                          />
                        </div>
                      </div>
                      {serialRangeFrom && serialRangeTo && (
                        <p className="text-xs text-blue-600 font-medium">
                          Will assign {Math.max(0, parseInt(serialRangeTo) - parseInt(serialRangeFrom) + 1)} properties (Serial {serialRangeFrom} to {serialRangeTo})
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Custom Distribution Toggle - Only for bulk assign without range */}
              {selectedProperties.length === 0 && assignEmployeeIds.length > 1 && bulkAssignArea && areaPropertyCount > 0 && !useRangeAssign && (
                <div className="space-y-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={useCustomDistribution}
                      onCheckedChange={(checked) => {
                        setUseCustomDistribution(checked);
                        if (checked) {
                          // Initialize with equal distribution
                          const perEmployee = Math.floor(areaPropertyCount / assignEmployeeIds.length);
                          const remainder = areaPropertyCount % assignEmployeeIds.length;
                          const dist = {};
                          assignEmployeeIds.forEach((empId, idx) => {
                            dist[empId] = perEmployee + (idx < remainder ? 1 : 0);
                          });
                          setCustomDistribution(dist);
                        } else {
                          setCustomDistribution({});
                        }
                      }}
                    />
                    <label className="text-sm font-medium text-amber-800">
                      Custom Distribution (specify count per employee)
                    </label>
                  </div>

                  {useCustomDistribution && (
                    <div className="space-y-2">
                      <p className="text-xs text-amber-700">
                        Total: {areaPropertyCount} properties | Assigned: {Object.values(customDistribution).reduce((sum, c) => sum + (parseInt(c) || 0), 0)}
                      </p>
                      {assignEmployeeIds.map(empId => {
                        const emp = employees.find(e => e.id === empId);
                        return (
                          <div key={empId} className="flex items-center gap-3">
                            <span className="text-sm font-medium w-32 truncate">{emp?.name || 'Unknown'}</span>
                            <Input
                              type="number"
                              min="0"
                              max={areaPropertyCount}
                              value={customDistribution[empId] || 0}
                              onChange={(e) => setCustomDistribution({
                                ...customDistribution,
                                [empId]: parseInt(e.target.value) || 0
                              })}
                              className="w-24 h-8"
                            />
                            <span className="text-xs text-slate-500">properties</span>
                          </div>
                        );
                      })}
                      {Object.values(customDistribution).reduce((sum, c) => sum + (parseInt(c) || 0), 0) !== areaPropertyCount && (
                        <p className="text-xs text-red-600">
                          ⚠️ Total must equal {areaPropertyCount}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setAssignDialog(false);
                setAssignEmployeeIds([]);
                setCustomDistribution({});
                setUseCustomDistribution(false);
                setUseRangeAssign(false);
                setSerialRangeFrom('');
                setSerialRangeTo('');
              }}>
                Cancel
              </Button>
              <Button 
                onClick={selectedProperties.length > 0 ? handleAssign : handleBulkAssign}
                data-testid="confirm-assign-btn"
                className="bg-blue-700 hover:bg-blue-800 text-white"
                disabled={assignEmployeeIds.length === 0}
              >
                Assign to {assignEmployeeIds.length} Employee(s)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Property Detail Dialog with Map - Side by Side Layout */}
        <Dialog open={detailDialog} onOpenChange={setDetailDialog}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
            <div className="grid grid-cols-1 lg:grid-cols-2">
              {/* Left Side - Property Details */}
              <div className="p-6 bg-white">
                <DialogHeader className="mb-6">
                  <DialogTitle className="font-heading flex items-center gap-2 text-xl">
                    <FileSpreadsheet className="w-6 h-6 text-blue-600" />
                    Property Details
                  </DialogTitle>
                  <p className="text-sm text-slate-500 mt-1">View and manage property information</p>
                </DialogHeader>

                {selectedProperty && (
                  <div className="space-y-5">
                    {/* Property ID Badge */}
                    <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 rounded-xl">
                      <p className="text-xs opacity-80 uppercase tracking-wider">Property ID</p>
                      <p className="font-mono font-bold text-2xl mt-1">{selectedProperty.property_id}</p>
                      {selectedProperty.old_property_id && (
                        <p className="text-xs opacity-70 mt-1">Old ID: {selectedProperty.old_property_id}</p>
                      )}
                    </div>

                    {/* Owner Info */}
                    <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <User className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Owner Name</p>
                          <p className="font-semibold text-lg">{selectedProperty.owner_name || '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                          <Phone className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Mobile Number</p>
                          <p className="font-mono font-medium">{selectedProperty.mobile || '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                          <Home className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Address</p>
                          <p className="text-slate-700">{selectedProperty.address || selectedProperty.plot_address || '-'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Property Details Grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <p className="text-xs text-blue-600 font-medium">Colony/Area</p>
                        <p className="font-semibold">{selectedProperty.colony || selectedProperty.area || '-'}</p>
                      </div>
                      <div className="bg-purple-50 p-3 rounded-lg">
                        <p className="text-xs text-purple-600 font-medium">Category</p>
                        <p className="font-semibold">{selectedProperty.category || '-'}</p>
                      </div>
                      <div className="bg-emerald-50 p-3 rounded-lg">
                        <p className="text-xs text-emerald-600 font-medium">Total Area</p>
                        <p className="font-semibold">{selectedProperty.total_area || '-'} Sq.Yard</p>
                      </div>
                      <div className="bg-red-50 p-3 rounded-lg">
                        <p className="text-xs text-red-600 font-medium">Outstanding</p>
                        <p className="font-bold text-red-600">₹{selectedProperty.amount || '0'}</p>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="flex items-center justify-between pt-4 border-t">
                      <div>
                        <p className="text-xs text-slate-500">Assigned To</p>
                        <p className="font-medium">{selectedProperty.assigned_employee_name || 'Unassigned'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Status</p>
                        {getStatusBadge(selectedProperty.status)}
                      </div>
                    </div>

                    {/* GPS Link */}
                    {selectedProperty.latitude && selectedProperty.longitude && (
                      <a
                        href={`https://www.google.com/maps?q=${selectedProperty.latitude},${selectedProperty.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 p-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                      >
                        <Navigation className="w-4 h-4" />
                        Open in Google Maps
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}

                    {/* Property Photos Section */}
                    <div className="border-t pt-4">
                      <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
                        <Image className="w-4 h-4 text-blue-500" />
                        Property Photos
                      </h4>
                      {loadingPhotos ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                          <span className="ml-2 text-sm text-slate-500">Loading photos...</span>
                        </div>
                      ) : propertyPhotos.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {propertyPhotos.map((photo, idx) => (
                            <div key={idx} className="relative group rounded-lg overflow-hidden border bg-slate-50">
                              <img
                                src={photo.url}
                                alt={photo.label}
                                className="w-full h-32 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => window.open(photo.url, '_blank')}
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-2 py-1 text-center">
                                {photo.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : propertySubmission ? (
                        <p className="text-xs text-slate-400 text-center py-4">No photos in submission</p>
                      ) : (
                        <p className="text-xs text-slate-400 text-center py-4">No survey submission yet</p>
                      )}
                    </div>

                    {/* Submission Info */}
                    {propertySubmission && (
                      <div className="border-t pt-3">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {propertySubmission.receiver_name && (
                            <div className="bg-green-50 p-2 rounded">
                              <span className="text-green-600 font-medium">Receiver:</span>
                              <span className="ml-1">{propertySubmission.receiver_name}</span>
                            </div>
                          )}
                          {propertySubmission.house_status && (
                            <div className="bg-blue-50 p-2 rounded">
                              <span className="text-blue-600 font-medium">House:</span>
                              <span className="ml-1 capitalize">{propertySubmission.house_status}</span>
                            </div>
                          )}
                          {propertySubmission.special_condition && (
                            <div className="bg-amber-50 p-2 rounded">
                              <span className="text-amber-600 font-medium">Condition:</span>
                              <span className="ml-1 capitalize">{propertySubmission.special_condition.replace(/_/g, ' ')}</span>
                            </div>
                          )}
                          {propertySubmission.property_use && (
                            <div className="bg-purple-50 p-2 rounded">
                              <span className="text-purple-600 font-medium">Use:</span>
                              <span className="ml-1 capitalize">{propertySubmission.property_use}</span>
                            </div>
                          )}
                          {propertySubmission.employee_name && (
                            <div className="bg-slate-50 p-2 rounded">
                              <span className="text-slate-600 font-medium">Surveyed By:</span>
                              <span className="ml-1">{propertySubmission.employee_name}</span>
                            </div>
                          )}
                          {propertySubmission.status && (
                            <div className="bg-slate-50 p-2 rounded">
                              <span className="text-slate-600 font-medium">Survey Status:</span>
                              <span className={`ml-1 font-semibold ${propertySubmission.status === 'Approved' ? 'text-green-600' : propertySubmission.status === 'Pending' ? 'text-amber-600' : 'text-red-600'}`}>
                                {propertySubmission.status}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <Button variant="outline" onClick={() => setDetailDialog(false)} className="w-full">
                      Close
                    </Button>
                  </div>
                )}
              </div>

              {/* Right Side - Map */}
              <div className="bg-slate-900 min-h-[600px] relative">
                {selectedProperty?.latitude && selectedProperty?.longitude ? (
                  <>
                    <div className="absolute top-0 left-0 right-0 z-10 bg-slate-900/90 backdrop-blur px-4 py-3 flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-red-500" />
                      <div>
                        <p className="text-white font-medium text-sm">Property Location</p>
                        <p className="text-slate-400 text-xs font-mono">
                          {selectedProperty.latitude?.toFixed(6)}, {selectedProperty.longitude?.toFixed(6)}
                        </p>
                      </div>
                    </div>
                    <div style={{ height: '100%', width: '100%', minHeight: '600px' }}>
                      <MapContainer
                        center={[selectedProperty.latitude, selectedProperty.longitude]}
                        zoom={18}
                        minZoom={5}
                        maxZoom={18}
                        maxBounds={[[-85, -180], [85, 180]]}
                        maxBoundsViscosity={1.0}
                        style={{ height: '100%', width: '100%' }}
                        scrollWheelZoom={true}
                      >
                        <TileLayer
                          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                          attribution='&copy; Esri'
                          maxZoom={18}
                        />
                        <Marker 
                          position={[selectedProperty.latitude, selectedProperty.longitude]}
                          icon={redIcon}
                        >
                          <Popup>
                            <div className="text-center p-1">
                              <p className="font-bold text-blue-600">{selectedProperty.property_id}</p>
                              <p className="text-sm">{selectedProperty.owner_name}</p>
                              <p className="text-xs text-slate-500">{selectedProperty.address}</p>
                            </div>
                          </Popup>
                        </Marker>
                      </MapContainer>
                    </div>
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500">
                    <div className="text-center">
                      <MapPin className="w-12 h-12 mx-auto opacity-30 mb-2" />
                      <p>No GPS coordinates available</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-600 flex items-center gap-2">
                <Trash2 className="w-5 h-5" />
                Delete Properties
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{selectedProperties.length}</strong> selected properties? 
                This action cannot be undone. All associated submissions will also be removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleBulkDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700"
                data-testid="confirm-delete-btn"
              >
                {deleting ? 'Deleting...' : `Delete ${selectedProperties.length} Properties`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete All Confirmation Dialog */}
        <AlertDialog open={deleteAllDialog} onOpenChange={setDeleteAllDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-600 flex items-center gap-2">
                <Trash2 className="w-5 h-5" />
                Delete ALL Properties
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  Are you sure you want to delete <strong className="text-red-600 text-lg">{pagination.total}</strong> properties?
                </p>
                <p className="text-red-600 font-semibold">
                  ⚠️ This will permanently delete ALL properties{filters.batch_id || filters.area || filters.status ? ' matching your current filters' : ''} and their submissions!
                </p>
                <p>This action cannot be undone.</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteAll}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700"
                data-testid="confirm-delete-all-btn"
              >
                {deleting ? 'Deleting...' : `Delete All ${pagination.total} Properties`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Colony Dialog */}
        <Dialog open={deleteColonyDialog} onOpenChange={setDeleteColonyDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-orange-600">
                <Trash2 className="w-5 h-5" />
                Delete Colony Properties
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Select Colony to Delete</Label>
                <Select value={selectedColony} onValueChange={setSelectedColony}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a colony" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((area) => (
                      <SelectItem key={area} value={area}>{area}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center space-x-3 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <input
                  type="checkbox"
                  id="keepSurveyed"
                  checked={keepSurveyed}
                  onChange={(e) => setKeepSurveyed(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <label htmlFor="keepSurveyed" className="text-sm">
                  <span className="font-medium text-yellow-800">Keep properties with surveys</span>
                  <p className="text-xs text-yellow-600">
                    {keepSurveyed ? "Properties with submitted surveys will NOT be deleted" : "⚠️ ALL properties including surveyed ones will be deleted"}
                  </p>
                </label>
              </div>
              
              <div className="bg-red-50 p-3 rounded-lg border border-red-200">
                <p className="text-sm text-red-700">
                  ⚠️ This will delete all properties in the selected colony{keepSurveyed ? ' (except surveyed ones)' : ''}.
                </p>
              </div>
            </div>
            
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setDeleteColonyDialog(false)}>Cancel</Button>
              <Button 
                variant="destructive"
                onClick={handleDeleteColony}
                disabled={!selectedColony || deletingColony}
              >
                {deletingColony ? 'Deleting...' : 'Delete Colony'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Duplicates Dialog */}
        <Dialog open={deleteDuplicatesDialog} onOpenChange={setDeleteDuplicatesDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-purple-600">
                <Users className="w-5 h-5" />
                Delete Duplicate Properties
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 mt-4">
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-700 font-medium">This will:</p>
                <ul className="text-sm text-blue-600 list-disc ml-5 mt-2 space-y-1">
                  <li>Find duplicate properties (same Property ID or same Owner+Mobile)</li>
                  <li><strong>KEEP</strong> properties that have survey submissions</li>
                  <li><strong>DELETE</strong> duplicate properties without surveys</li>
                </ul>
              </div>
              
              <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                <p className="text-sm text-green-700">
                  ✅ <strong>Surveyed properties are SAFE</strong> - they will not be deleted.
                </p>
              </div>
              
              {filters.area && (
                <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                  <p className="text-sm text-yellow-700">
                    📍 Only checking duplicates in: <strong>{filters.area}</strong>
                  </p>
                </div>
              )}
            </div>
            
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setDeleteDuplicatesDialog(false)}>Cancel</Button>
              <Button 
                className="bg-purple-600 hover:bg-purple-700"
                onClick={handleDeleteDuplicates}
                disabled={deletingDuplicates}
              >
                {deletingDuplicates ? 'Finding & Deleting...' : 'Delete Duplicates'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Unassign Dialog */}
        <Dialog open={unassignDialog} onOpenChange={(open) => {
          setUnassignDialog(open);
          if (!open) {
            setUnassignEmployeeId('');
            setUnassignArea('');
          }
        }}>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2 text-orange-600">
                <UserMinus className="w-5 h-5" />
                Unassign Properties
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {selectedProperties.length > 0 ? (
                <>
                  <p className="text-sm text-slate-600">
                    Unassign <strong>{selectedProperties.length}</strong> selected properties.
                  </p>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Unassign Specific Employee (optional)</label>
                    <Select
                      value={unassignEmployeeId}
                      onValueChange={setUnassignEmployeeId}
                    >
                      <SelectTrigger data-testid="unassign-employee-select">
                        <SelectValue placeholder="All Employees (Clear Assignment)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value=" ">All Employees (Clear Assignment)</SelectItem>
                        {employees.filter(e => e.role !== 'ADMIN').map(emp => (
                          <SelectItem key={emp.id} value={emp.id}>
                            {emp.name} ({emp.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">
                      Leave blank to remove all employee assignments from selected properties.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  {/* Option 1: Unassign by Area */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      Bulk Unassign by Area
                    </h4>
                    <p className="text-sm text-blue-700 mb-3">
                      Remove all employee assignments from an entire area.
                    </p>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Select Area *</label>
                      <Select value={unassignArea} onValueChange={setUnassignArea}>
                        <SelectTrigger className="border-blue-300">
                          <SelectValue placeholder="Select Area" />
                        </SelectTrigger>
                        <SelectContent>
                          {areas.map(a => (
                            <SelectItem key={a} value={a}>{a}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {unassignArea && (
                      <div className="mt-3 space-y-2">
                        <label className="text-sm font-medium">Remove Specific Employee (optional)</label>
                        <Select
                          value={unassignEmployeeId}
                          onValueChange={setUnassignEmployeeId}
                        >
                          <SelectTrigger className="border-blue-300">
                            <SelectValue placeholder="All Employees" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value=" ">All Employees</SelectItem>
                            {employees.filter(e => e.role !== 'ADMIN').map(emp => (
                              <SelectItem key={emp.id} value={emp.id}>
                                {emp.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-blue-600">
                          Leave blank to unassign all employees from this area.
                        </p>
                      </div>
                    )}
                    
                    {unassignArea && (
                      <Button 
                        onClick={handleBulkUnassignByArea}
                        className="w-full mt-3 bg-blue-600 hover:bg-blue-700"
                        disabled={unassigning || !unassignArea}
                      >
                        {unassigning ? 'Unassigning...' : `Unassign from ${unassignArea}`}
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-slate-200"></div>
                    <span className="text-xs text-slate-400">OR</span>
                    <div className="flex-1 h-px bg-slate-200"></div>
                  </div>

                  {/* Option 2: Unassign Employee from All */}
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <h4 className="font-semibold text-orange-800 mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Unassign Employee from All Properties
                    </h4>
                    <p className="text-sm text-orange-700 mb-3">
                      Remove an employee from ALL their assigned properties (across all areas).
                    </p>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-red-600">Select Employee *</label>
                      <Select
                        value={unassignEmployeeId}
                        onValueChange={(v) => {
                          setUnassignEmployeeId(v);
                          setUnassignArea(''); // Clear area when selecting employee
                        }}
                      >
                        <SelectTrigger data-testid="unassign-all-employee-select" className="border-orange-300">
                          <SelectValue placeholder="Select Employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.filter(e => e.role !== 'ADMIN').map(emp => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.name} ({emp.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {unassignEmployeeId && !unassignArea && (
                      <Button 
                        onClick={() => handleUnassignAllFromEmployee(unassignEmployeeId)}
                        className="w-full mt-3 bg-orange-600 hover:bg-orange-700"
                        disabled={unassigning || !unassignEmployeeId}
                      >
                        {unassigning ? 'Unassigning...' : 'Unassign from All Properties'}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>

            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => {
                setUnassignDialog(false);
                setUnassignEmployeeId('');
                setUnassignArea('');
              }}>
                {selectedProperties.length > 0 ? 'Cancel' : 'Close'}
              </Button>
              {selectedProperties.length > 0 && (
                <Button 
                  onClick={handleUnassign}
                  data-testid="confirm-unassign-btn"
                  className="bg-orange-600 hover:bg-orange-700"
                  disabled={unassigning}
                >
                  {unassigning ? 'Unassigning...' : `Unassign ${selectedProperties.length} Properties`}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Block Assign/Unassign Colonies Dialog */}
        <Dialog open={blockColonyDialog} onOpenChange={setBlockColonyDialog}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle data-testid="block-colony-dialog-title">
                {blockColonyMode === 'assign' ? 'Bulk Assign Colonies' : 'Bulk Unassign Colonies'}
              </DialogTitle>
              <DialogDescription>
                {blockColonyMode === 'assign'
                  ? 'Select colonies and surveyors to assign'
                  : 'Select colonies to unassign all surveyors'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold">Select Colonies ({selectedColonies.length} selected)</Label>
                <div className="max-h-40 overflow-y-auto border rounded-lg p-2 mt-1 space-y-1">
                  {allColonies.length === 0 ? (
                    <p className="text-sm text-slate-400 py-2 text-center">Loading colonies...</p>
                  ) : allColonies.map(colony => (
                    <label key={colony} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                      <Checkbox
                        checked={selectedColonies.includes(colony)}
                        onCheckedChange={() => toggleColonySelection(colony)}
                        data-testid={`colony-check-${colony}`}
                      />
                      <span className="text-sm">{colony}</span>
                    </label>
                  ))}
                </div>
              </div>

              {blockColonyMode === 'assign' && (
                <div>
                  <Label className="text-sm font-semibold">Select Surveyors ({blockColonyEmployees.length} selected)</Label>
                  <div className="max-h-40 overflow-y-auto border rounded-lg p-2 mt-1 space-y-1">
                    {employees.filter(e => e.role === 'SURVEYOR').map(emp => (
                      <label key={emp.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                        <Checkbox
                          checked={blockColonyEmployees.includes(emp.id)}
                          onCheckedChange={() => {
                            setBlockColonyEmployees(prev =>
                              prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id]
                            );
                          }}
                          data-testid={`block-emp-check-${emp.id}`}
                        />
                        <span className="text-sm">{emp.name} ({emp.mobile || emp.username})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setBlockColonyDialog(false)}>Cancel</Button>
              <Button
                onClick={handleBlockColonyAction}
                disabled={blockColonyLoading}
                className={blockColonyMode === 'assign' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
                data-testid="block-colony-submit-btn"
              >
                {blockColonyLoading ? 'Processing...' : blockColonyMode === 'assign' ? 'Assign' : 'Unassign'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
