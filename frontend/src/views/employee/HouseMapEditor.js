import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, Marker, useMapEvents, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import { Button } from '../../components/ui/button';
import { Pencil, Check, Undo2, Trash2, Crosshair, Loader2, Locate } from 'lucide-react';

// Area-weighted centroid of [[lat,lng],...] -> [lat,lng]
export function centroidOf(points) {
  const pts = (points || []).filter((p) => Array.isArray(p) && p.length === 2);
  const n = pts.length;
  if (!n) return null;
  if (n < 3) return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [y0, x0] = pts[i];
    const [y1, x1] = pts[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-12) return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  a *= 0.5;
  return [cy / (6 * a), cx / (6 * a)];
}

const vertexIcon = L.divIcon({
  className: 'house-vertex',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#fbbf24;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>',
  iconSize: [14, 14], iconAnchor: [7, 7],
});
const centroidIcon = L.divIcon({
  className: 'house-centroid',
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center"><div style="width:5px;height:5px;border-radius:50%;background:#fff"></div></div>',
  iconSize: [18, 18], iconAnchor: [9, 9],
});
const surveyorIcon = L.divIcon({
  className: 'house-surveyor',
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#10b981;border:3px solid #fff;box-shadow:0 0 0 6px rgba(16,185,129,.25)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8],
});

function ClickCapture({ enabled, onAdd }) {
  useMapEvents({ click(e) { if (enabled) onAdd([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

function Recenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] != null && center[1] != null) {
      map.setView(center, zoom || Math.max(map.getZoom(), 18));
      setTimeout(() => map.invalidateSize(), 200);
    }
  }, [center && center[0], center && center[1]]); // eslint-disable-line
  return null;
}

export default function HouseMapEditor({ value, onChange, center, surveyorGps, onCaptureGps, gpsBusy }) {
  const [drawing, setDrawing] = useState(false);
  const poly = value || [];
  const centroid = useMemo(() => centroidOf(poly), [poly]);
  const gpsLatLng = surveyorGps ? [surveyorGps.latitude, surveyorGps.longitude] : null;
  const startCenter = centroid || (poly[0]) || gpsLatLng || center || [29.9695, 76.8783];
  const [recenterTo, setRecenterTo] = useState(null);

  const addVertex = (latlng) => onChange([...poly, latlng]);
  const moveVertex = (idx, latlng) => { const np = poly.slice(); np[idx] = latlng; onChange(np); };
  const undo = () => onChange(poly.slice(0, -1));
  const clear = () => { onChange([]); setDrawing(false); };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        <Button type="button" size="sm" variant={drawing ? 'default' : 'outline'}
          onClick={() => setDrawing((d) => !d)}
          className={drawing ? 'text-white' : ''} style={drawing ? { background: 'var(--phed-blue)' } : {}}
          data-testid="house-draw-toggle">
          {drawing ? <><Check className="w-4 h-4 mr-1.5" /> Done drawing</> : <><Pencil className="w-4 h-4 mr-1.5" /> {poly.length >= 3 ? 'Edit boundary' : 'Draw house'}</>}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={undo} disabled={!poly.length} data-testid="house-undo"><Undo2 className="w-4 h-4 mr-1.5" /> Undo</Button>
        <Button type="button" size="sm" variant="outline" onClick={clear} disabled={!poly.length} className="text-red-500" data-testid="house-clear"><Trash2 className="w-4 h-4 mr-1.5" /> Clear</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCaptureGps} disabled={gpsBusy} data-testid="capture-gps-btn">
          {gpsBusy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Crosshair className="w-4 h-4 mr-1.5" />} Meri GPS
        </Button>
        {gpsLatLng && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setRecenterTo([...gpsLatLng, Date.now()])} data-testid="house-recenter-gps"><Locate className="w-4 h-4 mr-1.5" /> Meri jagah</Button>
        )}
      </div>
      {drawing && <div className="text-[11px] text-amber-600 mb-1.5">Makan ki chhat ke kono par tap karein (kam se kam 3 point). Point ko drag karke theek kar sakte hain.</div>}
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--phed-border)', height: 300 }}>
        <MapContainer center={startCenter} zoom={18} maxZoom={22} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Satellite">
              <TileLayer attribution="Tiles &copy; Esri" maxNativeZoom={19} maxZoom={22}
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Street">
              <TileLayer attribution="&copy; OpenStreetMap" maxZoom={22}
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            </LayersControl.BaseLayer>
          </LayersControl>
          <Recenter center={recenterTo ? [recenterTo[0], recenterTo[1]] : startCenter} />
          <ClickCapture enabled={drawing} onAdd={addVertex} />
          {poly.length >= 2 && (
            <Polygon positions={poly} pathOptions={{ color: '#fbbf24', weight: 2, fillColor: '#fbbf24', fillOpacity: 0.25 }} />
          )}
          {poly.map((p, i) => (
            <Marker key={i} position={p} icon={vertexIcon} draggable
              eventHandlers={{ dragend: (e) => moveVertex(i, [e.target.getLatLng().lat, e.target.getLatLng().lng]) }} />
          ))}
          {centroid && poly.length >= 3 && <Marker position={centroid} icon={centroidIcon} />}
          {gpsLatLng && <Marker position={gpsLatLng} icon={surveyorIcon} />}
        </MapContainer>
      </div>
      <div className="flex items-center gap-3 text-[11px] mt-1.5 text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#2563eb' }} /> Ghar ka center</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#10b981' }} /> Meri GPS jagah</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#fbbf24' }} /> Boundary kona</span>
      </div>
    </div>
  );
}
