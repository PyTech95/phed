import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Switch } from '../../components/ui/switch';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  Building2, Plus, Edit, Trash2, Users, MapPin, 
  Check, X, Loader2, AlertTriangle 
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export default function Towns() {
  const { token } = useAuth();
  const [towns, setTowns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTown, setEditingTown] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [townToDelete, setTownToDelete] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    is_active: true
  });

  useEffect(() => {
    fetchTowns();
  }, []);

  const fetchTowns = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/admin/towns/manage`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTowns(response.data.towns || []);
    } catch (error) {
      toast.error('Failed to load towns');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (town = null) => {
    if (town) {
      setEditingTown(town);
      setFormData({
        name: town.name,
        code: town.code,
        description: town.description || '',
        is_active: town.is_active
      });
    } else {
      setEditingTown(null);
      setFormData({
        name: '',
        code: '',
        description: '',
        is_active: true
      });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.code.trim()) {
      toast.error('Name and Code are required');
      return;
    }

    setSaving(true);
    try {
      if (editingTown) {
        await axios.put(`${API_URL}/admin/towns/${editingTown.id}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        toast.success('Town updated successfully');
      } else {
        await axios.post(`${API_URL}/admin/towns`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        toast.success('Town created successfully');
      }
      setDialogOpen(false);
      fetchTowns();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save town');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!townToDelete) return;
    
    try {
      await axios.delete(`${API_URL}/admin/towns/${townToDelete.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Town deleted successfully');
      setDeleteDialog(false);
      setTownToDelete(null);
      fetchTowns();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete town');
    }
  };

  const toggleTownStatus = async (town) => {
    try {
      await axios.put(`${API_URL}/admin/towns/${town.id}`, {
        is_active: !town.is_active
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(`Town ${town.is_active ? 'deactivated' : 'activated'}`);
      fetchTowns();
    } catch (error) {
      toast.error('Failed to update town status');
    }
  };

  return (
    <AdminLayout title="Town Management">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-500">
              Manage towns for the PHED Survey & Notice Distribution system
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()} className="bg-blue-700 hover:bg-blue-800 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Add Town
          </Button>
        </div>

        {/* Towns Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
          </div>
        ) : towns.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Building2 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-700">No Towns Created</h3>
              <p className="text-slate-500 mb-4">Create your first town to get started</p>
              <Button onClick={() => handleOpenDialog()} className="bg-blue-700 hover:bg-blue-800 text-white">
                <Plus className="w-4 h-4 mr-2" />
                Create Town
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {towns.map((town) => (
              <Card 
                key={town.id} 
                className={`relative overflow-hidden ${!town.is_active ? 'opacity-60' : ''}`}
              >
                {!town.is_active && (
                  <div className="absolute top-2 right-2 bg-red-100 text-red-700 text-xs px-2 py-1 rounded">
                    Inactive
                  </div>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Building2 className="w-5 h-5 text-blue-700" />
                    {town.name}
                    <span className="text-sm font-normal text-slate-400">({town.code})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {town.description && (
                    <p className="text-sm text-slate-500 mb-3">{town.description}</p>
                  )}
                  
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-1 text-sm text-slate-600">
                      <MapPin className="w-4 h-4 text-green-600" />
                      <span>{town.property_count || 0} Properties</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-slate-600">
                      <Users className="w-4 h-4 text-blue-600" />
                      <span>{town.user_count || 0} Users</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t">
                    <div className="flex items-center gap-2">
                      <Switch 
                        checked={town.is_active}
                        onCheckedChange={() => toggleTownStatus(town)}
                      />
                      <span className="text-xs text-slate-500">
                        {town.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleOpenDialog(town)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => {
                          setTownToDelete(town);
                          setDeleteDialog(true);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingTown ? 'Edit Town' : 'Create New Town'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Town Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Thanesar"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Short Code * (3-5 characters)</Label>
                <Input
                  id="code"
                  placeholder="e.g., THS"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  maxLength={5}
                />
                <p className="text-xs text-slate-500">Unique identifier for the town</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  placeholder="Optional description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="is_active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="bg-blue-700 hover:bg-blue-800 text-white">
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    {editingTown ? 'Update' : 'Create'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                Delete Town
              </DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-slate-600">
                Are you sure you want to delete <strong>{townToDelete?.name}</strong>?
              </p>
              {townToDelete?.property_count > 0 && (
                <p className="text-amber-600 text-sm mt-2">
                  This town has {townToDelete.property_count} properties. 
                  It will be deactivated instead of deleted.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialog(false)}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDelete}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
