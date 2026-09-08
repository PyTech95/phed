import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent } from '../../components/ui/card';
import { ArrowLeft, Camera, CheckCircle2, Droplet, Ban, Loader2, MapPin, RefreshCw, Search, Waves, UserCheck, UserX, FileText, X, ChevronRight, Repeat, Lock } from 'lucide-react';
import EmployeeLayout from '../../components/EmployeeLayout';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = `${API_URL}/phed`;

const DOC_LABELS = {
  APPLICATION: 'Application (आवेदन) की photo',
  AADHAAR: 'Aadhaar card',
  AADHAAR_FRONT: 'Aadhaar — Front',
  AADHAAR_BACK: 'Aadhaar — Back',
  PROPERTY_PROOF: 'Property proof',
  PROPERTY_FRONT: 'Property photo',
  HOUSE_PHOTO: 'House photo (owner/applicant के साथ)',
  DEATH_CERTIFICATE: 'Death certificate',
};

async function compressImage(file) {
  if (!file.type.startsWith('image/')) return file; // keep PDFs as-is
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const MAX = 3200; // HD — keep registry text readable
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) return file; // already within HD bounds — upload original
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
  return blob ? new File([blob], 'doc.jpg', { type: 'image/jpeg' }) : file;
}

function distanceM(a, b) {
  if (!a || !b || a.latitude == null || b.latitude == null) return null;
  const R = 6371000, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.latitude - a.latitude), dLng = toR(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.latitude)) * Math.cos(toR(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const connsOf = (c, service) => (c.connections || []).filter((x) => x.service === service).map((x) => x.connection_number).filter(Boolean);
const Row = ({ label, value }) => (
  <div className="flex justify-between gap-3 py-1 border-b last:border-0" style={{ borderColor: 'var(--phed-border)' }}>
    <span className="text-xs text-slate-500 shrink-0">{label}</span>
    <span className="text-sm font-medium text-right" style={{ color: 'var(--phed-ink)' }}>{value || '—'}</span>
  </div>
);

// mode: 'yes' | 'denied' | 'no' ; ownerChange: null | 'DEATH_TRANSFER' | 'OWNERSHIP_CHANGE'
function requiredDocs(mode, ownerChange, hasBoth) {
  if (mode === 'no') return [['APPLICATION', true], ['AADHAAR', true], ['PROPERTY_PROOF', true], ['HOUSE_PHOTO', true]];
  if (mode === 'yes') {
    if (ownerChange === 'DEATH_TRANSFER') return [['APPLICATION', true], ['AADHAAR', true], ['PROPERTY_PROOF', true], ['HOUSE_PHOTO', true], ['DEATH_CERTIFICATE', true]];
    if (ownerChange === 'OWNERSHIP_CHANGE') return [['APPLICATION', true], ['AADHAAR', true], ['PROPERTY_PROOF', true], ['HOUSE_PHOTO', true]];
    if (hasBoth) return [];
    return [['APPLICATION', true], ['AADHAAR', true], ['PROPERTY_PROOF', false]]; // only water, no sewer
  }
  return [];
}

export default function WaterSurveyPanel({ property, onBack, onNext, H }) {
  const [survey, setSurvey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null); // yes | denied | no
  const [ownerChange, setOwnerChange] = useState(null);
  // picked PHED consumer (read-only)
  const [picked, setPicked] = useState(null);
  const [waterNos, setWaterNos] = useState([]);
  const [sewerNos, setSewerNos] = useState([]);
  // contact
  const [mobile, setMobile] = useState(property.mobile || '');
  const [altMobile, setAltMobile] = useState('');
  // new connection fields
  const [nc, setNc] = useState({ owner_name: property.owner_name || '', ward: property.ward || '', address: property.address || '', locality: property.colony || '', service: 'Both', category: 'Domestic', relationship: '', change_reason: '' });
  // Common relationships for Death transfer (मृतक owner से रिश्ता); last option = Other (type free text)
  const REL_OPTIONS = ['बेटा (Son)', 'बेटी (Daughter)', 'पत्नी (Wife)', 'पति (Husband)', 'पिता (Father)', 'माता (Mother)', 'भाई (Brother)', 'बहन (Sister)', 'पोता (Grandson)', 'पोती (Granddaughter)', 'बहू (Daughter-in-law)', 'दामाद (Son-in-law)'];
  const [relOther, setRelOther] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [deniedReason, setDeniedReason] = useState(null); // 'SELF' | 'TENANT' | 'OTHER'
  const [docs, setDocs] = useState({}); // type -> File (single-file docs)
  const [aadhaar, setAadhaar] = useState({ front: null, back: null }); // two photos
  const [proofPages, setProofPages] = useState([]); // Property proof: multiple pages (File[])
  const [gps, setGps] = useState(null);
  const [gpsErr, setGpsErr] = useState(null);
  const watchRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [doneRef, setDoneRef] = useState(null);
  // typeahead
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const fileRefs = useRef({});

  const captureGps = useCallback(() => {
    if (!navigator.geolocation) return setGpsErr('GPS not supported');
    setGpsErr(null);
    const onOk = (p) => {
      const acc = Math.round(p.coords.accuracy);
      setGps((prev) => (prev && prev.accuracy != null && prev.accuracy <= acc
        ? prev
        : { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: acc, ts: new Date().toISOString() }));
      setGpsErr(null);
    };
    const onErr = (e) => setGpsErr(e.code === 1 ? 'Location permission band hai — browser me allow karein' : 'Location abhi nahi mili — dobara "Retry GPS" dabayein');
    // 1) fast attempt: accept a recent cached fix so the field is usable quickly
    navigator.geolocation.getCurrentPosition(onOk, () => {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
    // 2) precise attempt
    navigator.geolocation.getCurrentPosition(onOk, onErr, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    // 3) keep improving in the background
    if (watchRef.current == null) {
      watchRef.current = navigator.geolocation.watchPosition(onOk, () => {}, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
    }
  }, []);
  useEffect(() => () => { if (watchRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current); }, []);

  useEffect(() => {
    captureGps();
    axios.get(`${PHED}/property/${property.id}`, H()).then(({ data }) => {
      const s = data.survey;
      setSurvey(s);
      // Reopen: hydrate saved answers so a Document Pending / Draft survey can be completed
      if (s && ['Document Pending', 'Draft'].includes(s.status)) {
        const w = s.water || {};
        const m = w.property_locked ? 'locked' : (w.owner_denied ? 'denied' : (w.new_connection ? 'no' : (w.has_connection ? 'yes' : null)));
        if (m) setMode(m);
        if (w.denial_reason) setDeniedReason(w.denial_reason);
        if (w.has_connection && (w.consumer_id || w.consumer_name)) {
          setPicked({ id: w.consumer_ref || null, consumer_id: w.consumer_id || '', consumer_name: w.consumer_name || property.owner_name, category: w.category || 'Domestic', phone: w.phone || w.mobile || '' });
          setWaterNos(w.connection_numbers || []);
          setSewerNos(w.sewer_connection_numbers || []);
        }
        if (w.owner_change) setOwnerChange(w.owner_change);
        if (w.mobile || w.phone) setMobile(w.mobile || w.phone);
        if (w.alternate_mobile) setAltMobile(w.alternate_mobile);
        setNc((n) => ({ ...n, owner_name: w.new_owner_name || n.owner_name, ward: w.new_ward || n.ward, address: w.new_address || n.address, locality: w.new_locality || n.locality, service: w.requested_service || n.service, category: w.connection_category || n.category, relationship: w.relationship || n.relationship, change_reason: w.ownership_change_reason || n.change_reason }));
        if (s.remarks) setRemarks(s.remarks);
      }
    }).catch((e) => { toast.error(e.response?.data?.detail || 'Access denied'); onBack(); }).finally(() => setLoading(false));
  }, [property.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // live typeahead (debounced)
  useEffect(() => {
    if (mode !== 'yes' || picked || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await axios.get(`${PHED}/consumers/search`, { ...H(), params: { q: q.trim(), limit: 12 } });
        setResults(data.results || []);
      } catch { /* ignore */ } finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, mode, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickConsumer = (c) => {
    setPicked(c);
    setWaterNos(connsOf(c, 'Water'));
    setSewerNos(connsOf(c, 'Sewer'));
    if (c.phone || c.phone_masked) setMobile(c.phone || c.phone_masked);
    setResults([]); setQ('');
    toast.success('PHED record से details भर गए');
  };
  const clearPicked = () => { setPicked(null); setWaterNos([]); setSewerNos([]); setOwnerChange(null); };

  const locked = ['Submitted', 'Requires Review', 'Approved'].includes(survey?.status);
  const isReopen = survey?.status === 'Document Pending';
  const existingDocTypes = new Set((survey?.attachments || []).map((a) => a.attachment_type));
  const dist = distanceM(gps, property);
  const propHasLoc = property.latitude != null && property.longitude != null;
  // Never block submit on GPS: fall back to the property's own recorded location.
  const effGps = gps || (propHasLoc ? { latitude: property.latitude, longitude: property.longitude, accuracy: null, ts: new Date().toISOString(), fromProperty: true } : null);
  const hasBoth = waterNos.length > 0 && sewerNos.length > 0;
  const appLabel = mode === 'no'
    ? `New connection application (${nc.service})`
    : ownerChange === 'DEATH_TRANSFER' ? 'Death transfer application'
    : ownerChange === 'OWNERSHIP_CHANGE' ? 'Ownership change application'
    : (waterNos.length > 0 && sewerNos.length === 0) ? 'Sewer connection application'
    : (sewerNos.length > 0 && waterNos.length === 0) ? 'Water connection application'
    : DOC_LABELS.APPLICATION;
  const reqDocs = requiredDocs(mode, ownerChange, hasBoth);
  const isSatisfied = (type) => {
    if (type === 'AADHAAR') {
      return (aadhaar.front && aadhaar.back)
        || (existingDocTypes.has('AADHAAR_FRONT') && existingDocTypes.has('AADHAAR_BACK'))
        || existingDocTypes.has('AADHAAR');
    }
    if (type === 'PROPERTY_PROOF') return proofPages.length > 0 || existingDocTypes.has('PROPERTY_PROOF');
    return !!docs[type] || existingDocTypes.has(type);
  };
  const missingCompulsory = reqDocs.filter(([t, req]) => req && !isSatisfied(t)).map(([t]) => t);

  const setDoc = (type, file) => setDocs((d) => ({ ...d, [type]: file || undefined }));

  const submit = async () => {
    if (!mode) return toast.error('बताइए — पानी का connection है, नहीं है, owner ने मना किया, या property locked है?');
    if (!effGps) return toast.error('Location नहीं मिली — "Retry GPS" दबाइए या map/property location चुनें');
    if (mode === 'yes' && !mobile.trim()) return toast.error('Mobile number ज़रूरी है');
    if (mode === 'no' && !nc.owner_name.trim()) return toast.error('Owner का नाम ज़रूरी है');
    if (mode === 'no' && !mobile.trim()) return toast.error('Owner का mobile number ज़रूरी है');
    if (mode === 'no' && !nc.locality.trim()) return toast.error('Colony / locality ज़रूरी है');
    if (mode === 'denied' && !deniedReason) return toast.error('मना करने का कारण चुनें');
    if (mode === 'denied' && deniedReason === 'OTHER' && !remarks.trim()) return toast.error('Other कारण लिखें');
    if (mode === 'yes' && ownerChange && !nc.owner_name.trim()) return toast.error('New owner का नाम ज़रूरी है');
    if (mode === 'yes' && ownerChange === 'DEATH_TRANSFER' && !nc.relationship.trim()) return toast.error('मृतक से रिश्ता ज़रूरी है');
    if (mode === 'yes' && ownerChange === 'OWNERSHIP_CHANGE' && !nc.change_reason.trim()) return toast.error('Ownership बदलने का कारण ज़रूरी है');
    if (submitting) return;
    setSubmitting(true);
    try {
      const docPending = missingCompulsory.length > 0;
      const water = {
        has_connection: mode === 'yes', owner_denied: mode === 'denied', new_connection: mode === 'no',
        property_locked: mode === 'locked', denial_reason: mode === 'denied' ? deniedReason : null,
        consumer_ref: picked?.id || null, consumer_id: picked?.consumer_id || '', consumer_name: picked?.consumer_name || property.owner_name || '',
        phone: mobile.trim(), mobile: mobile.trim(), alternate_mobile: altMobile.trim(),
        connection_numbers: waterNos, sewer_connection_numbers: sewerNos, has_sewer: sewerNos.length > 0,
        category: picked?.category || 'Domestic', owner_change: ownerChange,
        new_owner_name: mode === 'no' ? nc.owner_name.trim() : (ownerChange ? nc.owner_name.trim() : null),
        relationship: ownerChange === 'DEATH_TRANSFER' ? nc.relationship.trim() : null,
        ownership_change_reason: ownerChange === 'OWNERSHIP_CHANGE' ? nc.change_reason.trim() : null,
        new_ward: mode === 'no' ? nc.ward.trim() : null, new_address: mode === 'no' ? nc.address.trim() : null,
        new_locality: mode === 'no' ? nc.locality.trim() : null,
        requested_service: mode === 'no' ? nc.service : null, connection_category: mode === 'no' ? nc.category : (picked?.category || null),
        required_docs: reqDocs.map(([t]) => t), document_pending: docPending, missing_documents: missingCompulsory,
      };
      const body = {
        property_record_id: property.id,
        survey_type: mode === 'no' ? 'NO_CONNECTION' : 'WATER_CONNECTION',
        latitude: effGps.latitude, longitude: effGps.longitude, gps_accuracy: effGps.accuracy, gps_captured_at: effGps.ts,
        surveyor_latitude: effGps.latitude, surveyor_longitude: effGps.longitude,
        remarks: remarks || null, consumer_refs: picked ? [picked.id] : [], water,
      };
      const { data: s } = await axios.post(`${PHED}/surveys/draft`, body, H());
      const upload = async (file, type) => {
        const fd = new FormData(); fd.append('file', await compressImage(file)); fd.append('attachment_type', type);
        await axios.post(`${PHED}/surveys/${s.id}/attachments`, fd, { headers: { ...H().headers } });
      };
      for (const [type, file] of Object.entries(docs)) {
        if (!file) continue;
        await upload(file, type);
      }
      if (aadhaar.front) await upload(aadhaar.front, 'AADHAAR_FRONT');
      if (aadhaar.back) await upload(aadhaar.back, 'AADHAAR_BACK');
      for (const pg of proofPages) await upload(pg, 'PROPERTY_PROOF');
      const { data: r } = await axios.post(`${PHED}/surveys/${s.id}/submit`, {}, H());
      setDone(r.status || 'Submitted');
      setDoneRef(r.reference_number || null);
      toast.success(docPending ? `Document pending में submit हुआ · ${r.reference_number || ''}` : `Survey submit हो गया · ${r.reference_number || ''}`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Submit failed'); } finally { setSubmitting(false); }
  };

  if (loading) return <EmployeeLayout title="Water Bill Survey"><div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></div></EmployeeLayout>;

  if (done) return (
    <EmployeeLayout title="Water Bill Survey">
      <div className="max-w-md mx-auto text-center py-12" data-testid="water-survey-done">
        <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-8 h-8 text-green-600" /></div>
        <h2 className="text-xl font-bold" style={{ color: 'var(--phed-ink)' }}>Survey submitted</h2>
        <p className="text-sm text-slate-500 mt-1">{property.property_id} · {property.owner_name}</p>
        {doneRef && (
          <div className="mt-3 inline-flex flex-col items-center rounded-xl border-2 border-dashed px-5 py-2.5" style={{ borderColor: 'var(--phed-blue)' }} data-testid="reference-number">
            <span className="text-[11px] text-slate-500">Reference number</span>
            <span className="text-2xl font-extrabold tracking-wider" style={{ color: 'var(--phed-blue)' }}>{doneRef}</span>
          </div>
        )}
        <div className="mt-3"><Badge variant="outline" data-testid="survey-result-status">{done}</Badge></div>
        <div className="grid gap-2 mt-6">
          {onNext && <Button className="h-12 text-white" style={{ background: 'var(--phed-blue)' }} onClick={onNext} data-testid="next-pending-btn">अगली property <ChevronRight className="w-4 h-4 ml-1" /></Button>}
          <Button variant="outline" className="h-11" onClick={onBack} data-testid="survey-done-back">Back to list</Button>
        </div>
      </div>
    </EmployeeLayout>
  );

  const MobileFields = (
    <div className="grid grid-cols-2 gap-2">
      <div><div className="text-xs font-medium mb-1 text-slate-600">Mobile number *</div><Input className="h-11" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} data-testid="mobile-input" placeholder="ज़रूरी" /></div>
      <div><div className="text-xs font-medium mb-1 text-slate-600">Alternate number</div><Input className="h-11" inputMode="tel" value={altMobile} onChange={(e) => setAltMobile(e.target.value)} data-testid="alt-mobile-input" placeholder="optional" /></div>
    </div>
  );

  const DocSlot = ([type, req]) => {
    const already = existingDocTypes.has(type);
    return (
    <div key={type} className="flex items-center justify-between gap-2 rounded-lg border p-2.5" style={{ borderColor: (docs[type] || already) ? '#16a34a' : 'var(--phed-border)' }} data-testid={`doc-slot-${type}`}>
      <div className="min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: 'var(--phed-ink)' }}>
          <FileText className="w-3.5 h-3.5 inline mr-1 text-slate-400" />{type === 'APPLICATION' ? appLabel : DOC_LABELS[type]} {req ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}
        </div>
        {docs[type] && (docs[type].type?.startsWith('image/')
          ? <img src={URL.createObjectURL(docs[type])} alt={type} className="mt-1 w-16 h-16 object-cover rounded-md border" style={{ borderColor: 'var(--phed-border)' }} data-testid={`doc-thumb-${type}`} />
          : <div className="text-[11px] text-green-600 truncate">📄 {docs[type].name}</div>)}
        {!docs[type] && already && <div className="text-[11px] text-green-600 truncate">✓ पहले upload हो चुका — बदलने के लिए camera दबाएँ</div>}
      </div>
      <input ref={(el) => (fileRefs.current[type] = el)} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => setDoc(type, e.target.files[0])} data-testid={`doc-input-${type}`} />
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="outline" size="sm" className="h-9" onClick={() => fileRefs.current[type]?.click()} data-testid={`doc-btn-${type}`}><Camera className="w-4 h-4" /></Button>
        {docs[type] && <button type="button" className="text-red-500" onClick={() => setDoc(type, null)}><X className="w-4 h-4" /></button>}
      </div>
    </div>
    );
  };

  const AadhaarSlot = ([, req]) => {
    const haveFrontOld = existingDocTypes.has('AADHAAR_FRONT') || existingDocTypes.has('AADHAAR');
    const haveBackOld = existingDocTypes.has('AADHAAR_BACK') || existingDocTypes.has('AADHAAR');
    const Side = (side, label, oldHas) => (
      <div className="flex-1 rounded-lg border p-2.5" style={{ borderColor: (aadhaar[side] || oldHas) ? '#16a34a' : 'var(--phed-border)' }}>
        <div className="text-[11px] font-medium mb-1" style={{ color: 'var(--phed-ink)' }}>{label}</div>
        <input ref={(el) => (fileRefs.current[`AADHAAR_${side}`] = el)} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => setAadhaar((a) => ({ ...a, [side]: e.target.files[0] || null }))} data-testid={`aadhaar-${side}-input`} />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => fileRefs.current[`AADHAAR_${side}`]?.click()} data-testid={`aadhaar-${side}-btn`}><Camera className="w-4 h-4 mr-1" /> Photo</Button>
          {aadhaar[side] && <button type="button" className="text-red-500" onClick={() => setAadhaar((a) => ({ ...a, [side]: null }))}><X className="w-4 h-4" /></button>}
        </div>
        {aadhaar[side] && (
          <div className="mt-1.5">
            {aadhaar[side].type?.startsWith('image/')
              ? <img src={URL.createObjectURL(aadhaar[side])} alt={label} className="w-full h-24 object-cover rounded-md border" style={{ borderColor: 'var(--phed-border)' }} data-testid={`aadhaar-${side}-thumb`} />
              : <div className="text-[10px] text-green-600 truncate">📄 {aadhaar[side].name}</div>}
          </div>
        )}
        {!aadhaar[side] && oldHas && <div className="text-[10px] text-green-600 truncate mt-1">✓ पहले upload हो चुका</div>}
      </div>
    );
    return (
      <div key="AADHAAR" className="rounded-lg" data-testid="doc-slot-AADHAAR">
        <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--phed-ink)' }}>
          <FileText className="w-3.5 h-3.5 inline mr-1 text-slate-400" />Aadhaar card — front & back {req ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}
        </div>
        <div className="flex gap-2">{Side('front', 'Front', haveFrontOld)}{Side('back', 'Back', haveBackOld)}</div>
      </div>
    );
  };

  const ProofSlot = ([, req]) => {
    const oldCount = (survey?.attachments || []).filter((a) => a.attachment_type === 'PROPERTY_PROOF').length;
    return (
      <div key="PROPERTY_PROOF" className="rounded-lg border p-2.5" style={{ borderColor: (proofPages.length || oldCount) ? '#16a34a' : 'var(--phed-border)' }} data-testid="doc-slot-PROPERTY_PROOF">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium" style={{ color: 'var(--phed-ink)' }}>
            <FileText className="w-3.5 h-3.5 inline mr-1 text-slate-400" />Property proof / Registry {req ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}
          </div>
          <span className="text-[10px] text-slate-400">{proofPages.length} नया{oldCount ? ` · ${oldCount} पुराना` : ''}</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">रजिस्ट्री के सारे page (5-7) एक-एक करके add करें — download में एक ही PDF बनेगा।</div>
        <input ref={(el) => (fileRefs.current.PROPERTY_PROOF = el)} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={(e) => { setProofPages((p) => [...p, ...Array.from(e.target.files)]); e.target.value = ''; }} data-testid="proof-add-input" />
        {proofPages.length > 0 && (
          <div className="mt-2 space-y-1">
            {proofPages.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] rounded bg-slate-50 px-2 py-1" data-testid={`proof-page-${i}`}>
                <span className="flex items-center gap-1.5 truncate text-green-700">
                  {f.type?.startsWith('image/')
                    ? <img src={URL.createObjectURL(f)} alt={`page ${i + 1}`} className="w-8 h-8 object-cover rounded border" style={{ borderColor: 'var(--phed-border)' }} data-testid={`proof-thumb-${i}`} />
                    : <span>📄</span>}
                  <span className="truncate">Page {i + 1} — {f.name}</span>
                </span>
                <button type="button" className="text-red-500 shrink-0 ml-2" onClick={() => setProofPages((p) => p.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" className="h-9 w-full mt-2" onClick={() => fileRefs.current.PROPERTY_PROOF?.click()} data-testid="proof-add-btn"><Camera className="w-4 h-4 mr-1" /> Page add करें</Button>
      </div>
    );
  };

  const renderDoc = ([type, req]) => {
    if (type === 'AADHAAR') return AadhaarSlot([type, req]);
    if (type === 'PROPERTY_PROOF') return ProofSlot([type, req]);
    return DocSlot([type, req]);
  };


  return (
    <EmployeeLayout title="Water Bill Survey">
      <div className="max-w-md mx-auto space-y-3 pb-44" data-testid="water-survey-panel">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2" data-testid="water-survey-back"><ArrowLeft className="w-4 h-4 mr-1" /> Properties</Button>

        {/* Property info — read only */}
        <Card className="clinic-card"><CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="font-semibold" style={{ color: 'var(--phed-ink)' }} data-testid="water-owner-name">{property.owner_name || 'Unknown owner'}</div>
            <Badge variant="outline" data-testid="phed-status-badge">{survey?.status || 'Not Started'}</Badge>
          </div>
          <Row label="Property ID" value={<span className="font-mono" data-testid="water-property-id">{property.property_id}</span>} />
          <Row label="Address" value={property.address} />
          <Row label="Colony" value={property.colony} />
          <Row label="Mobile" value={property.mobile} />
          <div className="mt-3 flex items-center justify-between text-xs rounded-lg px-3 py-2" style={{ background: 'var(--phed-bg)' }} data-testid="gps-box">
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" style={{ color: gps ? '#2E7D32' : (propHasLoc ? '#B45309' : '#C62828') }} />
              {gps
                ? <>GPS ✓ ±{gps.accuracy} m{dist != null && <span className="text-slate-500"> · {dist} m दूर</span>}</>
                : (propHasLoc ? <span className="text-amber-700">GPS नहीं मिली — property location से submit होगा</span> : (gpsErr || 'Getting location…'))}
            </span>
            <button type="button" className="text-blue-700 flex items-center gap-1" onClick={captureGps} data-testid="retry-gps-btn"><RefreshCw className="w-3 h-3" /> Retry GPS</button>
          </div>
          {locked && <div className="text-[11px] mt-2 text-amber-600" data-testid="survey-locked-note">यह survey {survey.status} है — बदला नहीं जा सकता।</div>}
        </CardContent></Card>

        {/* Reopen banner for Document Pending */}
        {isReopen && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800" data-testid="reopen-banner">
            <div className="font-semibold flex items-center gap-1.5"><FileText className="w-4 h-4" /> यह survey <b>Document Pending</b> है — बाकी document लगाकर पूरा करें।</div>
            {survey?.return_reason && <div className="mt-1">Admin note: {survey.return_reason}</div>}
            {(survey?.water?.missing_documents || []).length > 0 && (
              <div className="mt-1">बाकी documents: {(survey.water.missing_documents).map((t) => DOC_LABELS[t] || t).join(', ')}</div>
            )}
          </div>
        )}

        {/* Q1 */}
        <Card className="clinic-card"><CardContent className="p-4">
          <div className="text-sm font-semibold mb-2" style={{ color: 'var(--phed-ink)' }}>क्या इस property में पानी (water) connection है?</div>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" disabled={locked} onClick={() => { setMode('yes'); }} data-testid="water-yes-btn"
              className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-1 text-xs font-semibold ${mode === 'yes' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>
              <Droplet className="w-5 h-5" /> हाँ, है
            </button>
            <button type="button" disabled={locked} onClick={() => { setMode('denied'); clearPicked(); }} data-testid="owner-denied-btn"
              className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-1 text-xs font-semibold ${mode === 'denied' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}>
              <UserX className="w-5 h-5" /> Owner denied
            </button>
            <button type="button" disabled={locked} onClick={() => { setMode('no'); clearPicked(); }} data-testid="water-no-btn"
              className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-1 text-xs font-semibold ${mode === 'no' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600'}`}>
              <Ban className="w-5 h-5" /> नहीं (new)
            </button>
          </div>
          <button type="button" disabled={locked} onClick={() => { setMode('locked'); clearPicked(); setDeniedReason(null); }} data-testid="property-locked-btn"
            className={`mt-2 w-full h-12 rounded-xl border-2 flex items-center justify-center gap-2 text-sm font-semibold ${mode === 'locked' ? 'border-slate-700 bg-slate-100 text-slate-800' : 'border-slate-200 text-slate-600'}`}>
            <Lock className="w-4 h-4" /> Property बंद / locked मिली
          </button>
          {mode === 'denied' && (
            <div className="mt-3 space-y-2" data-testid="denied-reason-box">
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5">Owner ने मना किया — नीचे कारण चुनें, फिर submit करें।</div>
              {[['SELF', 'Owner खुद मना कर रहा है'], ['TENANT', 'किराएदार (rent) रह रहे हैं — उन्होंने मना किया'], ['OTHER', 'Other — कारण खुद लिखें']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => setDeniedReason(val)} data-testid={`denied-reason-${val.toLowerCase()}`}
                  className={`w-full text-left rounded-lg border px-3 py-2.5 text-xs font-medium ${deniedReason === val ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600'}`}>{label}</button>
              ))}
              {deniedReason === 'OTHER' && (
                <Input className="h-11" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="मना करने का कारण लिखें…" data-testid="denied-other-input" />
              )}
            </div>
          )}
          {mode === 'locked' && <div className="mt-3 text-xs text-slate-700 bg-slate-100 rounded-lg p-2.5" data-testid="locked-note">Property बंद/locked मिली — सीधे submit करें। (चाहें तो नीचे remark में detail लिखें।)</div>}
        </CardContent></Card>

        {/* YES branch */}
        {mode === 'yes' && (
          <Card className="clinic-card"><CardContent className="p-4 space-y-3" data-testid="water-yes-details">
            {!picked && !locked && (
              <div>
                <div className="text-xs font-medium mb-1 text-slate-600">Consumer खोजें — नाम / मोबाइल / connection no. / Consumer ID</div>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-3.5 text-slate-400" />
                  {searching && <Loader2 className="w-4 h-4 absolute right-3 top-3.5 animate-spin text-slate-400" />}
                  <Input className="pl-9 h-11" placeholder="टाइप करते ही suggestion आएँगे…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="consumer-search-input" />
                </div>
                {results.length > 0 && (
                  <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto" data-testid="consumer-search-results">
                    {results.map((c) => (
                      <button key={c.id} type="button" onClick={() => pickConsumer(c)} data-testid={`consumer-result-${c.id}`}
                        className="w-full text-left rounded-lg border p-2.5 hover:border-blue-400 hover:bg-blue-50/50" style={{ borderColor: 'var(--phed-border)' }}>
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--phed-ink)' }}>{c.consumer_name} <span className="font-mono text-xs text-slate-500">{c.consumer_id}</span></div>
                        <div className="text-[11px] text-slate-500 truncate">{c.locality || c.address || '—'}{(c.phone || c.phone_masked) ? ` · ${c.phone || c.phone_masked}` : ''}</div>
                        <div className="text-[11px] mt-0.5 flex flex-wrap gap-1">
                          {connsOf(c, 'Water').map((n) => <span key={`w${n}`} className="font-mono px-1.5 rounded bg-blue-50 text-blue-700">W {n}</span>)}
                          {connsOf(c, 'Sewer').map((n) => <span key={`s${n}`} className="font-mono px-1.5 rounded bg-teal-50 text-teal-700">S {n}</span>)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {picked && (
              <div className="space-y-3" data-testid="picked-consumer">
                <div className="flex items-center justify-between rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--phed-bg)' }}>
                  <span className="flex items-center gap-1.5 text-green-700 font-medium"><UserCheck className="w-4 h-4" /> PHED record से भरा गया</span>
                  {!locked && <button type="button" className="text-slate-400 hover:text-red-500" onClick={clearPicked} data-testid="clear-picked-btn">बदलें</button>}
                </div>
                {/* read-only auto-filled data */}
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--phed-border)' }}>
                  <Row label="Bill पर नाम" value={<span data-testid="picked-name">{picked.consumer_name}</span>} />
                  <Row label="Consumer ID" value={<span className="font-mono" data-testid="picked-id">{picked.consumer_id}</span>} />
                  <Row label="Mobile (record)" value={picked.phone || picked.phone_masked} />
                  <Row label="Connection type" value={<span data-testid="picked-category">{picked.category || 'Domestic'}</span>} />
                  <Row label="Water conn." value={<span className="font-mono" data-testid="picked-water">{waterNos.join(', ') || '—'}</span>} />
                  <Row label="Sewer conn." value={<span className="font-mono" data-testid="picked-sewer">{sewerNos.join(', ') || '—'}</span>} />
                </div>

                {hasBoth && ownerChange === null && (
                  <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 flex items-center gap-1.5" data-testid="both-connections-note">
                    <CheckCircle2 className="w-4 h-4" /> Water और Sewer दोनों मौजूद — photo optional, mobile भरकर submit करें।
                  </div>
                )}

                {/* Owner change */}
                {!locked && (
                  <div>
                    <div className="text-xs font-medium mb-1 text-slate-600 flex items-center gap-1"><Repeat className="w-3.5 h-3.5" /> Owner वही है या बदला है?</div>
                    <div className="grid grid-cols-3 gap-2">
                      <button type="button" onClick={() => setOwnerChange(null)} data-testid="owner-same-btn" className={`h-10 rounded-lg border text-xs font-medium ${ownerChange === null ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>Same owner</button>
                      <button type="button" onClick={() => setOwnerChange('DEATH_TRANSFER')} data-testid="owner-death-btn" className={`h-10 rounded-lg border text-xs font-medium ${ownerChange === 'DEATH_TRANSFER' ? 'border-purple-600 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600'}`}>Death transfer</button>
                      <button type="button" onClick={() => setOwnerChange('OWNERSHIP_CHANGE')} data-testid="owner-change-btn" className={`h-10 rounded-lg border text-xs font-medium ${ownerChange === 'OWNERSHIP_CHANGE' ? 'border-purple-600 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600'}`}>Ownership change</button>
                    </div>
                    {ownerChange && <div className="mt-2"><div className="text-xs font-medium mb-1 text-slate-600">New owner का नाम *</div><Input className="h-11" value={nc.owner_name} onChange={(e) => setNc({ ...nc, owner_name: e.target.value })} data-testid="new-owner-name-input" /></div>}
                    {ownerChange === 'DEATH_TRANSFER' && (
                      <div className="mt-2">
                        <div className="text-xs font-medium mb-1 text-slate-600">मृतक owner से रिश्ता (relationship) *</div>
                        <select
                          className="w-full h-11 border rounded-lg px-3 bg-white"
                          value={relOther ? '__OTHER__' : (REL_OPTIONS.includes(nc.relationship) ? nc.relationship : (nc.relationship ? '__OTHER__' : ''))}
                          onChange={(e) => {
                            if (e.target.value === '__OTHER__') { setRelOther(true); setNc({ ...nc, relationship: REL_OPTIONS.includes(nc.relationship) ? '' : nc.relationship }); }
                            else { setRelOther(false); setNc({ ...nc, relationship: e.target.value }); }
                          }}
                          data-testid="relationship-select"
                        >
                          <option value="">रिश्ता चुनें…</option>
                          {REL_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                          <option value="__OTHER__">अन्य (Other) — खुद लिखें</option>
                        </select>
                        {(relOther || (nc.relationship && !REL_OPTIONS.includes(nc.relationship))) && (
                          <Input className="h-11 mt-2" value={nc.relationship} onChange={(e) => setNc({ ...nc, relationship: e.target.value })} data-testid="relationship-input" placeholder="रिश्ता लिखें (जैसे भतीजा / चाचा / अन्य)" />
                        )}
                      </div>
                    )}
                    {ownerChange === 'OWNERSHIP_CHANGE' && <div className="mt-2"><div className="text-xs font-medium mb-1 text-slate-600">Ownership बदलने का कारण *</div><Input className="h-11" value={nc.change_reason} onChange={(e) => setNc({ ...nc, change_reason: e.target.value })} data-testid="change-reason-input" placeholder="जैसे sale / family transfer" /></div>}
                  </div>
                )}

                {MobileFields}
                {reqDocs.length > 0 && <div className="space-y-2" data-testid="doc-section">{reqDocs.map(renderDoc)}</div>}
              </div>
            )}
          </CardContent></Card>
        )}

        {/* NO branch — new connection */}
        {mode === 'no' && (
          <Card className="clinic-card"><CardContent className="p-4 space-y-3" data-testid="new-connection-details">
            <div className="text-sm font-semibold" style={{ color: 'var(--phed-ink)' }}>New Connection — details भरें</div>
            <div><div className="text-xs font-medium mb-1 text-slate-600">Owner name *</div><Input className="h-11" value={nc.owner_name} onChange={(e) => setNc({ ...nc, owner_name: e.target.value })} data-testid="nc-owner-input" /></div>
            {MobileFields}
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-xs font-medium mb-1 text-slate-600">Ward number</div><Input className="h-11" value={nc.ward} onChange={(e) => setNc({ ...nc, ward: e.target.value })} data-testid="nc-ward-input" /></div>
              <div><div className="text-xs font-medium mb-1 text-slate-600">Colony / locality *</div><Input className="h-11" value={nc.locality} onChange={(e) => setNc({ ...nc, locality: e.target.value })} data-testid="nc-locality-input" /></div>
            </div>
            <div><div className="text-xs font-medium mb-1 text-slate-600">Address</div><Input className="h-11" value={nc.address} onChange={(e) => setNc({ ...nc, address: e.target.value })} data-testid="nc-address-input" /></div>
            <div>
              <div className="text-xs font-medium mb-1 text-slate-600">कौन सा connection चाहिए? *</div>
              <div className="grid grid-cols-3 gap-2">
                {[['Water', 'पानी'], ['Sewer', 'सीवर'], ['Both', 'दोनों']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setNc({ ...nc, service: val })} data-testid={`nc-service-${val.toLowerCase()}`}
                    className={`h-11 rounded-lg border text-xs font-medium ${nc.service === val ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium mb-1 text-slate-600">Connection category *</div>
              <div className="grid grid-cols-4 gap-2">
                {['Domestic', 'Commercial', 'Domestic-SC', 'Other'].map((c) => (
                  <button key={c} type="button" onClick={() => setNc({ ...nc, category: c })} data-testid={`nc-category-${c.toLowerCase()}`}
                    className={`h-10 rounded-lg border text-[11px] font-medium ${nc.category === c ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>{c}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2" data-testid="doc-section">{reqDocs.map(renderDoc)}</div>
          </CardContent></Card>
        )}

        {/* Remarks + doc-pending hint */}
        {mode && (
          <Card className="clinic-card"><CardContent className="p-4">
            {missingCompulsory.length > 0 && (
              <div className="mb-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5" data-testid="doc-pending-note">
                कुछ ज़रूरी document नहीं हैं — survey <b>Document Pending</b> में submit होगा।
              </div>
            )}
            <div className="text-xs font-medium mb-1 text-slate-600">Remarks (optional)</div>
            <Input className="h-11" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="कोई टिप्पणी…" data-testid="remarks-input" />
          </CardContent></Card>
        )}

        <div className="fixed left-0 right-0 p-3 bg-white/95 backdrop-blur border-t z-40" style={{ borderColor: 'var(--phed-border)', bottom: 'calc(3.75rem + env(safe-area-inset-bottom))' }}>
          <div className="max-w-md mx-auto">
            <Button onClick={submit} disabled={submitting || locked || !mode} className="w-full h-12 text-white text-base" style={{ background: missingCompulsory.length > 0 ? '#d97706' : 'var(--phed-blue)' }} data-testid="submit-survey-btn">
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />} {locked ? survey.status : (missingCompulsory.length > 0 ? 'Submit (Document Pending)' : 'Submit survey')}
            </Button>
          </div>
        </div>
      </div>
    </EmployeeLayout>
  );
}
