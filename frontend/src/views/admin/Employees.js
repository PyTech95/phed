import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
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
import { UserPlus, Trash2, Users, Key, Phone, Loader2, Edit, MapPin, MapPinOff } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

const ROLE_LABELS = {
  'SURVEYOR': 'Surveyor',
  'SUPERVISOR': 'Supervisor',
  'MC_OFFICER': 'MC Officer',
  'ADMIN': 'Administrator'
};

const ROLE_COLORS = {
  'SURVEYOR': 'bg-blue-100 text-blue-700',
  'SUPERVISOR': 'bg-purple-100 text-purple-700',
  'MC_OFFICER': 'bg-amber-100 text-amber-700',
  'ADMIN': 'bg-red-100 text-red-700'
};

export default function Employees() {
  const { token, user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetPasswordDialog, setResetPasswordDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [editFormData, setEditFormData] = useState({ name: '', authority: '', gps_radius_required: true });
  const [formData, setFormData] = useState({
    login_id: '',
    mobile: '',
    password: '',
    name: '',
    role: 'SURVEYOR',
    assigned_area: '',
    authority: '',
    permissions: [],
    gps_radius_required: true
  });

  // Authority options for Supervisor and MC Officer
  const AUTHORITY_OPTIONS = [
    'Ward 1',
    'Ward 2', 
    'Ward 3',
    'Ward 4',
    'Ward 5',
    'Ward 6',
    'Ward 7',
    'Ward 8',
    'Ward 9',
    'Ward 10',
    'Zone A',
    'Zone B',
    'Zone C',
    'Zone D',
    'All Areas'
  ];

  // Available permissions for Supervisor and MC Officer
  const PERMISSION_OPTIONS = [
    { key: 'dashboard', label: 'Dashboard', description: 'View dashboard statistics' },
    { key: 'bills', label: 'Bills', description: 'View and manage property bills' },
    { key: 'properties', label: 'Properties', description: 'View property list' },
    { key: 'map', label: 'Map', description: 'View property map' },
    { key: 'submissions', label: 'Submissions', description: 'View survey submissions' },
    { key: 'approve', label: 'Approve/Reject', description: 'Approve or reject submissions' },
    { key: 'employees', label: 'Employees', description: 'View employee list' },
    { key: 'attendance', label: 'Attendance', description: 'View attendance records' },
    { key: 'export', label: 'Export', description: 'Export data to Excel/PDF' },
    { key: 'upload', label: 'Upload', description: 'Upload property data' }
  ];

  // Only ADMIN can create employees
  const canManageEmployees = user?.role === 'ADMIN';

  // Toggle permission
  const togglePermission = (permKey) => {
    setFormData(prev => {
      const perms = prev.permissions || [];
      if (perms.includes(permKey)) {
        return { ...prev, permissions: perms.filter(p => p !== permKey) };
      } else {
        return { ...prev, permissions: [...perms, permKey] };
      }
    });
  };

  // Select all permissions
  const selectAllPermissions = () => {
    setFormData(prev => ({
      ...prev,
      permissions: PERMISSION_OPTIONS.map(p => p.key)
    }));
  };

  // Clear all permissions
  const clearAllPermissions = () => {
    setFormData(prev => ({ ...prev, permissions: [] }));
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const response = await axios.get(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setEmployees(response.data);
    } catch (error) {
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  const validateMobile = (mobile) => {
    return /^\d{10}$/.test(mobile);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.login_id || !formData.login_id.trim()) {
      toast.error('Please enter a Login ID');
      return;
    }

    try {
      const submitData = {
        ...formData,
        username: formData.login_id.trim(),
        permissions: formData.role === 'SURVEYOR' ? null : formData.permissions
      };
      
      await axios.post(`${API_URL}/admin/users`, submitData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Employee created successfully');
      setDialogOpen(false);
      setFormData({
        login_id: '',
        mobile: '',
        password: '',
        name: '',
        role: 'SURVEYOR',
        assigned_area: '',
        authority: '',
        permissions: [],
        gps_radius_required: true
      });
      fetchEmployees();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create employee');
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setResetting(true);
    try {
      await axios.post(`${API_URL}/admin/users/${selectedEmployee.id}/reset-password`, {
        new_password: newPassword
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(`Password reset for ${selectedEmployee.name}`);
      setResetPasswordDialog(false);
      setSelectedEmployee(null);
      setNewPassword('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async (userId, userName) => {
    if (!window.confirm(`Are you sure you want to delete ${userName}?`)) return;
    
    try {
      await axios.delete(`${API_URL}/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Employee deleted');
      fetchEmployees();
    } catch (error) {
      toast.error('Failed to delete employee');
    }
  };

  const openResetDialog = (employee) => {
    setSelectedEmployee(employee);
    setNewPassword('');
    setResetPasswordDialog(true);
  };

  const openEditDialog = (employee) => {
    setSelectedEmployee(employee);
    setEditFormData({
      name: employee.name || '',
      authority: employee.authority || '',
      gps_radius_required: employee.gps_radius_required !== false
    });
    setEditDialog(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editFormData.name.trim()) {
      toast.error('Name is required');
      return;
    }
    
    try {
      await axios.put(`${API_URL}/admin/users/${selectedEmployee.id}`, editFormData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Employee updated successfully');
      setEditDialog(false);
      fetchEmployees();
    } catch (error) {
      toast.error('Failed to update employee');
    }
  };

  return (
    <AdminLayout title="Employee Management">
      <div data-testid="admin-employees" className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-slate-600">
            Manage surveyors, supervisors and MC officers
          </p>
          {canManageEmployees && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="add-employee-btn" className="bg-blue-700 hover:bg-blue-800 text-white">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Employee
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-heading">Add New Employee</DialogTitle>
                  <DialogDescription>
                    Create a new employee account
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      data-testid="employee-name-input"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Enter full name"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login_id">Login ID</Label>
                    <Input
                      id="login_id"
                      data-testid="employee-login-id-input"
                      value={formData.login_id}
                      onChange={(e) => setFormData({ ...formData, login_id: e.target.value })}
                      placeholder="Enter login ID (text)"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mobile">Mobile Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        id="mobile"
                        data-testid="employee-mobile-input"
                        value={formData.mobile}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setFormData({ ...formData, mobile: value });
                        }}
                        placeholder="10-digit mobile number"
                        className="pl-10"
                        maxLength={10}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      data-testid="employee-password-input"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="Enter password (min 6 characters)"
                      required
                      minLength={6}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select
                      value={formData.role}
                      onValueChange={(value) => setFormData({ ...formData, role: value, authority: '' })}
                    >
                      <SelectTrigger data-testid="employee-role-select">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SURVEYOR">Surveyor</SelectItem>
                        <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                        <SelectItem value="MC_OFFICER">MC Officer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* GPS radius requirement - Surveyor only */}
                  {formData.role === 'SURVEYOR' && (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="gps-radius-section">
                      <Label>50m GPS radius required?</Label>
                      <p className="text-xs text-slate-500">
                        Yes = surveyor must be within 50 m of the property to submit. No = can submit from anywhere (e.g. office).
                      </p>
                      <div className="flex gap-2 pt-1">
                        <Button type="button" size="sm" data-testid="gps-radius-yes"
                          variant={formData.gps_radius_required ? 'default' : 'outline'}
                          className={formData.gps_radius_required ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                          onClick={() => setFormData({ ...formData, gps_radius_required: true })}>
                          <MapPin className="w-4 h-4 mr-1" /> Yes – required
                        </Button>
                        <Button type="button" size="sm" data-testid="gps-radius-no"
                          variant={!formData.gps_radius_required ? 'default' : 'outline'}
                          className={!formData.gps_radius_required ? 'bg-amber-600 hover:bg-amber-700' : ''}
                          onClick={() => setFormData({ ...formData, gps_radius_required: false })}>
                          <MapPinOff className="w-4 h-4 mr-1" /> No – anywhere
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Authority Selection - Only for Supervisor and MC Officer */}
                  {(formData.role === 'SUPERVISOR' || formData.role === 'MC_OFFICER') && (
                    <div className="space-y-2">
                      <Label htmlFor="authority">Authority / Jurisdiction</Label>
                      <Select
                        value={formData.authority}
                        onValueChange={(value) => setFormData({ ...formData, authority: value })}
                      >
                        <SelectTrigger data-testid="employee-authority-select">
                          <SelectValue placeholder="Select authority area" />
                        </SelectTrigger>
                        <SelectContent>
                          {AUTHORITY_OPTIONS.map((auth) => (
                            <SelectItem key={auth} value={auth}>{auth}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-500">
                        {formData.role === 'SUPERVISOR' 
                          ? 'Area this supervisor will oversee' 
                          : 'Jurisdiction for this MC Officer'}
                      </p>
                    </div>
                  )}
                  
                  {/* Permissions - Only for Supervisor and MC Officer */}
                  {(formData.role === 'SUPERVISOR' || formData.role === 'MC_OFFICER') && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Access Permissions</Label>
                        <div className="flex gap-2">
                          <Button 
                            type="button" 
                            variant="outline" 
                            size="sm" 
                            className="text-xs h-7"
                            onClick={selectAllPermissions}
                          >
                            Select All
                          </Button>
                          <Button 
                            type="button" 
                            variant="outline" 
                            size="sm" 
                            className="text-xs h-7"
                            onClick={clearAllPermissions}
                          >
                            Clear All
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded-lg p-3 bg-slate-50">
                        {PERMISSION_OPTIONS.map((perm) => (
                          <label 
                            key={perm.key} 
                            className={`flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                              formData.permissions?.includes(perm.key) 
                                ? 'bg-blue-50 border border-blue-200' 
                                : 'bg-white border border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={formData.permissions?.includes(perm.key) || false}
                              onChange={() => togglePermission(perm.key)}
                              className="mt-0.5 rounded border-slate-300"
                            />
                            <div>
                              <span className="text-sm font-medium text-slate-800">{perm.label}</span>
                              <p className="text-xs text-slate-500">{perm.description}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-amber-600 flex items-center gap-1">
                        <span>⚠️</span> Selected: {formData.permissions?.length || 0} permissions
                      </p>
                    </div>
                  )}
                  
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      data-testid="create-employee-btn"
                      className="bg-blue-700 hover:bg-blue-800 text-white"
                      disabled={!formData.login_id?.trim() || !formData.name?.trim() || !formData.password}
                    >
                      Create Employee
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Employee List */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-slate-500">Loading...</div>
            ) : employees.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                <p className="text-slate-500">No employees found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Login ID</th>
                      <th>Mobile</th>
                      <th>Role</th>
                      <th>Authority</th>
                      <th>Assigned Area</th>
                      <th>GPS 50m</th>
                      {canManageEmployees && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id}>
                        <td className="font-medium">{emp.name}</td>
                        <td>
                          <span className="font-mono text-sm">{emp.username}</span>
                        </td>
                        <td>
                          <span className="text-sm text-slate-600">{emp.mobile || '-'}</span>
                        </td>
                        <td>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${ROLE_COLORS[emp.role] || 'bg-slate-100'}`}>
                            {ROLE_LABELS[emp.role] || emp.role}
                          </span>
                        </td>
                        <td className="text-slate-600">
                          {emp.authority ? (
                            <span className="px-2 py-1 rounded bg-green-50 text-green-700 text-xs font-medium">
                              {emp.authority}
                            </span>
                          ) : '-'}
                        </td>
                        <td>
                          {emp.permissions && emp.permissions.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {emp.permissions.slice(0, 3).map((perm) => (
                                <span key={perm} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs">
                                  {perm}
                                </span>
                              ))}
                              {emp.permissions.length > 3 && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-xs">
                                  +{emp.permissions.length - 3} more
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">
                              {emp.role === 'ADMIN' ? 'All Access' : '-'}
                            </span>
                          )}
                        </td>
                        <td className="text-slate-600">{emp.assigned_area || '-'}</td>
                        <td data-testid={`gps-radius-cell-${emp.username}`}>
                          {emp.role === 'SURVEYOR' ? (
                            emp.gps_radius_required === false ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                <MapPinOff className="w-3 h-3" /> Not required
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                                <MapPin className="w-3 h-3" /> Required
                              </span>
                            )
                          ) : <span className="text-slate-400">-</span>}
                        </td>
                        {canManageEmployees && (
                          <td>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditDialog(emp)}
                                title="Edit"
                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openResetDialog(emp)}
                                title="Reset Password"
                              >
                                <Key className="w-4 h-4" />
                              </Button>
                              {emp.role !== 'ADMIN' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => handleDelete(emp.id, emp.name)}
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit Employee Dialog */}
        <Dialog open={editDialog} onOpenChange={setEditDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading">Edit Employee</DialogTitle>
              <DialogDescription>
                Update details for {selectedEmployee?.username}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleEditSubmit} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  placeholder="Full Name"
                />
              </div>
              {selectedEmployee?.role === 'SURVEYOR' && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="edit-gps-radius-section">
                  <Label>50m GPS radius required?</Label>
                  <div className="flex gap-2 pt-1">
                    <Button type="button" size="sm" data-testid="edit-gps-radius-yes"
                      variant={editFormData.gps_radius_required ? 'default' : 'outline'}
                      className={editFormData.gps_radius_required ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                      onClick={() => setEditFormData({ ...editFormData, gps_radius_required: true })}>
                      <MapPin className="w-4 h-4 mr-1" /> Yes – required
                    </Button>
                    <Button type="button" size="sm" data-testid="edit-gps-radius-no"
                      variant={!editFormData.gps_radius_required ? 'default' : 'outline'}
                      className={!editFormData.gps_radius_required ? 'bg-amber-600 hover:bg-amber-700' : ''}
                      onClick={() => setEditFormData({ ...editFormData, gps_radius_required: false })}>
                      <MapPinOff className="w-4 h-4 mr-1" /> No – anywhere
                    </Button>
                  </div>
                </div>
              )}
              {(selectedEmployee?.role === 'SUPERVISOR' || selectedEmployee?.role === 'MC_OFFICER') && (
                <div className="space-y-2">
                  <Label>Authority</Label>
                  <Select
                    value={editFormData.authority}
                    onValueChange={(value) => setEditFormData({ ...editFormData, authority: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select authority" />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTHORITY_OPTIONS.map((auth) => (
                        <SelectItem key={auth} value={auth}>{auth}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Reset Password Dialog */}
        <Dialog open={resetPasswordDialog} onOpenChange={setResetPasswordDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading">Reset Password</DialogTitle>
              <DialogDescription>
                Set a new password for {selectedEmployee?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min 6 characters)"
                  minLength={6}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetPasswordDialog(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleResetPassword}
                disabled={resetting || newPassword.length < 6}
                className="bg-blue-700 hover:bg-blue-800 text-white"
              >
                {resetting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4 mr-2" />
                    Reset Password
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
