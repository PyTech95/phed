import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTown } from '../context/TownContext';
import { useAuth } from '../context/AuthContext';
import { Building2, MapPin, Users, ArrowRight, Loader2, LogOut, ImagePlus, Upload, CheckCircle, Download, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import axios from 'axios';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export default function SelectTown() {
  const navigate = useNavigate();
  const { user, token, logout } = useAuth();
  const { towns, selectTown, loading: townsLoading, refreshTowns } = useTown();
  const [townStats, setTownStats] = useState({});
  const [loadingStats, setLoadingStats] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  
  const [uploadDialog, setUploadDialog] = useState(false);
  const [uploadTown, setUploadTown] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [oldPhotoStats, setOldPhotoStats] = useState(null);
  const [deletingPhotos, setDeletingPhotos] = useState(false);
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    refreshTowns();
    fetchTownStats();
  }, [user]);

  const fetchTownStats = async () => {
    if (!token || user?.role !== 'ADMIN') return;
    setLoadingStats(true);
    try {
      const response = await axios.get(`${API_URL}/admin/towns/manage`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const stats = {};
      (response.data.towns || []).forEach(t => {
        stats[t.id] = { properties: t.property_count || 0, users: t.user_count || 0 };
      });
      setTownStats(stats);
    } catch (error) { console.error('Failed to fetch town stats:', error); }
    finally { setLoadingStats(false); }
  };

  const handleSelectTown = (town) => {
    setSelectedId(town.id);
    selectTown(town);
    setTimeout(() => {
      const destination = (user?.role === 'ADMIN' || user?.role === 'SUPERVISOR' || user?.role === 'MC_OFFICER') ? '/admin' : '/employee';
      window.location.href = destination;
    }, 800);
  };

  const openUploadDialog = (e, town) => {
    e.stopPropagation();
    setUploadTown(town);
    setPhotoFile(null);
    setUploadResult(null);
    setOldPhotoStats(null);
    setUploadDialog(true);
    fetchOldPhotoStats(town.code);
  };

  const handlePhotoUpload = async () => {
    if (!photoFile || !uploadTown) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', photoFile);
      const res = await axios.post(`${API_URL}/admin/upload-old-photos`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data', 'X-Town-Code': uploadTown.code }
      });
      setUploadResult(res.data);
      toast.success(res.data.message);
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); }
    finally { setUploading(false); }
  };

  const fetchOldPhotoStats = async (townCode) => {
    try {
      const res = await axios.get(`${API_URL}/admin/old-photos-stats`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Town-Code': townCode }
      });
      setOldPhotoStats(res.data);
    } catch { setOldPhotoStats(null); }
  };

  const handleDeleteOldPhotos = async () => {
    if (!uploadTown) return;
    if (!window.confirm('Are you sure? This will clear ALL old photo URLs from properties.')) return;
    setDeletingPhotos(true);
    try {
      const res = await axios.delete(`${API_URL}/admin/clear-old-photos`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Town-Code': uploadTown.code }
      });
      toast.success(res.data.message);
      setOldPhotoStats({ total_with_photos: 0 });
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to delete old photos'); }
    finally { setDeletingPhotos(false); }
  };

  const downloadOldPhotoSample = () => {
    const sampleData = [['Property ID', 'Photo URL'], ['3UYE8N55', 'https://example.com/photo1.jpg'], ['3UUOCQ65', 'https://example.com/photo2.jpg']];
    const csvContent = sampleData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'old_photos_sample.csv'; link.click();
    window.URL.revokeObjectURL(url);
    toast.success('Sample file downloaded');
  };

  const accessibleTowns = user?.role === 'ADMIN' ? towns : towns.filter(t => !user?.assigned_town || t.id === user.assigned_town);

  const glassBg = { background: '#FFFFFF', boxShadow: '0 1px 2px rgba(15,42,68,0.04), 0 8px 24px rgba(15,42,68,0.05)' };
  const townColors = ['#1565C0', '#00897B', '#2E7D32', '#0277BD', '#6A1B9A', '#EF6C00'];

  if (townsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background: 'var(--phed-bg)'}}>
        <Loader2 className="w-12 h-12 text-blue-700 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden login-bg">
      <div className="absolute inset-0 login-grid pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 border-b bg-white/95 backdrop-blur" style={{borderColor: 'var(--phed-border)'}}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/phed-logo.png" alt="PHED" className="w-11 h-11 object-contain rounded-full" />
            <div>
              <h1 className="font-bold text-sm" style={{color: 'var(--phed-ink)'}}>Public Health Engineering Department - (PHED)</h1>
              <p className="text-xs" style={{color: 'var(--phed-muted)'}}>PHED Survey & Notice Distribution</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-medium text-sm" style={{color: 'var(--phed-ink)'}}>{user?.name}</p>
              <p className="text-xs" style={{color: 'var(--phed-muted)'}}>{user?.role}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={logout} data-testid="select-town-logout-btn" className="text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-lg">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-12 relative z-10">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-heading font-bold mb-2" style={{color: 'var(--phed-ink)'}}>Select Town</h2>
          <p style={{color: 'var(--phed-muted)'}}>Choose the town you want to work with</p>
        </div>

        {accessibleTowns.length === 0 ? (
          <div className="rounded-2xl border text-center py-12 px-6" style={{...glassBg, borderColor: 'var(--phed-border)'}}>
            <Building2 className="w-16 h-16 text-blue-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2" style={{color: 'var(--phed-ink)'}}>No Towns Available</h3>
            <p className="mb-4" style={{color: 'var(--phed-muted)'}}>
              {user?.role === 'ADMIN' ? 'Create your first town to get started' : 'Contact your administrator to get town access'}
            </p>
            {user?.role === 'ADMIN' && (
              <Button onClick={() => navigate('/admin/towns')} className="bg-blue-700 hover:bg-blue-800 text-white">
                Create Town
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {accessibleTowns.map((town, idx) => {
              const stats = townStats[town.id] || { properties: 0, users: 0 };
              const isSelected = selectedId === town.id;
              const accentColor = townColors[idx % townColors.length];
              
              return (
                <div
                  key={town.id}
                  data-testid={`town-card-${town.code}`}
                  className={`rounded-2xl border cursor-pointer transition-all duration-300 ${
                    isSelected ? 'scale-105' : 'hover:scale-[1.02]'
                  }`}
                  style={{
                    ...glassBg,
                    borderColor: isSelected ? accentColor : 'var(--phed-border)',
                    boxShadow: isSelected ? `0 0 0 3px ${accentColor}22, 0 12px 32px rgba(15,42,68,0.10)` : glassBg.boxShadow,
                  }}
                  onClick={() => handleSelectTown(town)}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3 rounded-xl" style={{background: `${accentColor}14`}}>
                        <Building2 className="w-7 h-7" style={{color: accentColor}} />
                      </div>
                      <div className="flex items-center gap-2">
                        {user?.role === 'ADMIN' && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={(e) => openUploadDialog(e, town)}
                            className="h-8 px-2 text-slate-400 hover:bg-blue-50 hover:text-blue-700"
                            title="Upload Old Property Photos"
                          >
                            <ImagePlus className="w-4 h-4" />
                          </Button>
                        )}
                        <span className="text-xs font-mono px-2 py-1 rounded-lg border font-semibold" style={{background: 'var(--phed-blue-soft)', borderColor: 'var(--phed-border)', color: 'var(--phed-blue)'}}>
                          {town.code}
                        </span>
                      </div>
                    </div>
                    
                    <h3 className="text-xl font-bold mb-1" style={{color: 'var(--phed-ink)'}}>
                      {town.name}
                    </h3>
                    
                    {town.description && (
                      <p className="text-sm mb-4" style={{color: 'var(--phed-muted)'}}>{town.description}</p>
                    )}
                    
                    <div className="flex items-center gap-4 pt-4" style={{borderTop: '1px solid var(--phed-border)'}}>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" style={{color: accentColor}} />
                        <span className="text-sm text-slate-600">
                          {loadingStats ? '...' : stats.properties} Properties
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" style={{color: accentColor}} />
                        <span className="text-sm text-slate-600">
                          {loadingStats ? '...' : stats.users} Users
                        </span>
                      </div>
                    </div>
                    
                    {isSelected && (
                      <div className="mt-4 flex items-center justify-center gap-2 py-2 rounded-xl" style={{background: `${accentColor}15`}}>
                        <Loader2 className="w-4 h-4 animate-spin" style={{color: accentColor}} />
                        <span className="text-sm font-medium" style={{color: accentColor}}>Loading...</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-10 text-center">
          <p className="text-sm" style={{color: 'var(--phed-muted)'}}>
            <ArrowRight className="w-4 h-4 inline mr-1" />
            Click on a town card to select and continue
          </p>
        </div>
      </main>

      {/* Upload Old Photos Dialog */}
      <Dialog open={uploadDialog} onOpenChange={setUploadDialog}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <ImagePlus className="w-5 h-5 text-blue-700" />
              Upload Old Property Photos
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Upload Excel file for <strong className="text-slate-800">{uploadTown?.name}</strong> with Property ID and Photo URL columns
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {oldPhotoStats && (
              <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 flex items-center justify-between">
                <p className="text-sm text-blue-800">
                  <strong>{oldPhotoStats.total_with_photos || 0}</strong> properties with old photos
                </p>
                {(oldPhotoStats.total_with_photos || 0) > 0 && (
                  <Button variant="outline" size="sm" onClick={handleDeleteOldPhotos} disabled={deletingPhotos}
                    className="border-red-200 text-red-600 hover:bg-red-50" data-testid="delete-old-photos-btn">
                    {deletingPhotos ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                    Delete All
                  </Button>
                )}
              </div>
            )}

            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <p className="text-sm text-slate-600 mb-2">Need the correct format?</p>
              <Button variant="outline" size="sm" onClick={downloadOldPhotoSample} className="border-blue-200 text-blue-700 hover:bg-blue-50">
                <Download className="w-4 h-4 mr-2" /> Download Sample Excel
              </Button>
              <p className="text-xs text-slate-400 mt-2">Property ID in Column A, Photo URL in Column B</p>
            </div>

            <div
              className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors"
              style={{borderColor: photoFile ? '#00897B' : '#CBD5E1', background: photoFile ? '#E0F2F1' : 'transparent'}}
              onClick={() => photoInputRef.current?.click()}
            >
              <input ref={photoInputRef} type="file" accept=".xlsx,.xls" onChange={(e) => setPhotoFile(e.target.files[0])} className="hidden" />
              {photoFile ? (
                <div className="flex items-center justify-center gap-3">
                  <CheckCircle className="w-6 h-6 text-teal-600" />
                  <div>
                    <p className="font-medium text-slate-800">{photoFile.name}</p>
                    <p className="text-sm text-slate-500">{(photoFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <p className="text-slate-600">Click to select Excel file</p>
                  <p className="text-xs text-slate-400 mt-1">Format: Column A = Property ID, Column B = Photo URL</p>
                </div>
              )}
            </div>

            {uploadResult && (
              <div className="p-3 border border-teal-200 bg-teal-50 rounded-lg text-sm">
                <p className="font-semibold text-teal-800">{uploadResult.message}</p>
                <div className="flex gap-4 mt-1 text-teal-700">
                  <span>Updated: {uploadResult.updated}</span>
                  <span>Not found: {uploadResult.not_found}</span>
                  <span>Skipped: {uploadResult.skipped}</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialog(false)}>Cancel</Button>
            <Button onClick={handlePhotoUpload} disabled={!photoFile || uploading} className="bg-blue-700 hover:bg-blue-800 text-white">
              {uploading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>) : (<><Upload className="w-4 h-4 mr-2" /> Upload Photos</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
