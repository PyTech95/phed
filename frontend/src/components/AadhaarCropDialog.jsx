import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { Check, Loader2, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { AADHAAR_ASPECT, cropAadhaarPhoto, normalizeAadhaarPhoto } from '../lib/aadhaarImage';

export const AadhaarCropDialog = ({ file, side, initialEdit, onSave, onCancel }) => {
  const [source, setSource] = useState(null);
  const [error, setError] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(initialEdit?.turn || 0);
  const [tilt, setTilt] = useState(initialEdit?.tilt || 0);
  const [initialArea, setInitialArea] = useState(initialEdit?.area);
  const [resetKey, setResetKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef(null);
  const saving = useRef(false);
  const rotation = turn + tilt;
  const id = `aadhaar-${side}-crop`;

  useEffect(() => {
    let active = true, url;
    normalizeAadhaarPhoto(file).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob); setSource(url);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  const reset = () => {
    setInitialArea(undefined); setTurn(0); setTilt(0); setZoom(1);
    setCrop({ x: 0, y: 0 }); setReady(false); setResetKey((v) => v + 1);
  };
  const save = async () => {
    if (!source || !areaRef.current || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const result = await cropAadhaarPhoto(source, areaRef.current.pixels, rotation, side);
      await onSave(result, { turn, tilt, area: areaRef.current.percentages });
    } catch (e) { setError(e.message || 'Photo could not be saved. Please try again.'); }
    finally { saving.current = false; setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent data-testid={`${id}-dialog`} closeTestId={`${id}-close`} closeDisabled={busy}
        overlayClassName="z-[1400]" className="z-[1401] w-[calc(100%-1rem)] max-w-xl gap-3 rounded-lg p-3 sm:p-5"
        style={{ animation: 'none', maxHeight: '95dvh' }} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader className="text-left pr-8">
          <DialogTitle data-testid={`${id}-title`} className="text-base sm:text-lg tracking-normal">Aadhaar — {side === 'back' ? 'Back' : side === 'front' ? 'Front' : 'Photo'}</DialogTitle>
          <DialogDescription data-testid={`${id}-description`}>Crop & straighten</DialogDescription>
        </DialogHeader>
        <div inert={busy ? true : undefined} className="relative w-full overflow-hidden rounded-md bg-neutral-900" style={{ height: 'min(42dvh, 340px)', minHeight: 170 }} data-testid={`${id}-workspace`}>
          {!source && !error && <div role="status" data-testid={`${id}-loading`} className="absolute inset-0 flex items-center justify-center text-white"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening photo…</div>}
          {source && <Cropper key={resetKey} image={source} crop={crop} zoom={zoom} rotation={rotation}
            aspect={AADHAAR_ASPECT} minZoom={1} maxZoom={6} zoomWithScroll={false}
            initialCroppedAreaPercentages={initialArea} onCropChange={setCrop} onZoomChange={setZoom}
            onCropAreaChange={(percentages, pixels) => { areaRef.current = { percentages, pixels }; }}
            onCropComplete={() => setReady(true)}
            cropperProps={{ 'data-testid': `${id}-canvas`, 'aria-label': 'Position Aadhaar card' }}
            mediaProps={{ 'data-testid': `${id}-image`, alt: `Aadhaar ${side}` }} />}
        </div>
        <fieldset disabled={!source || busy} className="space-y-3 min-w-0">
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="outline" title="Rotate left 90°" aria-label="Rotate left 90 degrees" data-testid={`${id}-rotate-left`} onClick={() => setTurn((v) => (v - 90) % 360)}><RotateCcw className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" title="Rotate right 90°" aria-label="Rotate right 90 degrees" data-testid={`${id}-rotate-right`} onClick={() => setTurn((v) => (v + 90) % 360)}><RotateCw className="h-4 w-4" /></Button>
            <span className="text-xs tabular-nums text-slate-500" data-testid={`${id}-rotation-value`}>{rotation}°</span>
            <Button type="button" variant="ghost" className="ml-auto" data-testid={`${id}-reset`} onClick={reset}><Undo2 className="mr-1.5 h-4 w-4" />Reset</Button>
          </div>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
            <label htmlFor={`${id}-zoom`}>Zoom</label>
            <input id={`${id}-zoom`} data-testid={`${id}-zoom`} aria-label="Zoom" type="range" min="1" max="6" step="0.01" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="h-7 w-full accent-blue-600" />
            <output className="text-right tabular-nums" data-testid={`${id}-zoom-value`}>{zoom.toFixed(1)}×</output>
            <label htmlFor={`${id}-straighten`}>Straighten</label>
            <input id={`${id}-straighten`} data-testid={`${id}-straighten`} aria-label="Straighten" type="range" min="-45" max="45" step="0.5" value={tilt} onChange={(e) => setTilt(Number(e.target.value))} className="h-7 w-full accent-blue-600" />
            <output className="text-right tabular-nums" data-testid={`${id}-straighten-value`}>{tilt}°</output>
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-700" data-testid={`${id}-error`}>{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel} data-testid={`${id}-cancel`}>Cancel</Button>
          <Button type="button" disabled={!ready || !source || busy} onClick={save} data-testid={`${id}-save`} className="text-white" style={{ background: 'var(--phed-blue)' }}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} {busy ? 'Saving…' : 'Use photo'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};