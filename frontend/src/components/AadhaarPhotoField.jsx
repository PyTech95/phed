import { useEffect, useRef, useState } from 'react';
import { Camera, Crop, Upload, X, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';
import { AadhaarCropDialog } from './AadhaarCropDialog';
import { AADHAAR_ACCEPT, AADHAAR_ASPECT, validateAadhaarPhoto } from '../lib/aadhaarImage';

export const AadhaarPhotoField = ({ side, value, onChange, alreadyUploaded = false, disabled = false, onPreview }) => {
  const camera = useRef(null), upload = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pending, setPending] = useState(null);
  const [original, setOriginal] = useState(null);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const id = `aadhaar-${side}`;
  const label = side === 'front' ? 'Front' : 'Back';
  useEffect(() => {
    if (!value) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(value); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  const choose = (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { validateAadhaarPhoto(file); setError(''); setPending({ file }); }
    catch (e) { setError(e.message); }
  };
  return (
    <div className="min-w-0 space-y-2 rounded-lg border p-2.5" style={{ borderColor: value || alreadyUploaded ? '#16a34a' : 'var(--phed-border)' }} data-testid={`${id}-slot`}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium" data-testid={`${id}-label`}>
        {label}
        {(value || alreadyUploaded) && <CheckCircle2 aria-label="Photo available" className="h-4 w-4 text-green-600" data-testid={`${id}-available`} />}
      </div>
      <input ref={camera} type="file" accept={AADHAAR_ACCEPT} capture="environment" disabled={disabled} className="hidden" onChange={choose} data-testid={`${id}-input`} aria-label={`${label} camera photo`} />
      <input ref={upload} type="file" accept={AADHAAR_ACCEPT} disabled={disabled} className="hidden" onChange={choose} data-testid={`${id}-upload-input`} aria-label={`Upload ${label.toLowerCase()} photo`} />
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="h-10 flex-1 px-2 text-xs" onClick={() => camera.current?.click()} data-testid={`${id}-btn`}><Camera className="mr-1 h-4 w-4 shrink-0" />Camera</Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="h-10 flex-1 px-2 text-xs" onClick={() => upload.current?.click()} data-testid={`${id}-upload-btn`}><Upload className="mr-1 h-4 w-4 shrink-0" />Upload</Button>
      </div>
      {previewUrl && <>
        <button type="button" className="block w-full overflow-hidden rounded border bg-slate-50" style={{ aspectRatio: AADHAAR_ASPECT }} onClick={() => onPreview(value)} data-testid={`${id}-preview-btn`} aria-label={`Preview Aadhaar ${side}`}>
          <img src={previewUrl} alt={`Aadhaar ${side}`} className="h-full w-full object-contain" data-testid={`${id}-thumb`} />
        </button>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={disabled} className="h-9 flex-1 px-1 text-xs" onClick={() => setPending({ file: original || value, edit })} data-testid={`${id}-edit-btn`}><Crop className="mr-1 h-4 w-4" />Edit crop</Button>
          <Button type="button" size="icon" variant="ghost" disabled={disabled} className="h-9 w-9 text-red-600" title={`Remove new ${side} photo`} aria-label={`Remove new ${side} photo`} data-testid={`${id}-remove-btn`} onClick={() => { onChange(null); setOriginal(null); setEdit(null); setError(''); }}><X className="h-4 w-4" /></Button>
        </div>
      </>}
      {!value && alreadyUploaded && <p className="text-xs text-green-700" data-testid={`${id}-uploaded-status`}>✓ पहले upload हो चुका</p>}
      {error && <p role="alert" className="text-xs text-red-700" data-testid={`${id}-error`}>{error}</p>}
      {pending && <AadhaarCropDialog file={pending.file} side={side} initialEdit={pending.edit} onCancel={() => setPending(null)} onSave={(file, settings) => {
        setOriginal(pending.file); setEdit(settings); onChange(file); setPending(null);
      }} />}
    </div>
  );
};