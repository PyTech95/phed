import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Calendar as CalendarComponent } from '../../components/ui/calendar';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { 
  ClipboardCheck, MapPin, Camera, ChevronLeft, ChevronRight, 
  Eye, Check, X, Edit, User, Phone, Home, Hash, CreditCard, 
  Building, Users, FileText, Pen, Image as ImageIcon, Save,
  ExternalLink, Trash2, Plus, AlertTriangle, Lock, UserX, CheckCircle, Navigation,
  Download, Filter, ChevronDown, ChevronUp, Calendar, Search, CheckSquare, Loader2,
  XCircle, Clock
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

// Image compression function to reduce file size before upload
const compressImage = (file, maxSize = 1200, quality = 0.7) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      // Resize if needed
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
          console.log(`Compressed: ${(file.size/1024).toFixed(0)}KB → ${(compressedFile.size/1024).toFixed(0)}KB`);
          resolve(compressedFile);
        } else {
          resolve(file);
        }
      }, 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
};

const RELATION_OPTIONS = [
  'Self', 'Family Member', 'Kirayedar', 'Padosi', 'Worker', 'Other'
];

export default function Submissions() {
  const { token, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [detailDialog, setDetailDialog] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [colonyFilter, setColonyFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');  // Date range end
  const [searchFilter, setSearchFilter] = useState('');  // Search by serial, property ID, owner name
  const [debouncedSearch, setDebouncedSearch] = useState('');  // Debounced search
  const [specialConditionFilter, setSpecialConditionFilter] = useState('');
  const [selfCertifiedFilter, setSelfCertifiedFilter] = useState('');
  const [photoStatusFilter, setPhotoStatusFilter] = useState('');
  const [duplicateFilter, setDuplicateFilter] = useState('');
  const [employees, setEmployees] = useState([]);
  const [colonies, setColonies] = useState([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editData, setEditData] = useState({});
  const [editPropertyData, setEditPropertyData] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editPhotos, setEditPhotos] = useState([]);
  const [newPhotoFile, setNewPhotoFile] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);
  
  // Bulk selection states
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkApproving, setBulkApproving] = useState(false);

  // Check permissions based on role AND custom permissions
  const canEdit = ['ADMIN', 'SUPERVISOR', 'MC_OFFICER'].includes(user?.role) || user?.permissions?.can_edit_submissions;
  const canApproveReject = ['ADMIN'].includes(user?.role) || user?.permissions?.can_approve_reject;
  const canExport = ['ADMIN'].includes(user?.role) || user?.permissions?.can_export;

  const employeeIdFilter = searchParams.get('employee_id') || '';

  useEffect(() => {
    fetchFilters();
  }, []);

  // Debounce search input - wait 500ms after typing stops
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchFilter), 500);
    return () => clearTimeout(timer);
  }, [searchFilter]);

  useEffect(() => {
    fetchSubmissions();
  }, [pagination.page, statusFilter, employeeFilter, colonyFilter, dateFilter, dateToFilter, employeeIdFilter, debouncedSearch, specialConditionFilter, selfCertifiedFilter, photoStatusFilter, duplicateFilter]);

  const fetchFilters = async () => {
    try {
      const [empRes, areasRes] = await Promise.all([
        axios.get(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/admin/wards`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { wards: [] } }))
      ]);
      setEmployees(empRes.data.filter(u => u.role !== 'ADMIN'));
      setColonies(areasRes.data.wards || []);
    } catch (error) {
      console.error('Failed to fetch filters');
    }
  };

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', pagination.page);
      params.append('limit', 50);
      if (statusFilter) params.append('status', statusFilter);
      if (employeeIdFilter || employeeFilter) params.append('employee_id', employeeIdFilter || employeeFilter);
      if (colonyFilter) params.append('colony', colonyFilter);
      if (dateFilter) params.append('date_from', dateFilter);
      if (dateToFilter) params.append('date_to', dateToFilter);
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (specialConditionFilter) params.append('special_condition', specialConditionFilter);
      if (selfCertifiedFilter) params.append('self_certified', selfCertifiedFilter);
      if (photoStatusFilter) params.append('photo_status', photoStatusFilter);
      if (duplicateFilter) params.append('duplicate_filter', duplicateFilter);

      const response = await axios.get(`${API_URL}/admin/submissions?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setSubmissions(response.data.submissions);
      setPagination(prev => ({
        ...prev,
        pages: response.data.pages,
        total: response.data.total
      }));
    } catch (error) {
      toast.error('Failed to load submissions');
    } finally {
      setLoading(false);
    }
  };

  // Export submissions to Excel
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (employeeIdFilter || employeeFilter) params.append('employee_id', employeeIdFilter || employeeFilter);
      if (colonyFilter) params.append('colony', colonyFilter);
      if (dateFilter) params.append('date_from', dateFilter);
      if (dateToFilter) params.append('date_to', dateToFilter);
      if (searchFilter) params.append('search', searchFilter);
      if (specialConditionFilter) params.append('special_condition', specialConditionFilter);
      if (selfCertifiedFilter) params.append('self_certified', selfCertifiedFilter);
      if (photoStatusFilter) params.append('photo_status', photoStatusFilter);
      if (duplicateFilter) params.append('duplicate_filter', duplicateFilter);

      const response = await axios.get(`${API_URL}/admin/submissions/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });
      
      // Create download link with correct MIME type for xlsx
      const blob = new Blob([response.data], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = `submissions_${new Date().toISOString().split('T')[0]}.xlsx`;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      toast.success('Export downloaded successfully');
    } catch (error) {
      toast.error('Failed to export submissions');
    } finally {
      setExporting(false);
    }
  };

  // Clear all filters
  const clearAllFilters = () => {
    setStatusFilter('');
    setEmployeeFilter('');
    setColonyFilter('');
    setDateFilter('');
    setDateToFilter('');
    setSearchFilter('');
    setSpecialConditionFilter('');
    setSelfCertifiedFilter('');
    setPhotoStatusFilter('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Count active filters
  const activeFilterCount = [
    statusFilter, employeeFilter, colonyFilter, dateFilter, dateToFilter,
    searchFilter, specialConditionFilter, selfCertifiedFilter, photoStatusFilter
  ].filter(f => f && f.trim()).length;

  const viewDetail = (submission) => {
    setSelectedSubmission(submission);
    setDetailDialog(true);
  };

  const handleApprove = async (submissionId) => {
    try {
      await axios.post(`${API_URL}/admin/submissions/approve`, {
        submission_id: submissionId,
        action: 'APPROVE'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Submission approved');
      fetchSubmissions();
      setDetailDialog(false);
    } catch (error) {
      toast.error('Failed to approve submission');
    }
  };

  const openRejectDialog = (submission) => {
    setSelectedSubmission(submission);
    setRejectRemarks('');
    setRejectDialog(true);
  };

  const handleReject = async () => {
    if (!rejectRemarks.trim()) {
      toast.error('Remarks are required for rejection');
      return;
    }

    try {
      await axios.post(`${API_URL}/admin/submissions/approve`, {
        submission_id: selectedSubmission.id,
        action: 'REJECT',
        remarks: rejectRemarks
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Submission rejected');
      fetchSubmissions();
      setRejectDialog(false);
      setDetailDialog(false);
    } catch (error) {
      toast.error('Failed to reject submission');
    }
  };

  // Bulk approve selected submissions
  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) {
      toast.error('Please select submissions to approve');
      return;
    }
    
    setBulkApproving(true);
    let successCount = 0;
    let failCount = 0;
    
    try {
      for (const id of selectedIds) {
        try {
          await axios.post(`${API_URL}/admin/submissions/approve`, {
            submission_id: id,
            action: 'APPROVE',
            remarks: ''
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          successCount++;
        } catch (err) {
          failCount++;
        }
      }
      
      if (successCount > 0) {
        toast.success(`Approved ${successCount} submissions${failCount > 0 ? `, ${failCount} failed` : ''}`);
      }
      setSelectedIds([]);
      fetchSubmissions();
    } catch (error) {
      toast.error('Bulk approve failed');
    } finally {
      setBulkApproving(false);
    }
  };

  // Bulk reject selected submissions
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);

  const handleBulkReject = async () => {
    if (selectedIds.length === 0) return;
    const reason = window.prompt('Rejection reason (required):');
    if (!reason || !reason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    setBulkRejecting(true);
    let successCount = 0;
    let failCount = 0;
    try {
      for (const id of selectedIds) {
        try {
          await axios.post(`${API_URL}/admin/submissions/approve`, {
            submission_id: id,
            action: 'REJECT',
            remarks: reason.trim()
          }, { headers: { Authorization: `Bearer ${token}` } });
          successCount++;
        } catch (err) { failCount++; }
      }
      if (successCount > 0) toast.success(`Rejected ${successCount} submissions${failCount > 0 ? `, ${failCount} failed` : ''}`);
      setSelectedIds([]);
      fetchSubmissions();
    } catch (error) { toast.error('Bulk reject failed'); }
    finally { setBulkRejecting(false); }
  };

  const handleBulkPendingReview = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Set ${selectedIds.length} submissions to Pending Review?`)) return;
    setBulkPending(true);
    let successCount = 0;
    let failCount = 0;
    try {
      for (const id of selectedIds) {
        try {
          await axios.post(`${API_URL}/admin/submissions/approve`, {
            submission_id: id,
            action: 'PENDING',
            remarks: ''
          }, { headers: { Authorization: `Bearer ${token}` } });
          successCount++;
        } catch (err) { failCount++; }
      }
      if (successCount > 0) toast.success(`Set ${successCount} submissions to Pending${failCount > 0 ? `, ${failCount} failed` : ''}`);
      setSelectedIds([]);
      fetchSubmissions();
    } catch (error) { toast.error('Bulk pending failed'); }
    finally { setBulkPending(false); }
  };

  // Approve ALL submissions matching current filters
  const [approvingAll, setApprovingAll] = useState(false);
  const handleApproveAll = async () => {
    if (!window.confirm(`Are you sure you want to APPROVE ALL ${pagination.total} submissions? This action cannot be undone.`)) return;
    setApprovingAll(true);
    try {
      const body = {};
      if (statusFilter && statusFilter.trim()) body.status = statusFilter;
      if (colonyFilter && colonyFilter.trim()) body.colony = colonyFilter;
      if (employeeFilter && employeeFilter.trim()) body.employee_id = employeeFilter;
      const res = await axios.post(`${API_URL}/admin/submissions/approve-all`, body, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(res.data.message || `Approved all submissions`);
      setSelectedIds([]);
      fetchSubmissions();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Approve all failed');
    } finally {
      setApprovingAll(false);
    }
  };

  // Toggle single selection
  const toggleSelection = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // Select all pending submissions
  const selectAllPending = () => {
    const pendingIds = submissions
      .filter(s => s.status === 'Pending' || s.status === 'Completed' || !s.status)
      .map(s => s.id);
    setSelectedIds(pendingIds);
  };

  // Select all visible submissions
  const selectAll = () => {
    const allIds = submissions.map(s => s.id);
    setSelectedIds(allIds);
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedIds([]);
  };

  const openEditDialog = (submission) => {
    setSelectedSubmission(submission);
    // Submission data - matching Survey.js fields
    setEditData({
      receiver_name: submission.receiver_name || '',
      receiver_mobile: submission.receiver_mobile || '',
      relation: submission.relation || '',
      correct_colony_name: submission.correct_colony_name || '',
      remarks: submission.remarks || '',
      self_satisfied: submission.self_satisfied || '',
      latitude: submission.latitude || '',
      longitude: submission.longitude || '',
      special_condition: submission.special_condition || '',
      house_status: submission.house_status || '',
      property_use: submission.property_use || '',
      property_use_remarks: submission.property_use_remarks || ''
    });
    // Property data
    setEditPropertyData({
      property_id: submission.property_id || '',
      owner_name: submission.property_owner_name || '',
      mobile: submission.property_mobile || '',
      address: submission.property_address || '',
      amount: submission.property_amount || '',
      ward: submission.property_ward || ''
    });
    // Photos - filter duplicates
    const uniquePhotos = submission.photos?.filter((photo, index, self) => 
      index === self.findIndex(p => p.file_url === photo.file_url)
    ) || [];
    setEditPhotos(uniquePhotos);
    setEditDialog(true);
  };

  const handleEdit = async () => {
    setSavingEdit(true);
    try {
      // Update submission with new data and updated photos
      const updateData = {
        ...editData,
        photos: editPhotos
      };
      
      await axios.put(`${API_URL}/admin/submissions/${selectedSubmission.id}`, updateData, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      toast.success('Survey submission updated successfully');
      fetchSubmissions();
      setEditDialog(false);
    } catch (error) {
      console.error('Edit error:', error);
      toast.error('Failed to save changes');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeletePhoto = (photoIndex) => {
    const newPhotos = editPhotos.filter((_, idx) => idx !== photoIndex);
    setEditPhotos(newPhotos);
    toast.success('Photo removed. Click Save to apply changes.');
  };

  const handleAddPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingPhoto(true);
    try {
      // Compress image before upload
      const compressedFile = await compressImage(file, 1200, 0.7);
      
      const formData = new FormData();
      formData.append('file', compressedFile);
      formData.append('submission_id', selectedSubmission.id);
      formData.append('photo_type', 'HOUSE');
      
      const response = await axios.post(`${API_URL}/admin/submissions/upload-photo`, formData, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      
      // Add new photo to list
      const newPhoto = {
        file_url: response.data.file_url,
        file_id: response.data.file_id,
        photo_type: 'HOUSE'
      };
      setEditPhotos([...editPhotos, newPhoto]);
      toast.success('Photo added successfully');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = '';
      }
    }
  };

  const getStatusBadge = (status) => {
    const statusColors = {
      'Pending': 'bg-amber-100 text-amber-700',
      'Approved': 'bg-emerald-100 text-emerald-700',
      'Rejected': 'bg-red-100 text-red-700'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColors[status] || 'bg-slate-100 text-slate-700'}`}>
        {status || 'Pending'}
      </span>
    );
  };

  return (
    <AdminLayout title="Survey Submissions">
      <div data-testid="admin-submissions" className="space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            {/* Basic Filters Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4 items-end">
              {/* Search Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Search</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <Input
                    placeholder="Serial, Property ID, Name, Surveyor..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="h-10 pl-9"
                  />
                </div>
              </div>
              
              {/* Employee Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Employee</label>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Employees" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=" ">All Employees</SelectItem>
                    {employees.map(emp => (
                      <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Status Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=" ">All Status</SelectItem>
                    <SelectItem value="Pending">Pending Review</SelectItem>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Colony Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Colony</label>
                <Select value={colonyFilter} onValueChange={setColonyFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Colonies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=" ">All Colonies</SelectItem>
                    {colonies.map(colony => (
                      <SelectItem key={colony} value={colony}>{colony}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Special Condition Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Special Condition</label>
                <Select value={specialConditionFilter} onValueChange={setSpecialConditionFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Conditions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=" ">All Conditions</SelectItem>
                    <SelectItem value="property_locked">Property Locked</SelectItem>
                    <SelectItem value="owner_denied">Owner Denied</SelectItem>
                    <SelectItem value="vacant_plot">Vacant Plot</SelectItem>
                    <SelectItem value="wrong_location">Wrong Location</SelectItem>
                    <SelectItem value="normal">Normal Survey</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Date From Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">From Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={`w-full h-10 justify-start text-left font-normal ${!dateFilter ? 'text-muted-foreground' : ''}`}>
                      <Calendar className="mr-2 h-4 w-4" />
                      {dateFilter ? format(new Date(dateFilter + 'T00:00:00'), 'dd/MM/yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={dateFilter ? new Date(dateFilter + 'T00:00:00') : undefined}
                      onSelect={(date) => setDateFilter(date ? format(date, 'yyyy-MM-dd') : '')}
                    />
                    {dateFilter && (
                      <div className="p-2 border-t">
                        <Button variant="ghost" size="sm" className="w-full text-red-500" onClick={() => setDateFilter('')}>
                          Clear
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              
              {/* Date To Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">To Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={`w-full h-10 justify-start text-left font-normal ${!dateToFilter ? 'text-muted-foreground' : ''}`}>
                      <Calendar className="mr-2 h-4 w-4" />
                      {dateToFilter ? format(new Date(dateToFilter + 'T00:00:00'), 'dd/MM/yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={dateToFilter ? new Date(dateToFilter + 'T00:00:00') : undefined}
                      onSelect={(date) => setDateToFilter(date ? format(date, 'yyyy-MM-dd') : '')}
                    />
                    {dateToFilter && (
                      <div className="p-2 border-t">
                        <Button variant="ghost" size="sm" className="w-full text-red-500" onClick={() => setDateToFilter('')}>
                          Clear
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Advanced Filters Toggle - Admin Only */}
            <div className="mt-4 flex items-center justify-between">
              {canApproveReject ? (
              <button
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
              >
                <Filter className="w-4 h-4" />
                Advanced Filters
                {showAdvancedFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {activeFilterCount > 0 && (
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">
                    {activeFilterCount} active
                  </span>
                )}
              </button>
              ) : <div />}
              
              <div className="flex items-center gap-3">
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                    <X className="w-4 h-4 mr-1" />
                    Clear All
                  </Button>
                )}
                <span className="text-sm text-slate-500">
                  Total: <span className="font-semibold">{pagination.total}</span> submissions
                </span>
                {canExport && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleExport}
                  disabled={exporting || pagination.total === 0}
                >
                  {exporting ? (
                    <>Exporting...</>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-1" />
                      Export Excel
                    </>
                  )}
                </Button>
                )}
              </div>
            </div>

            {/* Advanced Filters Panel */}
            {showAdvancedFilters && (
              <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Self Certified Filter */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Self Certified</label>
                  <Select value={selfCertifiedFilter} onValueChange={setSelfCertifiedFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value=" ">All</SelectItem>
                      <SelectItem value="yes">Self Certified</SelectItem>
                      <SelectItem value="no">Not Self Certified</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Photo Status Filter */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Photo Status</label>
                  <Select value={photoStatusFilter} onValueChange={setPhotoStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value=" ">All</SelectItem>
                      <SelectItem value="with_photos">With Photos</SelectItem>
                      <SelectItem value="without_photos">Without Photos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Duplicate Filters */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Duplicate Check</label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={duplicateFilter === 'same_mobile' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDuplicateFilter(duplicateFilter === 'same_mobile' ? '' : 'same_mobile')}
                      className="text-xs"
                    >
                      Same Mobile
                    </Button>
                    <Button
                      variant={duplicateFilter === 'same_owner' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDuplicateFilter(duplicateFilter === 'same_owner' ? '' : 'same_owner')}
                      className="text-xs"
                    >
                      Same Owner
                    </Button>
                  </div>
                </div>

                {/* Quick Status Filters */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Quick Filters</label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={specialConditionFilter === 'property_locked' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSpecialConditionFilter(specialConditionFilter === 'property_locked' ? ' ' : 'property_locked')}
                      className="text-xs"
                    >
                      Locked
                    </Button>
                    <Button
                      variant={specialConditionFilter === 'owner_denied' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSpecialConditionFilter(specialConditionFilter === 'owner_denied' ? ' ' : 'owner_denied')}
                      className="text-xs"
                    >
                      Denied
                    </Button>
                    <Button
                      variant={specialConditionFilter === 'vacant_plot' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSpecialConditionFilter(specialConditionFilter === 'vacant_plot' ? ' ' : 'vacant_plot')}
                      className="text-xs"
                    >
                      Vacant
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-pulse-slow text-slate-500">Loading...</div>
          </div>
        ) : submissions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ClipboardCheck className="w-12 h-12 mx-auto text-slate-300 mb-4" />
              <h3 className="font-heading font-semibold text-slate-900 mb-2">No submissions yet</h3>
              <p className="text-slate-500">Survey submissions from employees will appear here</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Bulk Action Bar */}
            {canApproveReject && (
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAll}
                  className="h-8"
                  data-testid="select-all-btn"
                >
                  <CheckSquare className="w-4 h-4 mr-1" />
                  Select All
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-700 hover:bg-blue-800 text-white h-8"
                  onClick={handleApproveAll}
                  disabled={approvingAll || pagination.total === 0}
                  data-testid="approve-all-btn"
                >
                  {approvingAll ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-1" />
                  )}
                  Approve All ({pagination.total})
                </Button>
                {selectedIds.length > 0 && (
                  <>
                    <span className="text-sm text-slate-600 font-medium">
                      {selectedIds.length} selected
                    </span>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 h-8"
                      onClick={handleBulkApprove}
                      disabled={bulkApproving || bulkRejecting || bulkPending}
                      data-testid="bulk-approve-btn"
                    >
                      {bulkApproving ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4 mr-1" />
                      )}
                      Approve {selectedIds.length}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8"
                      onClick={handleBulkReject}
                      disabled={bulkApproving || bulkRejecting || bulkPending}
                      data-testid="bulk-reject-btn"
                    >
                      {bulkRejecting ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <XCircle className="w-4 h-4 mr-1" />
                      )}
                      Reject {selectedIds.length}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-amber-400 text-amber-700 hover:bg-amber-50"
                      onClick={handleBulkPendingReview}
                      disabled={bulkApproving || bulkRejecting || bulkPending}
                      data-testid="bulk-pending-btn"
                    >
                      {bulkPending ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Clock className="w-4 h-4 mr-1" />
                      )}
                      Pending Review
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearSelection}
                      className="h-8 text-slate-500"
                    >
                      Clear
                    </Button>
                  </>
                )}
              </div>
            )}

            <Card className="shadow-lg border-0">
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      {canApproveReject && (
                        <th className="w-10 px-2 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.length > 0 && selectedIds.length === submissions.length}
                            onChange={(e) => e.target.checked ? selectAll() : clearSelection()}
                            className="w-4 h-4 rounded border-slate-300"
                          />
                        </th>
                      )}
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Sr. No</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Property ID</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Owner</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Colony</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Receiver</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Relation</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Condition</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Employee</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Submit Date</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {submissions.map((sub) => (
                      <tr key={sub.id} className={`hover:bg-slate-50 transition-colors text-sm ${selectedIds.includes(sub.id) ? 'bg-emerald-50' : ''}`}>
                        {canApproveReject && (
                          <td className="px-2 py-3">
                            {(sub.status === 'Pending' || sub.status === 'Completed' || sub.status === 'Approved' || sub.status === 'Rejected' || !sub.status) && (
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(sub.id)}
                                onChange={() => toggleSelection(sub.id)}
                                className="w-4 h-4 rounded border-slate-300"
                              />
                            )}
                          </td>
                        )}
                        <td className="px-3 py-3 font-bold text-red-600">{sub.bill_sr_no || sub.serial_number || '-'}</td>
                        <td className="px-3 py-3 font-mono font-medium text-blue-600">{sub.property_id}</td>
                        <td className="px-3 py-3">{sub.property_owner_name || '-'}</td>
                        <td className="px-3 py-3 text-xs">{sub.colony || sub.property_ward || '-'}</td>
                        <td className="px-3 py-3">{sub.receiver_name || '-'}</td>
                        <td className="px-3 py-3 text-xs">{sub.relation || '-'}</td>
                        <td className="px-3 py-3">
                          {sub.special_condition === 'property_locked' || sub.special_condition === 'house_locked' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-medium">
                              <Lock className="w-3 h-3" /> Locked
                            </span>
                          ) : sub.special_condition === 'owner_denied' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-medium">
                              <UserX className="w-3 h-3" /> Denied
                            </span>
                          ) : sub.special_condition === 'vacant_plot' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-medium">
                              <MapPin className="w-3 h-3" /> Vacant
                            </span>
                          ) : sub.special_condition === 'wrong_location' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-medium">
                              <Navigation className="w-3 h-3" /> Wrong Loc
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs">{sub.employee_name}</td>
                        <td className="px-3 py-3 text-xs text-slate-500">
                          {new Date(sub.submitted_at).toLocaleDateString('en-IN')} {new Date(sub.submitted_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-3 py-3">{getStatusBadge(sub.status)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => viewDetail(sub)}
                              title="View Details"
                              className="h-8 w-8 p-0"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditDialog(sub)}
                                title="Edit"
                                className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
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
                Showing {((pagination.page - 1) * 20) + 1} to {Math.min(pagination.page * 20, pagination.total)} of {pagination.total}
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

        {/* Detail View Dialog */}
        <Dialog open={detailDialog} onOpenChange={setDetailDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center justify-between">
                <span>Submission Details - {selectedSubmission?.property_id}</span>
                {selectedSubmission && getStatusBadge(selectedSubmission.status)}
              </DialogTitle>
            </DialogHeader>

            {selectedSubmission && (
              <div className="space-y-3">
                {/* Compact Property Info Header */}
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-xs text-blue-600">Property ID:</span>
                    <span className="font-bold text-blue-700 ml-1">{selectedSubmission.property_id || '-'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Sr:</span>
                    <span className="font-bold text-red-600 ml-1">{selectedSubmission.bill_sr_no || selectedSubmission.serial_number || '-'}</span>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    selectedSubmission.status === 'Pending' ? 'bg-amber-100 text-amber-700' : 
                    selectedSubmission.status === 'Rejected' ? 'bg-red-100 text-red-700' : 
                    'bg-green-100 text-green-700'
                  }`}>
                    {selectedSubmission.status}
                  </span>
                </div>

                {/* Property Details - Compact 3-column grid */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">Owner</div>
                    <div className="font-semibold truncate">{selectedSubmission.property_owner_name || '-'}</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">Mobile</div>
                    <div className="font-mono">{selectedSubmission.property_mobile || '-'}</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">Colony</div>
                    <div className="font-medium truncate">{selectedSubmission.colony || selectedSubmission.property_ward || '-'}</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">Area</div>
                    <div className="font-medium">{selectedSubmission.total_area || '-'}</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">Category</div>
                    <div className="font-medium">{selectedSubmission.category || 'Residential'}</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-gray-500">Amount</div>
                    <div className="font-bold text-red-600">₹{selectedSubmission.property_amount || '0'}</div>
                  </div>
                </div>

                {/* Property Address */}
                {selectedSubmission.property_address && (
                  <div className="bg-gray-50 rounded p-2 text-xs">
                    <span className="text-gray-500">Address: </span>
                    <span className="text-gray-800">{selectedSubmission.property_address}</span>
                  </div>
                )}

                {/* Survey Details - Compact */}
                <div className="border-t pt-2">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Survey Details</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-gray-500">Receiver</div>
                      <div className="font-medium">{selectedSubmission.receiver_name || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-gray-500">Receiver Mobile</div>
                      <div className="font-mono">{selectedSubmission.receiver_mobile || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-gray-500">Relation</div>
                      <div className="font-medium">{selectedSubmission.relation || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-gray-500">Self Cert</div>
                      <div className="font-medium">{selectedSubmission.self_cert_status || selectedSubmission.self_satisfied || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-gray-500">Employee</div>
                      <div className="font-medium">{selectedSubmission.employee_name}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-gray-500">Date</div>
                      <div className="font-medium">{new Date(selectedSubmission.submitted_at).toLocaleDateString('en-IN')}</div>
                    </div>
                  </div>
                </div>

                {/* GPS Location - Original + Survey with distance */}
                {(selectedSubmission.latitude || selectedSubmission.survey_latitude) && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        <span className="text-gray-500">Orig:</span>
                        <span className="font-mono text-blue-700">
                          {selectedSubmission.property_latitude?.toFixed(4) || '-'},{selectedSubmission.property_longitude?.toFixed(4) || '-'}
                        </span>
                      </div>
                      <span className="text-gray-400">&rarr;</span>
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span className="text-gray-500">Survey:</span>
                        <span className="font-mono text-emerald-700">
                          {(selectedSubmission.latitude || selectedSubmission.survey_latitude)?.toFixed(4)},{(selectedSubmission.longitude || selectedSubmission.survey_longitude)?.toFixed(4)}
                        </span>
                      </div>
                      {selectedSubmission.property_latitude && selectedSubmission.latitude && (
                        <span className="px-1.5 py-0.5 bg-amber-100 rounded text-xs font-semibold text-amber-700">
                          {(() => {
                            const R = 6371000;
                            const lat1 = (selectedSubmission.property_latitude) * Math.PI / 180;
                            const lat2 = (selectedSubmission.latitude || selectedSubmission.survey_latitude) * Math.PI / 180;
                            const dLat = ((selectedSubmission.latitude || selectedSubmission.survey_latitude) - selectedSubmission.property_latitude) * Math.PI / 180;
                            const dLon = ((selectedSubmission.longitude || selectedSubmission.survey_longitude) - selectedSubmission.property_longitude) * Math.PI / 180;
                            const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) * Math.sin(dLon/2);
                            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                            const d = R * c;
                            return d < 1000 ? `${Math.round(d)}m` : `${(d/1000).toFixed(1)}km`;
                          })()}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] border-blue-300 text-blue-700 ml-auto"
                        onClick={() => window.open(`https://www.google.com/maps?q=${selectedSubmission.latitude || selectedSubmission.survey_latitude},${selectedSubmission.longitude || selectedSubmission.survey_longitude}`, '_blank')}
                      >
                        <Navigation className="w-3 h-3 mr-1" />
                        Map
                      </Button>
                    </div>
                  </div>
                )}

                {/* Special Condition - Compact */}
                {selectedSubmission.special_condition && (
                  <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs flex items-center gap-2">
                    <span className="text-amber-600">Condition:</span>
                    <span className="font-semibold text-amber-800">
                      {selectedSubmission.special_condition === 'property_locked' ? '🔒 Property Locked' : 
                       selectedSubmission.special_condition === 'owner_denied' ? '❌ Owner Denied' : 
                       selectedSubmission.special_condition === 'vacant_plot' ? '🏗️ Vacant Plot' :
                       selectedSubmission.special_condition === 'wrong_location' ? '📍 Property ID Wrong Location' :
                       selectedSubmission.special_condition}
                    </span>
                  </div>
                )}

                {/* Property Status */}
                {selectedSubmission.house_status && (
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center gap-2">
                    <span className="text-slate-600">Property Status:</span>
                    <span className={`font-semibold px-2 py-0.5 rounded ${
                      selectedSubmission.house_status === 'kachha' ? 'bg-orange-100 text-orange-700' :
                      selectedSubmission.house_status === 'pakka' ? 'bg-green-100 text-green-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {selectedSubmission.house_status === 'kachha' ? '🏠 Kachha' : 
                       selectedSubmission.house_status === 'pakka' ? '🏢 Pakka' : 
                       selectedSubmission.house_status === 'vacant_plot' ? '🏗️ Vacant Plot' :
                       selectedSubmission.house_status}
                    </span>
                  </div>
                )}

                {/* Property Current Use */}
                {selectedSubmission.property_use && (
                  <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs flex items-center gap-2">
                    <span className="text-indigo-600">Property Use:</span>
                    <span className={`font-semibold px-2 py-0.5 rounded ${
                      selectedSubmission.property_use === 'residential' ? 'bg-indigo-100 text-indigo-700' :
                      selectedSubmission.property_use === 'commercial' ? 'bg-purple-100 text-purple-700' :
                      selectedSubmission.property_use === 'mix_use' ? 'bg-teal-100 text-teal-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {selectedSubmission.property_use === 'residential' ? '🏠 Residential' : 
                       selectedSubmission.property_use === 'commercial' ? '🏢 Commercial' : 
                       selectedSubmission.property_use === 'mix_use' ? '🏘️ Mix Use' :
                       `📝 Other: ${selectedSubmission.property_use_remarks || ''}`}
                    </span>
                  </div>
                )}

                {/* Remarks - Compact (hide system-generated auto-complete remarks) */}
                {selectedSubmission.remarks && !selectedSubmission.remarks.toLowerCase().includes('auto-complete') && !selectedSubmission.remarks.toLowerCase().includes('auto complete') && (
                  <div className="bg-gray-50 rounded p-2 text-xs">
                    <span className="text-gray-500">Remarks:</span>
                    <span className="text-gray-800 ml-1">{selectedSubmission.remarks}</span>
                  </div>
                )}

                {/* Review Remarks - only show for Rejected status with actual rejection remarks */}
                {selectedSubmission.review_remarks && selectedSubmission.status === 'Rejected' && (
                  <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs">
                    <span className="text-red-600">Rejection Remarks:</span>
                    <span className="text-red-800 ml-1">{selectedSubmission.review_remarks}</span>
                  </div>
                )}

                {/* Old Property Photo - From Excel Upload */}
                {selectedSubmission.property_photo_url && (
                  <div className="border-2 border-amber-200 rounded-lg p-2 bg-amber-50">
                    <div className="text-xs font-semibold text-amber-700 mb-2">OLD Property Photo (Reference)</div>
                    <img
                      src={selectedSubmission.property_photo_url}
                      alt="Old Property"
                      className="w-full h-32 object-cover rounded cursor-pointer hover:opacity-90"
                      onClick={() => window.open(selectedSubmission.property_photo_url, '_blank')}
                      onError={(e) => { 
                        e.target.style.display = 'none'; 
                        e.target.nextElementSibling && (e.target.nextElementSibling.style.display = 'block');
                      }}
                    />
                    <a 
                      href={selectedSubmission.property_photo_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{display: 'none'}}
                      className="block text-xs text-blue-600 underline break-all bg-blue-50 p-2 rounded"
                    >
                      View Old Photo (external link)
                    </a>
                  </div>
                )}

                {/* Photos - Smaller thumbnails */}
                <div>
                  <div className="text-xs font-semibold text-emerald-700 mb-2">Survey Photos</div>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedSubmission.photos?.map((photo, idx) => {
                      // Handle all photo formats: dict with file_url, dict with url, plain string
                      let url = '';
                      let type = 'PHOTO';
                      if (typeof photo === 'string') {
                        url = photo;
                      } else if (typeof photo === 'object' && photo) {
                        url = photo.file_url || photo.url || photo.path || '';
                        type = photo.photo_type || 'PHOTO';
                      }
                      if (!url) return null;
                      const isExternal = url.startsWith('http');
                      const photoSrc = isExternal ? url : `${process.env.REACT_APP_BACKEND_URL}${url}`;
                      return (
                        <div key={idx} className="relative group">
                          <img
                            src={photoSrc}
                            alt={type}
                            className="w-full h-24 object-cover rounded cursor-pointer hover:opacity-90"
                            onClick={() => window.open(photoSrc, '_blank')}
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                          <span className={`absolute top-1 left-1 px-1 py-0.5 rounded text-xs font-semibold ${
                            type === 'HOUSE' ? 'bg-blue-100 text-blue-700' :
                            type === 'RECEIVER' ? 'bg-green-100 text-green-700' :
                            type === 'GATE' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {type === 'HOUSE' ? 'PROP' : type === 'RECEIVER' ? 'RECV' : type}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Signature - Smaller */}
                {selectedSubmission.signature_url && (
                  <div>
                    <label className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-3 block">Property Holder Signature</label>
                    <div className="border rounded-lg bg-white p-4">
                      <img
                        src={`${process.env.REACT_APP_BACKEND_URL}${selectedSubmission.signature_url}`}
                        alt="Signature"
                        className="w-full h-24 object-contain"
                      />
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t">
                  {canEdit && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDetailDialog(false);
                        openEditDialog(selectedSubmission);
                      }}
                      className="flex-1"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Details
                    </Button>
                  )}
                  {canApproveReject && (
                    <div className="flex gap-2">
                      {selectedSubmission.status !== 'Approved' && (
                        <Button
                          onClick={() => handleApprove(selectedSubmission.id)}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                        >
                          <Check className="w-4 h-4 mr-2" />
                          Approve
                        </Button>
                      )}
                      {selectedSubmission.status !== 'Rejected' && (
                        <Button
                          onClick={() => openRejectDialog(selectedSubmission)}
                          variant="destructive"
                          className="flex-1"
                        >
                          <X className="w-4 h-4 mr-2" />
                          Reject
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Reject Dialog */}
        <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-red-600">Reject Submission</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-slate-600">Please provide a reason for rejection (mandatory):</p>
              <Textarea
                value={rejectRemarks}
                onChange={(e) => setRejectRemarks(e.target.value)}
                placeholder="Enter rejection remarks..."
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectDialog(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleReject}>
                <X className="w-4 h-4 mr-2" />
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Full Edit Dialog */}
        <Dialog open={editDialog} onOpenChange={setEditDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Edit className="w-5 h-5 text-blue-600" />
                  Edit Submission - {selectedSubmission?.property_id}
                </span>
                {selectedSubmission && getStatusBadge(selectedSubmission.status)}
              </DialogTitle>
            </DialogHeader>

            {selectedSubmission && (
              <div className="space-y-6">
                {/* Property Details Section - READ ONLY */}
                <Card className="border-slate-200 bg-slate-50/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between text-slate-600">
                      <span className="flex items-center gap-2">
                        <Home className="w-4 h-4" />
                        PROPERTY DETAILS (Excel Data - Read Only)
                      </span>
                      <span className="text-xs font-normal bg-slate-200 text-slate-600 px-2 py-1 rounded">Cannot Edit</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label className="text-xs text-slate-500">Serial Number</Label>
                        <p className="font-mono font-medium text-slate-800">
                          {selectedSubmission.property_serial_na ? (
                            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs">N/A</span>
                          ) : (
                            selectedSubmission.property_serial_number || '-'
                          )}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Property ID</Label>
                        <p className="font-mono font-medium text-slate-800">{selectedSubmission.property_id || '-'}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Owner Name</Label>
                        <p className="font-medium text-slate-800">{selectedSubmission.property_owner_name || '-'}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Mobile</Label>
                        <p className="font-mono text-slate-800">{selectedSubmission.property_mobile || '-'}</p>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs text-slate-500">Address</Label>
                        <p className="text-slate-800">{selectedSubmission.property_address || '-'}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Amount</Label>
                        <p className="font-mono font-semibold text-emerald-700">₹{selectedSubmission.property_amount || '-'}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Special Conditions - same as Survey Form */}
                {(selectedSubmission.special_condition || selectedSubmission.self_certified !== undefined) && (
                  <Card className="border-blue-200 bg-blue-50/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-blue-700">
                        <AlertTriangle className="w-4 h-4" />
                        SPECIAL CONDITIONS
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4">
                        {selectedSubmission.special_condition && (
                          <div className="col-span-2">
                            <Label className="text-xs text-slate-500">Special Condition</Label>
                            <div className={`mt-1 px-3 py-2 rounded-lg flex items-center gap-2 ${
                              selectedSubmission.special_condition === 'property_locked' || selectedSubmission.special_condition === 'house_locked'
                                ? 'bg-amber-100 text-amber-700' 
                                : selectedSubmission.special_condition === 'owner_denied'
                                ? 'bg-red-100 text-red-700'
                                : selectedSubmission.special_condition === 'vacant_plot'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                              {selectedSubmission.special_condition === 'property_locked' || selectedSubmission.special_condition === 'house_locked' ? (
                                <>
                                  <Lock className="w-4 h-4" />
                                  <span className="font-semibold">Property Locked</span>
                                </>
                              ) : selectedSubmission.special_condition === 'owner_denied' ? (
                                <>
                                  <UserX className="w-4 h-4" />
                                  <span className="font-semibold">Owner Denied</span>
                                </>
                              ) : selectedSubmission.special_condition === 'vacant_plot' ? (
                                <>
                                  <MapPin className="w-4 h-4" />
                                  <span className="font-semibold">Vacant Plot</span>
                                </>
                              ) : (
                                <>
                                  <Navigation className="w-4 h-4" />
                                  <span className="font-semibold">Wrong Location</span>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                        <div>
                          <Label className="text-xs text-slate-500">Self Certified</Label>
                          <div className={`mt-1 px-3 py-2 rounded-lg flex items-center gap-2 ${
                            selectedSubmission.self_certified 
                              ? 'bg-emerald-100 text-emerald-700' 
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            <CheckCircle className="w-4 h-4" />
                            <span className="font-semibold">{selectedSubmission.self_certified ? 'Yes' : 'No'}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Survey Submission Details - EDITABLE */}
                <Card className="border-emerald-200 bg-emerald-50/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between text-emerald-700">
                      <span className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        SURVEY SUBMISSION DETAILS (Surveyor Data)
                      </span>
                      <span className="text-xs font-normal bg-emerald-200 text-emerald-700 px-2 py-1 rounded">Editable</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600 flex items-center gap-1">
                          <Users className="w-3 h-3" /> Receiver Name
                        </Label>
                        <Input
                          value={editData.receiver_name}
                          onChange={(e) => setEditData({ ...editData, receiver_name: e.target.value })}
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> Receiver Mobile
                        </Label>
                        <Input
                          value={editData.receiver_mobile}
                          onChange={(e) => setEditData({ ...editData, receiver_mobile: e.target.value })}
                          className="bg-white font-mono"
                          maxLength={10}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">Relation with Owner</Label>
                        <Select
                          value={editData.relation}
                          onValueChange={(value) => setEditData({ ...editData, relation: value })}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select relation" />
                          </SelectTrigger>
                          <SelectContent>
                            {RELATION_OPTIONS.map((rel) => (
                              <SelectItem key={rel} value={rel}>{rel}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600 flex items-center gap-1">
                          <Building className="w-3 h-3" /> Correct Colony Name
                        </Label>
                        <Input
                          value={editData.correct_colony_name}
                          onChange={(e) => setEditData({ ...editData, correct_colony_name: e.target.value })}
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">Self Satisfied</Label>
                        <Select
                          value={editData.self_satisfied}
                          onValueChange={(value) => setEditData({ ...editData, self_satisfied: value })}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Yes">Yes</SelectItem>
                            <SelectItem value="No">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    {/* Special Condition, Property Status, Property Use */}
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">Special Condition</Label>
                        <Select
                          value={editData.special_condition || 'none'}
                          onValueChange={(value) => setEditData({ ...editData, special_condition: value === 'none' ? '' : value })}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select condition" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Normal (No Condition)</SelectItem>
                            <SelectItem value="property_locked">Property Locked</SelectItem>
                            <SelectItem value="owner_denied">Owner Denied</SelectItem>
                            <SelectItem value="vacant_plot">Vacant Plot</SelectItem>
                            <SelectItem value="wrong_location">Wrong Location</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">Property Status</Label>
                        <Select
                          value={editData.house_status || 'none'}
                          onValueChange={(value) => setEditData({ ...editData, house_status: value === 'none' ? '' : value })}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not Set</SelectItem>
                            <SelectItem value="kachha">Kachha</SelectItem>
                            <SelectItem value="pakka">Pakka</SelectItem>
                            <SelectItem value="vacant_plot">Vacant Plot</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">Property Current Use</Label>
                        <Select
                          value={editData.property_use || 'none'}
                          onValueChange={(value) => setEditData({ ...editData, property_use: value === 'none' ? '' : value })}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select use" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not Set</SelectItem>
                            <SelectItem value="residential">Residential</SelectItem>
                            <SelectItem value="commercial">Commercial</SelectItem>
                            <SelectItem value="mix_use">Mix Use</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {editData.property_use === 'other' && (
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">Property Use Remarks</Label>
                          <Input
                            value={editData.property_use_remarks}
                            onChange={(e) => setEditData({ ...editData, property_use_remarks: e.target.value })}
                            placeholder="Specify property use..."
                            className="bg-white"
                          />
                        </div>
                      )}
                    </div>

                    {/* GPS Coordinates */}
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Latitude
                        </Label>
                        <Input
                          value={editData.latitude}
                          onChange={(e) => setEditData({ ...editData, latitude: e.target.value })}
                          className="bg-white font-mono"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Longitude
                        </Label>
                        <Input
                          value={editData.longitude}
                          onChange={(e) => setEditData({ ...editData, longitude: e.target.value })}
                          className="bg-white font-mono"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-slate-600">Remarks</Label>
                      <Textarea
                        value={editData.remarks}
                        onChange={(e) => setEditData({ ...editData, remarks: e.target.value })}
                        rows={2}
                        className="bg-white"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Photos Section - with Delete and Add */}
                <Card className="border-amber-200 bg-amber-50/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between text-amber-700">
                      <span className="flex items-center gap-2">
                        <Camera className="w-4 h-4" />
                        PHOTOS (with GPS Watermark)
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => photoInputRef.current?.click()}
                        disabled={uploadingPhoto}
                        className="h-7 text-xs"
                      >
                        {uploadingPhoto ? (
                          <>Uploading...</>
                        ) : (
                          <>
                            <Plus className="w-3 h-3 mr-1" />
                            Add Photo
                          </>
                        )}
                      </Button>
                      <input
                        type="file"
                        ref={photoInputRef}
                        accept="image/*"
                        onChange={handleAddPhoto}
                        className="hidden"
                      />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {editPhotos?.length > 0 ? (
                      <div className="grid grid-cols-2 gap-4">
                        {editPhotos.map((photo, idx) => {
                          let url = '';
                          let type = 'PHOTO';
                          if (typeof photo === 'string') {
                            url = photo;
                          } else if (typeof photo === 'object' && photo) {
                            url = photo.file_url || photo.url || photo.path || '';
                            type = photo.photo_type || 'PHOTO';
                          }
                          if (!url) return null;
                          const isExt = url.startsWith('http');
                          const pSrc = isExt ? url : `${process.env.REACT_APP_BACKEND_URL}${url}`;
                          return (
                          <div key={idx} className="relative group">
                            <img
                              src={pSrc}
                              alt={type}
                              className="w-full h-40 object-cover rounded-lg border-2 border-white shadow cursor-pointer"
                              onClick={() => window.open(pSrc, '_blank')}
                              onError={(e) => { e.target.style.display = 'none'; }}
                            />
                            <span className={`absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-semibold shadow ${
                              type === 'HOUSE' ? 'bg-blue-500 text-white' :
                              type === 'RECEIVER' ? 'bg-green-500 text-white' :
                              type === 'GATE' ? 'bg-amber-500 text-white' :
                              'bg-slate-500 text-white'
                            }`}>
                              {type}
                            </span>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="absolute top-2 right-2 h-8 w-8 p-0 bg-red-600 hover:bg-red-700 shadow-lg"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Are you sure you want to delete this photo?')) {
                                  handleDeletePhoto(idx);
                                }
                              }}
                              title="Delete Photo"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="absolute bottom-2 right-2 h-7 text-xs bg-white/90 hover:bg-white shadow"
                              onClick={() => window.open(pSrc, '_blank')}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" /> View Full
                            </Button>
                          </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-400">
                        <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
                        <p>No photos available</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => photoInputRef.current?.click()}
                          className="mt-2"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add Photo
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Signature Section */}
                <Card className="border-purple-200 bg-purple-50/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-purple-700">
                      <Pen className="w-4 h-4" />
                      PROPERTY HOLDER SIGNATURE
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedSubmission.signature_url ? (
                      <div className="bg-white border-2 border-dashed border-purple-200 rounded-lg p-4">
                        <img
                          src={`${process.env.REACT_APP_BACKEND_URL}${selectedSubmission.signature_url}`}
                          alt="Signature"
                          className="max-h-28 mx-auto object-contain"
                        />
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-400">
                        <Pen className="w-12 h-12 mx-auto mb-2 opacity-30" />
                        <p>No signature available</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Submission Info */}
                <div className="flex items-center justify-between text-sm text-slate-500 pt-2 border-t">
                  <span>Submitted by: <strong>{selectedSubmission.employee_name}</strong></span>
                  <span>Date: <strong>{new Date(selectedSubmission.submitted_at).toLocaleString()}</strong></span>
                  <span>Status: {getStatusBadge(selectedSubmission.status)}</span>
                </div>
              </div>
            )}

            <DialogFooter className="mt-4 pt-4 border-t flex-wrap gap-2">
              <div className="flex gap-2 w-full sm:w-auto">
                <Button variant="outline" onClick={() => setEditDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleEdit} disabled={savingEdit} className="bg-blue-600 hover:bg-blue-700">
                  {savingEdit ? (
                    <>Saving...</>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
              {canApproveReject && (
                <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
                  {selectedSubmission?.status !== 'Approved' && (
                    <Button
                      onClick={() => {
                        setEditDialog(false);
                        handleApprove(selectedSubmission.id);
                      }}
                      className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Approve
                    </Button>
                  )}
                  {selectedSubmission?.status !== 'Rejected' && (
                    <Button
                      onClick={() => {
                        setEditDialog(false);
                        openRejectDialog(selectedSubmission);
                      }}
                      variant="destructive"
                      className="flex-1 sm:flex-none"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                  )}
                </div>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
