import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { toast } from 'sonner';
import AdminLayout from '../../components/AdminLayout';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useAuth } from '../../context/AuthContext';
import { MapPin, Loader2, Save, Crosshair } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL;
const PHED = `${API_URL}/api/phed`;
const DEFAULT_CENTER = [29.9695, 76.8783]; // Thanesar

const pinIcon = L.divIcon({
  className: '',
  html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:#2563eb;border:3px solid #fff;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
  iconSize: [26, 26], iconAnchor: [13, 26],
});

function ClickToPlace({ onPick }) {
  useMapEvents({ click(e) { onPick([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

export default function LocationPending() {
  const { getAuthHeader } = useAuth();
  const H = () => ({ headers: getAuthHeader() });
  const [rows, setRows] = useState(null);
  const [active, setActive] = useState(null); // property being located
  const [pin, setPin] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const { data } = await axios.get(`${PHED}/location-pending`, H());
      setRows(data.properties || []);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load'); setRows([]); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const openMap = (p) => { setActive(p); setPin(null); };
  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocation not available'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setPin([pos.coords.latitude, pos.coords.longitude]),
      () => toast.error('Could not get current location'), { enableHighAccuracy: true }
    );
  };
  const save = async () => {
    if (!pin || !active) return;
    setSaving(true);
    try {
      await axios.post(`${PHED}/properties/${active.id}/location`, { latitude: pin[0], longitude: pin[1] }, H());
      toast.success(`Location saved for ${active.property_id}`);
      setRows((rs) => (rs || []).filter((r) => r.id !== active.id));
      setActive(null); setPin(null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); } finally { setSaving(false); }
  };

  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = (rows || []).length > 0 && (rows || []).every((r) => selected.has(r.id));
  const toggleSelAll = () => setSelected(() => (allSelected ? new Set() : new Set((rows || []).map((r) => r.id))));
  const bulkLocate = async (all = false) => {
    const ids = [...selected];
    if (!all && !ids.length) return;
    if (!window.confirm(all ? 'Saari pending properties ko unki colony ke centre par place karein?' : `${ids.length} properties ko colony centre par place karein?`)) return;
    setLocating(true);
    try {
      const { data } = await axios.post(`${PHED}/location-pending/bulk-locate`, all ? { all_pending: true } : { ids }, H());
      toast.success(data.message || 'Located');
      if (data.skipped?.length) toast.warning(`${data.skipped.length} skip hui (colony me koi located property nahi)`);
      setSelected(new Set());
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Auto-locate failed'); } finally { setLocating(false); }
  };

  return (
    <AdminLayout>
      <div className="p-4 md:p-6" data-testid="location-pending-page">
        <div className="flex items-center gap-2 mb-1">
          <MapPin className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold" style={{ color: 'var(--phed-ink)' }}>Location Pending</h1>
        </div>
        <p className="text-sm text-slate-500 mb-4">Office-import se bani properties jinka GPS point abhi set nahi hai — inhe map par place karein.</p>

        <Card className="clinic-card">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--phed-ink)' }}>
                {rows === null ? 'Loading…' : `${rows.length} properties need a location`}
              </span>
              <div className="flex items-center gap-2">
                {selected.size > 0 && (
                  <Button size="sm" onClick={() => bulkLocate(false)} disabled={locating} className="h-8 text-white" style={{ background: '#7c3aed' }} data-testid="bulk-locate-selected">
                    {locating ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Crosshair className="w-3.5 h-3.5 mr-1" />} Auto-place selected ({selected.size})
                  </Button>
                )}
                {rows?.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => bulkLocate(true)} disabled={locating} className="h-8 text-violet-700 border-violet-300" data-testid="bulk-locate-all">
                    <Crosshair className="w-3.5 h-3.5 mr-1" /> Auto-place all at colony centre
                  </Button>
                )}
              </div>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelAll} disabled={!rows?.length} className="w-4 h-4 accent-violet-700 cursor-pointer" data-testid="loc-select-all" />
                </TableHead>
                {['Property', 'Owner', 'Colony / Ward', 'Address', ''].map((h) => <TableHead key={h}>{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {rows === null && <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></TableCell></TableRow>}
                {rows?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-slate-500">Sab properties located hain 🎉</TableCell></TableRow>}
                {rows?.map((p) => (
                  <TableRow key={p.id} data-testid={`loc-row-${p.id}`}>
                    <TableCell><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} className="w-4 h-4 accent-violet-700 cursor-pointer" data-testid={`loc-select-${p.id}`} /></TableCell>
                    <TableCell className="font-mono text-xs">{p.property_id}</TableCell>
                    <TableCell>{p.owner_name || '—'}</TableCell>
                    <TableCell className="text-xs">{p.colony || '—'}{p.ward ? ` / ${p.ward}` : ''}</TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-[220px] truncate">{p.address || '—'}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => openMap(p)} className="h-8 text-white" style={{ background: '#2563eb' }} data-testid={`set-location-${p.id}`}>
                        <MapPin className="w-4 h-4 mr-1" /> Set on Map
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!active} onOpenChange={(o) => { if (!o) { setActive(null); setPin(null); } }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Set location — {active?.property_id}</DialogTitle></DialogHeader>
            <p className="text-xs text-slate-500 -mt-2">Map par click karke pin lagayein, ya "Use my location" dabayein.</p>
            <div className="h-[360px] rounded-lg overflow-hidden border" data-testid="location-map">
              <MapContainer center={DEFAULT_CENTER} zoom={15} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}" subdomains={['mt0', 'mt1', 'mt2', 'mt3']} maxZoom={22} />
                <ClickToPlace onPick={setPin} />
                {pin && <Marker position={pin} icon={pinIcon} />}
              </MapContainer>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono text-slate-600">
                {pin ? <><Crosshair className="w-3 h-3 inline mr-1" />{pin[0].toFixed(6)}, {pin[1].toFixed(6)}</> : 'No pin yet'}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={useMyLocation} data-testid="use-my-location">Use my location</Button>
                <Button size="sm" onClick={save} disabled={!pin || saving} className="text-white" style={{ background: '#2E7D32' }} data-testid="save-location">
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Save location
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
