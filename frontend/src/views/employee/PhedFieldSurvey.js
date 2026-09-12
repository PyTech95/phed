import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Search, MapPin, Droplet, Waves, Link2, UserPlus, Ban, Crosshair, Camera,
  CheckCircle2, ChevronLeft, ChevronRight, Loader2, X, FileText, AlertTriangle, ClipboardList,
} from 'lucide-react';
import WaterSurveyPanel from './WaterSurveyPanel';
import PhedConsumerPropertyLinker from './PhedConsumerPropertyLinker';
import PhedSurveyConsumerList from './PhedSurveyConsumerList';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = API_URL + '/phed';
const SERVICES = ['Water', 'Sewer'];
const CATEGORIES = ['Domestic', 'Commercial', 'Domestic-SC', 'Other'];
const ATT_TYPES = [['BILL', 'Water/Sewer Bill'], ['PROPERTY_FRONT', 'Property-front photo'], ['AADHAAR', 'Aadhaar (if required)'], ['REGISTRY', 'Registry (if required)'], ['OTHER', 'Other document']];
const MAX_IMG_EDGE = 1600;

// Shrink camera photos client-side before upload (mobile data + 8 MB server limit)
async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_IMG_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}
const STATUS_OPTS = [
  ['EXISTING_LINKED', 'Yes — existing PHED record', Link2],
  ['NEW_UNLISTED', 'Exists but not in imported data', UserPlus],
  ['NO_CONNECTION', 'No PHED connection', Ban],
];

export default function PhedFieldSurvey() {
  const { user, getAuthHeader } = useAuth();
  const { propertyId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const H = () => ({ headers: getAuthHeader() });
  const isAdmin = ['ADMIN', 'SUPERVISOR', 'MC_OFFICER'].includes(user?.role);
  const [props, setProps] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [routeError, setRouteError] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [me, setMe] = useState(null);
  const [phedIds, setPhedIds] = useState(new Set()); // property ids matched via PHED (consumer/connection) search
  const [phedSearching, setPhedSearching] = useState(false);
  const [phedSearchError, setPhedSearchError] = useState('');
  const [consumerRows, setConsumerRows] = useState([]);
  const [consumerLoading, setConsumerLoading] = useState(false);
  const [consumerLoadError, setConsumerLoadError] = useState('');
  const [consumerSearch, setConsumerSearch] = useState('');
  const [consumerMeta, setConsumerMeta] = useState({
    total: 0,
    page: 1,
    pages: 1,
    linked_total: 0,
    unlinked_total: 0,
  });
  const [selectedConsumer, setSelectedConsumer] = useState(null);
  const [initialConsumer, setInitialConsumer] = useState(null);
  const searchInputRef = useRef(null);
  const propertyListRef = useRef(null);
  const missingRouteHandledRef = useRef(false);
  const consumerRequestRef = useRef(0);

  useEffect(() => {
    if (isAdmin || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => setMe({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => {}, { timeout: 10000 });
  }, [isAdmin]);

  const loadProps = useCallback(async () => {
    setProps(null);
    setLoadError('');
    try {
      const url = isAdmin ? `${API_URL}/admin/properties?page=1&limit=5000` : `${API_URL}/employee/properties?limit=5000`;
      const { data } = await axios.get(url, H());
      const list = data.properties || data || [];
      setProps(list);
      return list;
    } catch {
      setLoadError('Properties load नहीं हुईं। Refresh करके फिर कोशिश करें।');
      setProps([]);
      return [];
    }
  }, [isAdmin]);

  useEffect(() => { loadProps(); }, [loadProps]);

  const loadSurveyConsumers = useCallback(async (pageNumber = 1, append = false) => {
    const requestId = consumerRequestRef.current + 1;
    consumerRequestRef.current = requestId;
    setConsumerLoading(true);
    setConsumerLoadError('');
    try {
      const params = {
        page: pageNumber,
        limit: 40,
        link_status: pendingOnly ? 'unlinked' : undefined,
        search: consumerSearch.trim() || undefined,
      };
      const { data } = await axios.get(`${PHED}/survey-consumers`, { ...H(), params });
      if (requestId !== consumerRequestRef.current) return;
      setConsumerRows((current) => (append ? [...current, ...(data.consumers || [])] : (data.consumers || [])));
      setConsumerMeta({
        total: data.total || 0,
        page: data.page || pageNumber,
        pages: data.pages || 1,
        linked_total: data.linked_total || 0,
        unlinked_total: data.unlinked_total || 0,
      });
    } catch (error) {
      if (requestId !== consumerRequestRef.current) return;
      setConsumerLoadError(error.response?.data?.detail || 'PHED Excel data load नहीं हुआ। फिर कोशिश करें।');
      if (!append) setConsumerRows([]);
    } finally {
      if (requestId === consumerRequestRef.current) setConsumerLoading(false);
    }
  }, [consumerSearch, pendingOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isAdmin) return undefined;
    const timer = setTimeout(() => loadSurveyConsumers(1, false), 300);
    return () => clearTimeout(timer);
  }, [consumerSearch, pendingOnly, isAdmin, loadSurveyConsumers]);

  // Water Survey search = PHED (public-health) search: match by Consumer ID, connection no.,
  // phone or name and surface the linked property. (Property tab keeps property-field search.)
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setPhedIds(new Set());
      setPhedSearchError('');
      setPhedSearching(false);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPhedSearching(true);
    setPhedSearchError('');
    const t = setTimeout(async () => {
      try {
        const { data } = await axios.get(`${PHED}/consumers/search`, {
          ...H(),
          params: { q: term, limit: 25 },
          signal: controller.signal,
        });
        if (cancelled) return;
        const ids = new Set();
        (data.results || []).forEach((c) => {
          const pid = c.linked_property?.id || c.linked_property_id;
          if (pid) ids.add(pid);
        });
        setPhedIds(ids);
      } catch (error) {
        if (!cancelled && error.code !== 'ERR_CANCELED') {
          setPhedIds(new Set());
          setPhedSearchError('PHED search अभी उपलब्ध नहीं है; property details से search जारी रखें।');
        }
      }
      finally { if (!cancelled) setPhedSearching(false); }
    }, 350);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(t);
    };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open a property when navigated from the map (URL param)
  useEffect(() => {
    if (propertyId && props && !selected && !missingRouteHandledRef.current) {
      const p = props.find((x) => x.id === propertyId);
      if (p) {
        setSelected(p);
      } else {
        missingRouteHandledRef.current = true;
        setRouteError('Selected property अब आपके assigned list में नहीं है। Map से दूसरी property चुनें।');
      }
    }
  }, [propertyId, props, selected]);

  const isSurveyed = (p) => [
    'Draft',
    'Submitted',
    'Requires Review',
    'Document Pending',
    'Approved',
    'No PHED Connection',
  ].includes(p.phed_survey_status);
  const distTo = (p) => (me && p.latitude != null ? Math.hypot((p.latitude - me.latitude) * 111320, (p.longitude - me.longitude) * 111320 * Math.cos((me.latitude * Math.PI) / 180)) : null);
  const filtered = (props || []).filter((p) => {
    const s = q.trim().toLowerCase();
    if (s) {
      const textMatch = [p.property_id, p.owner_name, p.address, p.colony, p.mobile].some((v) => (v || '').toLowerCase().includes(s));
      if (!textMatch && !phedIds.has(p.id)) return false;
    }
    if (!isAdmin && pendingOnly && isSurveyed(p)) return false;
    return true;
  }).sort((a, b) => (!isAdmin && me ? (distTo(a) ?? 1e12) - (distTo(b) ?? 1e12) : 0));
  const pendingCount = (props || []).filter((p) => !isSurveyed(p)).length;
  const nextPending = (list) => {
    const src = Array.isArray(list) ? list : props;
    const pool = (src || []).filter((p) => !isSurveyed(p) && p.id !== selected?.id).sort((a, b) => (me ? (distTo(a) ?? 1e12) - (distTo(b) ?? 1e12) : 0));
    const n = pool[0];
    setSelected(n || null);
    if (!n) toast.success('सभी properties का survey पूरा हो गया!');
  };

  const chooseProperty = (property) => {
    searchInputRef.current?.blur();
    setSelected(property);
  };

  const beginPendingSelection = () => {
    setPendingOnly(true);
    toast.info('नीचे सूची से Pending property चुनें।');
    propertyListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const returnToSource = () => {
    setSelected(null);
    setSelectedConsumer(null);
    setInitialConsumer(null);
    loadProps();
    if (!propertyId) {
      loadSurveyConsumers(1, false);
      return;
    }
    navigate(location.state?.returnTo || '/employee/phed-survey', {
      replace: true,
      state: { restoreSearchQuery: location.state?.restoreSearchQuery || '' },
    });
  };

  if (selected && !isAdmin) {
    return (
      <WaterSurveyPanel
        key={selected.id}
        property={selected}
        H={H}
        onBack={returnToSource}
        onNext={returnToSource}
        initialConsumer={initialConsumer}
      />
    );
  }
  if (selectedConsumer && !isAdmin) {
    return (
      <PhedConsumerPropertyLinker
        consumer={selectedConsumer}
        properties={props}
        H={H}
        onBack={() => setSelectedConsumer(null)}
        onAttached={(property, consumer) => {
          setSelectedConsumer(null);
          setInitialConsumer(consumer);
          setSelected(property);
        }}
      />
    );
  }
  if (!isAdmin) {
    return (
      <PhedSurveyConsumerList
        consumers={consumerRows}
        loading={consumerLoading}
        error={consumerLoadError}
        search={consumerSearch}
        onSearchChange={setConsumerSearch}
        unlinkedOnly={pendingOnly}
        onUnlinkedOnlyChange={setPendingOnly}
        stats={consumerMeta}
        onChooseConsumer={(consumer) => setSelectedConsumer(consumer)}
        onLoadMore={() => loadSurveyConsumers(consumerMeta.page + 1, true)}
      />
    );
  }
  if (selected) {
    return <SurveyPanel property={selected} onBack={returnToSource} H={H} isAdmin={isAdmin} />;
  }

  return (
    <EmployeeLayout title={isAdmin ? 'PHED Consumer Survey' : 'Water Supply Survey'}>
      <div className="max-w-3xl mx-auto">
        {!isAdmin && props && (
          <div className="flex items-center justify-between mb-3 rounded-xl p-3 text-white" style={{ background: 'var(--phed-blue)' }} data-testid="survey-progress-bar">
            <div>
              <div className="text-2xl font-bold leading-none" data-testid="pending-count">{pendingCount}</div>
              <div className="text-xs opacity-90">बाकी (pending) · {props.length - pendingCount} / {props.length} done</div>
            </div>
            {pendingCount > 0 && (
              <Button
                className="h-11 bg-white hover:bg-blue-50"
                style={{ color: 'var(--phed-blue)' }}
                onClick={beginPendingSelection}
                data-testid="start-next-btn"
              >
                Pending चुनें <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        )}
        {routeError && (
          <Card className="mb-3 border-amber-300 bg-amber-50" data-testid="selected-property-route-error">
            <CardContent className="p-3 text-sm text-amber-800">{routeError}</CardContent>
          </Card>
        )}
        <div className="relative mb-2">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <Input
            ref={searchInputRef}
            className="h-11 pl-9 pr-9"
            placeholder="Search Consumer ID, connection no., phone, name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="field-property-search"
          />
          {phedSearching && <Loader2 className="w-4 h-4 absolute right-3 top-3 text-blue-400 animate-spin" />}
          {!phedSearching && q && (
            <button
              type="button"
              onClick={() => { setQ(''); searchInputRef.current?.focus(); }}
              className="absolute right-2 top-1.5 rounded p-1.5 text-slate-400 hover:bg-slate-100"
              data-testid="clear-field-property-search"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {phedSearchError && (
          <p className="mb-2 text-xs text-amber-700" data-testid="phed-search-error">{phedSearchError}</p>
        )}
        {loadError && <p className="mb-2 text-sm text-red-700" data-testid="field-properties-load-error">{loadError}</p>}
        {!isAdmin && (
          <div className="flex gap-2 mb-4 text-xs">
            <button type="button" onClick={() => setPendingOnly(true)} className={`px-3 h-8 rounded-full border ${pendingOnly ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600'}`} data-testid="filter-pending">Pending</button>
            <button type="button" onClick={() => setPendingOnly(false)} className={`px-3 h-8 rounded-full border ${!pendingOnly ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600'}`} data-testid="filter-all">All</button>
            {me && <span className="ml-auto self-center text-slate-400">nearest first</span>}
          </div>
        )}
        {props === null && <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></div>}
        {props && filtered.length === 0 && (
          <Card className="clinic-card" data-testid="field-property-empty-state">
            <CardContent className="py-12 text-center text-slate-500">
              {q
                ? `No matching properties found for "${q}".`
                : 'No assigned properties found. Ask an administrator to assign properties / upload property data.'}
            </CardContent>
          </Card>
        )}
        <div className="space-y-2.5" ref={propertyListRef}>
          {filtered.slice(0, 300).map((p) => (
            <Card
              key={p.id}
              className="clinic-card cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => chooseProperty(p)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') chooseProperty(p);
              }}
              role="button"
              tabIndex="0"
              data-testid={`field-property-${p.id}`}
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-semibold truncate" style={{ color: 'var(--phed-ink)' }}>{p.owner_name || 'Unknown owner'}</div>
                  <div className="text-xs truncate" style={{ color: 'var(--phed-muted)' }}>
                    <span className="font-mono">{p.property_id}</span> · {p.address || '—'}{p.mobile ? ` · ${p.mobile}` : ''}
                    {distTo(p) != null && <span className="ml-1 text-slate-400">· {distTo(p) < 1000 ? `${Math.round(distTo(p))} m` : `${(distTo(p) / 1000).toFixed(1)} km`}</span>}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0">{p.phed_survey_status || 'Pending'}</Badge>
              </CardContent>
            </Card>
          ))}
          {filtered.length > 300 && <div className="text-center text-xs text-slate-400 py-2">Showing nearest 300 of {filtered.length} — search to narrow down</div>}
        </div>
      </div>
    </EmployeeLayout>
  );
}

function SurveyPanel({ property, onBack, H, isAdmin }) {
  const [data, setData] = useState(null);
  const [surveyType, setSurveyType] = useState(null);
  const [survey, setSurvey] = useState(null);
  const [gps, setGps] = useState(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // search/link
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  // new consumer
  const [nc, setNc] = useState({ consumer_name: '', fh_name: '', address: property.address || '', locality: property.colony || '', phone: '', service: 'Water', connection_number: '', category: 'Domestic' });
  const attInput = useRef(null);
  const [attType, setAttType] = useState('BILL');
  const [uploading, setUploading] = useState(false);
  const [ownerMismatch, setOwnerMismatch] = useState(false);
  const [mismatchReason, setMismatchReason] = useState('');
  const [verified, setVerified] = useState(null); // Set of connection ids verified on site (null = all)
  const [connRemarks, setConnRemarks] = useState({});
  const [preview, setPreview] = useState(null); // {url, type, name}

  const allConnections = (data?.consumers || []).flatMap((c) => (c.connections || []).map((cn) => ({ ...cn, consumer_name: c.consumer_name })));
  const isVerified = (id) => verified === null || verified.has(id);
  const toggleVerified = (id) => {
    const next = new Set(verified === null ? allConnections.map((c) => c.id) : verified);
    next.has(id) ? next.delete(id) : next.add(id);
    setVerified(next);
  };
  const waterCount = allConnections.filter((c) => c.service === 'Water' && isVerified(c.id)).length;
  const sewerCount = allConnections.filter((c) => c.service === 'Sewer' && isVerified(c.id)).length;

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${PHED}/property/${property.id}`, H()); setData(data);
      if (data.survey) {
        setSurvey(data.survey); setSurveyType(data.survey.survey_type); setRemarks(data.survey.remarks || '');
        setOwnerMismatch(!!data.survey.owner_mismatch); setMismatchReason(data.survey.mismatch_reason || '');
        if (Array.isArray(data.survey.verified_connection_ids)) setVerified(new Set(data.survey.verified_connection_ids));
        setConnRemarks(data.survey.connection_remarks || {});
        if (data.survey.latitude) setGps({ latitude: data.survey.latitude, longitude: data.survey.longitude, accuracy: data.survey.gps_accuracy });
      }
    }
    catch (e) { toast.error(e.response?.data?.detail || 'Access denied'); onBack(); }
  }, [property.id]);
  useEffect(() => { load(); }, [load]);

  const ensureDraft = async (patch = {}) => {
    const body = {
      property_record_id: property.id,
      survey_type: surveyType,
      consumer_refs: (data?.consumers || []).map((c) => c.id),
      latitude: gps?.latitude, longitude: gps?.longitude, gps_accuracy: gps?.accuracy,
      gps_captured_at: gps?.ts, remarks,
      owner_mismatch: ownerMismatch, mismatch_reason: ownerMismatch ? mismatchReason : null,
      verified_connection_ids: verified === null ? null : Array.from(verified), connection_remarks: connRemarks,
      ...patch,
    };
    const { data: s } = await axios.post(`${PHED}/surveys/draft`, body, H());
    setSurvey(s); return s;
  };

  const saveDraft = async () => {
    try { await ensureDraft(); toast.success('Draft saved'); } catch (e) { toast.error(e.response?.data?.detail || 'Could not save draft'); }
  };

  const openAttachment = async (a) => {
    try {
      const res = await axios.get(`${PHED}/surveys/${survey.id}/attachments/${a.id}`, { ...H(), responseType: 'blob' });
      setPreview({ url: URL.createObjectURL(res.data), type: a.content_type, name: a.filename });
    } catch { toast.error('Could not load document'); }
  };

  const captureGps = () => {
    if (!navigator.geolocation) return toast.error('Geolocation not supported on this device');
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const g = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), ts: new Date().toISOString() };
        setGps(g); setGpsBusy(false); toast.success('Location captured');
        try { await ensureDraft({ latitude: g.latitude, longitude: g.longitude, gps_accuracy: g.accuracy, gps_captured_at: g.ts }); } catch {}
      },
      (err) => { setGpsBusy(false); toast.error(err.code === 1 ? 'Location permission denied — enable it and retry' : 'Could not get location — retry'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const doSearch = async () => {
    if (!q.trim()) return;
    setSearching(true);
    try { const { data } = await axios.get(`${PHED}/consumers/search`, { ...H(), params: { q: q.trim(), limit: 15 } }); setResults(data.results || []); }
    catch { toast.error('Search failed'); } finally { setSearching(false); }
  };

  const linkConsumer = async (ref) => {
    try { await axios.post(`${PHED}/consumers/${ref}/link`, { property_record_id: property.id, confirm: true }, H()); toast.success('Consumer linked'); setResults([]); setQ(''); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Link failed'); }
  };

  const createConsumer = async () => {
    if (!nc.consumer_name.trim()) return toast.error('Consumer name is required');
    try {
      const body = {
        consumer_name: nc.consumer_name, fh_name: nc.fh_name, ppp_id: nc.ppp_id || '', address: nc.address, locality: nc.locality, phone: nc.phone,
        category: nc.category, linked_property_id: property.id,
        connections: nc.connection_number.trim() ? [{ service: nc.service, connection_number: nc.connection_number, category: nc.category }] : [],
      };
      await axios.post(`${PHED}/consumers`, body, H());
      toast.success('New PHED consumer created & linked');
      setNc({ ...nc, consumer_name: '', fh_name: '', ppp_id: '', phone: '', connection_number: '' });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Create failed'); }
  };

  const uploadAttachment = async (rawFile) => {
    if (!rawFile) return;
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(rawFile.type)) return toast.error('Only JPEG/PNG/WebP images or PDF are allowed');
    setUploading(true);
    try {
      const file = await compressImage(rawFile);
      if (file.size > 8 * 1024 * 1024) return toast.error('File too large (max 8 MB)');
      const s = survey || await ensureDraft();
      const fd = new FormData(); fd.append('file', file); fd.append('attachment_type', attType);
      await axios.post(`${PHED}/surveys/${s.id}/attachments`, fd, { headers: { ...getAuthHeaderSafe(H) }, });
      toast.success('Document uploaded');
      const { data } = await axios.get(`${PHED}/property/${property.id}`, H()); setSurvey(data.survey);
    } catch (e) { toast.error(e.response?.data?.detail || 'Upload failed'); } finally { setUploading(false); if (attInput.current) attInput.current.value = ''; }
  };

  const removeAttachment = async (aid) => {
    try { await axios.delete(`${PHED}/surveys/${survey.id}/attachments/${aid}`, H()); const { data } = await axios.get(`${PHED}/property/${property.id}`, H()); setSurvey(data.survey); }
    catch { toast.error('Remove failed'); }
  };

  const submit = async () => {
    if (!surveyType) return toast.error('Select the PHED connection status');
    if (!gps) return toast.error('Capture GPS location first');
    if (surveyType !== 'NO_CONNECTION' && (data?.consumers || []).length === 0) return toast.error('Link or create at least one PHED consumer');
    if (ownerMismatch && !mismatchReason.trim()) return toast.error('Enter the reason for the owner mismatch');
    if (submitting) return;
    setSubmitting(true);
    try {
      const s = await ensureDraft();
      const { data: r } = await axios.post(`${PHED}/surveys/${s.id}/submit`, {}, H());
      setDone(r.status || 'Submitted'); toast.success(`PHED survey ${r.status === 'Requires Review' ? 'submitted for review' : 'submitted'}`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Submit failed'); } finally { setSubmitting(false); }
  };

  if (!data) return <EmployeeLayout title="PHED Survey"><div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></div></EmployeeLayout>;

  if (done) return (
    <EmployeeLayout title="PHED Survey">
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-8 h-8 text-green-600" /></div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--phed-ink)' }}>Survey submitted</h2>
        <p className="text-slate-500 mt-1">Property {property.property_id} recorded successfully.</p>
        <Badge variant="outline" className="mt-3" data-testid="survey-result-status">{done}</Badge>
        <div><Button className="mt-6 text-white" style={{ background: 'var(--phed-blue)' }} onClick={onBack} data-testid="survey-done-back">Back to properties</Button></div>
      </div>
    </EmployeeLayout>
  );

  const attachments = survey?.attachments || [];
  const drift = survey?.gps_drift_m;
  const locked = ['Submitted', 'Requires Review', 'Approved'].includes(survey?.status);

  return (
    <EmployeeLayout title="PHED Consumer Survey">
      <div className="max-w-3xl mx-auto space-y-4 pb-24">
        <Button variant="ghost" onClick={onBack} className="mb-1" data-testid="survey-back"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>

        {/* Property (MC master — read only) */}
        <Card className="clinic-card"><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-lg" style={{ color: 'var(--phed-ink)' }}>{property.owner_name || 'Unknown owner'}</div>
              <div className="text-xs" style={{ color: 'var(--phed-muted)' }}><span className="font-mono">{property.property_id}</span> · {property.address || '—'} · {property.colony || '—'}</div>
            </div>
            <Badge variant="outline" data-testid="phed-status-badge">{data.survey?.status || 'Not Started'}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs" style={{ color: 'var(--phed-muted)' }}>
            <div>Property ID: <span className="font-mono text-slate-700">{property.property_id}</span></div>
            <div>Ward / Colony: <span className="text-slate-700">{property.ward || '—'} / {property.colony || '—'}</span></div>
            <div>MC owner: <span className="text-slate-700">{property.owner_name || '—'}</span></div>
            <div>MC location: <span className="font-mono text-slate-700">{property.latitude != null ? `${Number(property.latitude).toFixed(5)}, ${Number(property.longitude).toFixed(5)}` : '—'}</span></div>
            {data.legacy_submission && <div className="col-span-2">Property survey status: <span className="text-slate-700">{data.legacy_submission.status}</span> <span className="text-slate-400">(separate from PHED status)</span></div>}
          </div>
          {locked && <div className="text-[11px] mt-2 text-amber-600" data-testid="survey-locked-note">This PHED survey is {survey.status} — read only.</div>}
          <div className="text-[11px] mt-2 text-slate-400">Municipal Committee ownership data — reference only, not editable here.</div>
        </CardContent></Card>

        {/* Existing PHED links */}
        <Card className="clinic-card"><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold" style={{ color: 'var(--phed-ink)' }}>Linked PHED consumers</div>
            {allConnections.length > 0 && (
              <div className="text-[11px] font-mono" data-testid="connection-counts">
                <span style={{ color: '#1565C0' }}>Water {waterCount}</span> · <span style={{ color: '#00897B' }}>Sewer {sewerCount}</span> · Total {waterCount + sewerCount}
              </div>
            )}
          </div>
          {(data.consumers || []).length === 0 ? <div className="text-xs text-slate-400">None linked yet.</div> : (
            <div className="space-y-1.5">
              {data.consumers.map((c) => (
                <div key={c.id} className="rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--phed-border)' }} data-testid={`linked-consumer-${c.id}`}>
                  <div><span className="font-medium">{c.consumer_name}</span> <span className="font-mono text-xs text-slate-500">{c.consumer_id}</span>
                    {c.provisional_ref && <Badge variant="outline" className="ml-1 text-[9px] text-amber-700 border-amber-300">New / unlisted</Badge>}
                    <span className="text-xs text-slate-500 ml-2">{c.fh_name ? `F/H: ${c.fh_name}` : ''}{c.ppp_id ? ` · PPP: ${c.ppp_id}` : ''}{c.phone_masked || c.phone ? ` · ${c.phone_masked || c.phone}` : ''}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">{c.address || '—'}{c.locality ? ` · ${c.locality}` : ''}</div>
                  <div className="mt-1.5 space-y-1">
                    {(c.connections || []).length === 0 && <div className="text-[11px] text-slate-400">No connection numbers on record.</div>}
                    {(c.connections || []).map((cn) => (
                      <label key={cn.id} className="flex items-center gap-2 text-xs" data-testid={`connection-row-${cn.id}`}>
                        <input type="checkbox" className="accent-blue-600" checked={isVerified(cn.id)} disabled={locked} onChange={() => toggleVerified(cn.id)} data-testid={`verify-conn-${cn.id}`} />
                        <Badge variant="outline" className="text-[10px] font-mono" style={cn.service === 'Water' ? { color: '#1565C0' } : { color: '#00897B' }}>
                          {cn.service === 'Water' ? <Droplet className="w-3 h-3 inline mr-0.5" /> : <Waves className="w-3 h-3 inline mr-0.5" />}{cn.connection_number}
                        </Badge>
                        <span className="text-slate-500">{cn.category}</span>
                        <span className={cn.verification_status === 'Verified' ? 'text-green-600' : 'text-slate-400'}>{cn.verification_status || 'Unverified'}</span>
                        {!locked && <Input className="h-6 text-[11px] flex-1 max-w-[180px]" placeholder="remark" value={connRemarks[cn.id] || ''} onChange={(e) => setConnRemarks({ ...connRemarks, [cn.id]: e.target.value })} />}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(data.consumers || []).length > 0 && (
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--phed-border)' }}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-amber-600" checked={ownerMismatch} disabled={locked} onChange={(e) => setOwnerMismatch(e.target.checked)} data-testid="owner-mismatch-toggle" />
                Property owner differs from PHED bill owner <span className="text-[11px] text-slate-400">(neither record is changed)</span>
              </label>
              {ownerMismatch && (
                <Input className="mt-2 h-9" placeholder="Reason (e.g. tenant, sold, family member) *" value={mismatchReason} disabled={locked} onChange={(e) => setMismatchReason(e.target.value)} data-testid="mismatch-reason-input" />
              )}
            </div>
          )}
        </CardContent></Card>

        {/* Step 1: status */}
        <Card className="clinic-card"><CardContent className="p-4">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--phed-ink)' }}>Does this property have a PHED Water/Sewer connection?</div>
          <div className="grid sm:grid-cols-3 gap-2">
            {STATUS_OPTS.map(([v, l, Icon]) => (
              <button key={v} onClick={() => setSurveyType(v)} data-testid={`survey-type-${v}`}
                className={`rounded-xl border p-3 text-left transition-all ${surveyType === v ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}>
                <Icon className="w-5 h-5 mb-1" style={{ color: 'var(--phed-blue)' }} />
                <div className="text-xs font-medium" style={{ color: 'var(--phed-ink)' }}>{l}</div>
              </button>
            ))}
          </div>
        </CardContent></Card>

        {/* Step 2: link existing */}
        {surveyType === 'EXISTING_LINKED' && (
          <Card className="clinic-card"><CardContent className="p-4">
            <div className="text-sm font-semibold mb-2" style={{ color: 'var(--phed-ink)' }}>Search & link existing consumer</div>
            <div className="flex gap-2">
              <Input placeholder="Consumer ID, connection no., phone, name" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} data-testid="link-search-input" />
              <Button onClick={doSearch} disabled={searching} style={{ background: 'var(--phed-blue)' }} className="text-white shrink-0" data-testid="link-search-btn">{searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</Button>
            </div>
            <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
              {results.map((c) => (
                <div key={c.id} className="rounded-lg border p-2.5 flex items-center justify-between" style={{ borderColor: 'var(--phed-border)' }} data-testid={`search-result-${c.id}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.consumer_name} <span className="font-mono text-xs text-slate-500">{c.consumer_id}</span> {c.match === 'exact' && <Badge className="text-[9px] bg-green-100 text-green-700 ml-1">exact</Badge>}</div>
                    <div className="text-xs text-slate-500 truncate">{c.fh_name || '—'} · {c.locality || '—'} · {(c.connections || []).map((x) => x.connection_number).join(', ') || 'no conn.'}</div>
                  </div>
                  <Button size="sm" onClick={() => linkConsumer(c.id)} style={{ background: 'var(--phed-teal)' }} className="text-white shrink-0" data-testid={`link-btn-${c.id}`}><Link2 className="w-4 h-4" /></Button>
                </div>
              ))}
            </div>
          </CardContent></Card>
        )}

        {/* Step 2b: create new/unlisted */}
        {surveyType === 'NEW_UNLISTED' && (
          <Card className="clinic-card"><CardContent className="p-4">
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--phed-ink)' }}>Create new / unlisted consumer</div>
            <div className="text-[11px] text-slate-400 mb-3">Marked as survey-created with a provisional reference (no official Consumer ID assigned).</div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <div><Label className="text-xs">Consumer name *</Label><Input value={nc.consumer_name} onChange={(e) => setNc({ ...nc, consumer_name: e.target.value })} data-testid="new-consumer-name" /></div>
              <div><Label className="text-xs">Father/Husband name</Label><Input value={nc.fh_name} onChange={(e) => setNc({ ...nc, fh_name: e.target.value })} /></div>
              <div><Label className="text-xs">Head of Family PPP ID</Label><Input value={nc.ppp_id || ''} onChange={(e) => setNc({ ...nc, ppp_id: e.target.value })} data-testid="new-consumer-ppp" /></div>
              <div><Label className="text-xs">Phone</Label><Input value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></div>
              <div><Label className="text-xs">Locality</Label><Input value={nc.locality} onChange={(e) => setNc({ ...nc, locality: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label className="text-xs">Address</Label><Input value={nc.address} onChange={(e) => setNc({ ...nc, address: e.target.value })} /></div>
              <div><Label className="text-xs">Service</Label>
                <Select value={nc.service} onValueChange={(v) => setNc({ ...nc, service: v })}><SelectTrigger data-testid="new-consumer-service"><SelectValue /></SelectTrigger><SelectContent>{SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><Label className="text-xs">Connection number</Label><Input value={nc.connection_number} onChange={(e) => setNc({ ...nc, connection_number: e.target.value })} data-testid="new-consumer-conn" /></div>
              <div><Label className="text-xs">Category</Label>
                <Select value={nc.category} onValueChange={(v) => setNc({ ...nc, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
            <Button onClick={createConsumer} className="mt-3 text-white" style={{ background: 'var(--phed-teal)' }} data-testid="create-consumer-btn"><UserPlus className="w-4 h-4 mr-1.5" /> Create & link</Button>
          </CardContent></Card>
        )}

        {/* GPS */}
        <Card className="clinic-card"><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold" style={{ color: 'var(--phed-ink)' }}>GPS location *</div>
            <Button size="sm" variant="outline" onClick={captureGps} disabled={gpsBusy} data-testid="capture-gps-btn">
              {gpsBusy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Crosshair className="w-4 h-4 mr-1.5" />} {gps ? 'Recapture' : 'Capture'}
            </Button>
          </div>
          {gps ? (
            <div className="text-xs mt-2 font-mono text-slate-600" data-testid="gps-value">
              {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)} (±{gps.accuracy}m)
              {drift != null && drift > 100 && <span className="text-amber-600 ml-2"><AlertTriangle className="w-3 h-3 inline" /> {drift}m from property point</span>}
            </div>
          ) : <div className="text-xs mt-2 text-slate-400">Not captured yet.</div>}
        </CardContent></Card>

        {/* Documents */}
        <Card className="clinic-card"><CardContent className="p-4">
          <div className="text-sm font-semibold mb-2" style={{ color: 'var(--phed-ink)' }}>Documents</div>
          <div className="flex gap-2 items-center">
            <Select value={attType} onValueChange={setAttType}><SelectTrigger className="w-40" data-testid="att-type-select"><SelectValue /></SelectTrigger><SelectContent>{ATT_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
            <input ref={attInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="hidden" onChange={(e) => uploadAttachment(e.target.files[0])} data-testid="att-file-input" />
            <Button variant="outline" onClick={() => attInput.current?.click()} disabled={uploading || locked} data-testid="att-upload-btn">{uploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Camera className="w-4 h-4 mr-1.5" />} Add</Button>
          </div>
          <div className="mt-2 space-y-1">
            {attachments.length === 0 && <div className="text-xs text-slate-400">No documents attached.</div>}
            {attachments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs rounded-lg border p-2" style={{ borderColor: 'var(--phed-border)' }} data-testid={`attachment-${a.id}`}>
                <button type="button" className="text-left truncate hover:underline" onClick={() => openAttachment(a)} data-testid={`attachment-view-${a.id}`}>
                  <FileText className="w-3.5 h-3.5 inline mr-1 text-slate-400" />{ATT_TYPES.find((t) => t[0] === a.attachment_type)?.[1] || a.attachment_type} · {Math.round((a.size || 0) / 1024)} KB
                </button>
                {!locked && <Button size="sm" variant="ghost" className="h-6 text-red-500" onClick={() => removeAttachment(a.id)} data-testid={`attachment-remove-${a.id}`}><X className="w-3.5 h-3.5" /></Button>}
              </div>
            ))}
          </div>
          {preview && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }} data-testid="attachment-preview">
              {preview.type === 'application/pdf' ? <iframe title={preview.name} src={preview.url} className="w-full h-full max-w-3xl bg-white rounded" />
                : <img src={preview.url} alt={preview.name} className="max-h-full max-w-full rounded" />}
            </div>
          )}
        </CardContent></Card>

        {/* Remarks */}
        <Card className="clinic-card"><CardContent className="p-4">
          <Label className="text-sm font-semibold" style={{ color: 'var(--phed-ink)' }}>Remarks</Label>
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any notes for review…" className="mt-2" data-testid="survey-remarks" />
        </CardContent></Card>

        {/* Submit */}
        <div className="fixed bottom-16 left-0 right-0 p-3 bg-white/95 backdrop-blur border-t z-20" style={{ borderColor: 'var(--phed-border)' }}>
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <div className="text-xs text-slate-500 flex-1">
              {surveyType ? <Badge variant="outline" className="mr-1">{STATUS_OPTS.find((o) => o[0] === surveyType)?.[1]}</Badge> : 'Select status'}
              {gps && <Badge variant="outline" className="text-green-600">GPS ✓</Badge>}
            </div>
            {!locked && <Button variant="outline" onClick={saveDraft} className="h-11" data-testid="save-draft-btn">Save draft</Button>}
            <Button onClick={submit} disabled={submitting || locked} className="text-white h-11 px-6" style={{ background: 'var(--phed-blue)' }} data-testid="submit-survey-btn">
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />} {locked ? survey.status : 'Submit survey'}
            </Button>
          </div>
        </div>
      </div>
    </EmployeeLayout>
  );
}

function getAuthHeaderSafe(H) {
  return { ...(H().headers || {}), 'Content-Type': 'multipart/form-data' };
}
