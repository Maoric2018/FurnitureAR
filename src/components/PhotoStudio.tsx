import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Camera, Check, ChevronRight, Clock3, Download, ImagePlus, LoaderCircle, RefreshCw, Ruler, ScanLine, ShieldCheck, X } from 'lucide-react';
import { createGeneration, generationConfig, generationModelUrl, getGeneration, preparePhoto, readPendingGeneration, rememberGeneration, trackGeneration, generationElapsedSeconds, GenerationError } from '../lib/reconstruction';
import type { GenerationConfig, PendingGeneration } from '../lib/reconstruction';
import { prepareGeneratedModel } from '../lib/reconstruction-model';
import type { PreparedModel } from '../lib/reconstruction-model';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
import './photo-studio.css';

const stageLabels: Record<string, string> = { preparing: 'Preparing photo', reconstructing: 'Building shape', texturing: 'Adding color', exporting: 'Finishing model' };
export default function PhotoStudio({ autoOpenCamera = false }: { autoOpenCamera?: boolean }) {
  const [config, setConfig] = useState<GenerationConfig | null>(null), [configError, setConfigError] = useState(''), [configAttempt, setConfigAttempt] = useState(0);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null), [cameraOpen, setCameraOpen] = useState(false), [cameraReady, setCameraReady] = useState(false), [openingCamera, setOpeningCamera] = useState(false);
  const [job, setJob] = useState<PendingGeneration | null>(readPendingGeneration), [uploading, setUploading] = useState(false), [preparingPhoto, setPreparingPhoto] = useState(false);
  const [error, setError] = useState(''), [pollError, setPollError] = useState(''), [pollAttempt, setPollAttempt] = useState(0), [now, setNow] = useState(Date.now);
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [model, setModel] = useState<PreparedModel | null>(null), [modelError, setModelError] = useState(''), [modelAttempt, setModelAttempt] = useState(0), [modelLoading, setModelLoading] = useState(false);
  const [heightDraft, setHeightDraft] = useState(''), [height, setHeight] = useState<number | null>(null), [modelReady, setModelReady] = useState(false), [arStatus, setArStatus] = useState('');
  const video = useRef<HTMLVideoElement>(null), input = useRef<HTMLInputElement>(null), nativeCamera = useRef<HTMLInputElement>(null), stream = useRef<MediaStream | null>(null);
  const mounted = useRef(false), cameraSequence = useRef(0), photoSequence = useRef(0), startedCamera = useRef(false), uploadController = useRef<AbortController | null>(null), uploadBusy = useRef(false), requestId = useRef(crypto.randomUUID());
  const rawModel = useRef<{ ticket: string; bytes: ArrayBuffer } | null>(null), viewer = useRef<ViewerHandle>(null);
  const busy = uploading || job?.status === 'queued' || job?.status === 'processing';
  const elapsed = generationElapsedSeconds(job?.startedAt ?? uploadStartedAt, now);
  const finished = job?.status === 'succeeded';
  const stopCamera = useCallback(() => {
    cameraSequence.current++; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    if (mounted.current) { setCameraOpen(false); setCameraReady(false); setOpeningCamera(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; startedCamera.current = false; photoSequence.current++; stopCamera(); uploadController.current?.abort(); };
  }, [stopCamera]);
  useEffect(() => { const pause = () => { if (document.hidden && stream.current) { stopCamera(); setError('Camera paused. Open it again to continue.'); } }; document.addEventListener('visibilitychange', pause); return () => document.removeEventListener('visibilitychange', pause); }, [stopCamera]);
  useEffect(() => { if (cameraOpen && video.current && stream.current) { video.current.srcObject = stream.current; void video.current.play().catch(() => setError('Camera preview couldn’t start. Upload a photo or use your device camera.')); } }, [cameraOpen]);
  useEffect(() => { const controller = new AbortController(); setConfigError(''); generationConfig(controller.signal).then(setConfig).catch(() => { if (!controller.signal.aborted) setConfigError('Could not check the generation service.'); }); return () => controller.abort(); }, [configAttempt]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => { rememberGeneration(job); }, [job]);
  const openCamera = useCallback(async () => {
    stopCamera(); setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError('Live camera is unavailable. Upload a photo or use your device camera below.'); return; }
    const sequence = ++cameraSequence.current; setOpeningCamera(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } } });
      if (!mounted.current || sequence !== cameraSequence.current) { next.getTracks().forEach(track => track.stop()); return; }
      stream.current = next; setCameraOpen(true); setOpeningCamera(false);
    } catch (cause) {
      if (!mounted.current || sequence !== cameraSequence.current) return;
      setOpeningCamera(false);
      const name = cause instanceof Error ? cause.name : '';
      setError(name === 'NotAllowedError' ? 'Camera access denied. Enable it in your browser or upload a photo.' : name === 'NotFoundError' ? 'No camera found. Upload a photo instead.' : 'Camera unavailable. Close other camera apps or upload a photo.');
    }
  }, [stopCamera]);
  useEffect(() => { if (autoOpenCamera && !startedCamera.current && !job) { startedCamera.current = true; void openCamera(); } }, [autoOpenCamera, job, openCamera]);
  const acceptPhoto = async (file?: File) => {
    if (!file) return;
    const sequence = ++photoSequence.current; setPreparingPhoto(true); setError('');
    try {
      const prepared = await preparePhoto(file);
      if (!mounted.current || sequence !== photoSequence.current) return;
      stopCamera(); setPhoto({ file: prepared, url: URL.createObjectURL(prepared) }); requestId.current = crypto.randomUUID(); setJob(null); setUploadStartedAt(null); setHeight(null); setHeightDraft('');
    } catch (cause) { if (mounted.current && sequence === photoSequence.current) setError((cause as Error).message); }
    finally { if (mounted.current && sequence === photoSequence.current) setPreparingPhoto(false); }
  };
  const capture = async () => {
    const element = video.current; if (!element?.videoWidth || preparingPhoto) return;
    const canvas = document.createElement('canvas'), factor = Math.min(1, 1600 / element.videoWidth);
    canvas.width = Math.round(element.videoWidth * factor); canvas.height = Math.round(element.videoHeight * factor);
    const context = canvas.getContext('2d'); if (!context) { setError('Couldn’t take this photo. Try uploading one.'); return; }
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => { if (blob && mounted.current) void acceptPhoto(new File([blob], 'camera.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', .9);
  };
  const generate = async () => {
    if (!photo || uploadBusy.current || !config?.configured || !config.signedIn) return;
    stopCamera(); setError(''); setPollError(''); setUploading(true); uploadBusy.current = true;
    const startedAt = uploadStartedAt ?? Date.now(); setUploadStartedAt(startedAt); setNow(Date.now());
    const controller = new AbortController(); uploadController.current = controller;
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const created = await createGeneration(photo.file, requestId.current, controller.signal);
      if (mounted.current) { const pending = trackGeneration(created, null, startedAt); rememberGeneration(pending); setJob(pending); }
    } catch (cause) {
      if (mounted.current) {
        setError(controller.signal.aborted ? 'Upload timed out. Retry safely without creating a duplicate model.' : (cause as Error).message);
        if (cause instanceof GenerationError && cause.code === 'SIGN_IN_REQUIRED') setConfig(value => value ? { ...value, signedIn: false } : value);
      }
    } finally { clearTimeout(timer); uploadBusy.current = false; if (mounted.current) setUploading(false); }
  };
  useEffect(() => {
    if (!job || !['queued', 'processing'].includes(job.status)) return;
    const ticket = job.ticket, controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let failures = 0; const start = Date.now();
    setPollError('');
    const poll = async () => {
      try {
        const next = await getGeneration(ticket, AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]));
        if (controller.signal.aborted) return;
        failures = 0; setJob(current => trackGeneration(next, current));
        if (next.status === 'failed') return;
        if (next.status === 'succeeded') return;
        if (Date.now() - start > 20 * 60000) { setPollError('Generation is taking longer than expected. Check status again.'); return; }
        timer = setTimeout(poll, 3000);
      } catch (cause) {
        if (controller.signal.aborted) return;
        failures++;
        if (failures >= 3 || cause instanceof GenerationError && ['SIGN_IN_REQUIRED', 'JOB_UNAVAILABLE'].includes(cause.code)) { setPollError((cause as Error).message); return; }
        timer = setTimeout(poll, failures * 3000);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job?.ticket, job?.status === 'queued' || job?.status === 'processing', pollAttempt]);
  useEffect(() => {
    if (!busy) return;
    const updateClock = () => setNow(Date.now());
    updateClock();
    const timer = setInterval(updateClock, 1000);
    document.addEventListener('visibilitychange', updateClock);
    window.addEventListener('pageshow', updateClock);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', updateClock); window.removeEventListener('pageshow', updateClock); };
  }, [busy]);
  useEffect(() => {
    if (!finished || !job) { setModel(null); return; }
    const ticket = job.ticket, controller = new AbortController(); let url: string | undefined;
    setModelLoading(true); setModelReady(false); setModel(null); setModelError(''); setArStatus('');
    void (async () => {
      if (rawModel.current?.ticket !== ticket) {
        const response = await fetch(generationModelUrl(ticket), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
        if (!response.ok) throw new Error('Couldn’t download the model. Try again.');
        const bytes = await response.arrayBuffer(); controller.signal.throwIfAborted(); rawModel.current = { ticket, bytes };
      }
      const prepared = await prepareGeneratedModel(rawModel.current.bytes, height || 1, controller.signal);
      if (controller.signal.aborted) { URL.revokeObjectURL(prepared.url); return; }
      url = prepared.url; setModel(prepared); setModelLoading(false);
    })().catch(cause => { if (!controller.signal.aborted) { setModelError((cause as Error).message); setModelLoading(false); } });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [finished, job?.ticket, height, modelAttempt]);
  const reset = () => { stopCamera(); setPhoto(null); setJob(null); setUploadStartedAt(null); rawModel.current = null; setError(''); setPollError(''); setModelError(''); setHeight(null); setHeightDraft(''); requestId.current = crypto.randomUUID(); };
  const step = finished ? 2 : busy || job ? 1 : 0;
  const readyForGeneration = !!photo && config?.configured && config.signedIn && !preparingPhoto;
  return <div className="photo-studio">
    <div className="page-heading"><h1>Photo to 3D</h1></div>
    <ol className="photo-steps" aria-label="Photo to 3D steps">{['Photo', 'Generate', 'Preview & AR'].map((label, index) => <li key={label} className={step === index ? 'current' : step > index ? 'complete' : ''} aria-current={step === index ? 'step' : undefined}><span>{step > index ? <Check size={14}/> : index + 1}</span>{label}{index < 2 && <ChevronRight size={14}/>}</li>)}</ol>
    {config && !config.configured && <div className="notice photo-service-note" role="status"><Box size={18}/><div><strong>3D generation is unavailable.</strong><p>You can still take or upload a photo.</p></div><button className="icon-button" onClick={() => setConfigAttempt(value => value + 1)} aria-label="Check generation availability" title="Check generation availability"><RefreshCw size={16}/></button></div>}
    {config?.configured && !config.signedIn && <div className="notice photo-service-note"><ShieldCheck size={18}/><div><strong>Sign in to generate a model.</strong></div><a href="/signin-with-chatgpt?return_to=%2F%3Fphoto%3D1" target="_top" className="button secondary">Sign in</a></div>}
    {configError && <div className="notice error photo-service-note" role="alert">{configError}<button className="text-button" onClick={() => setConfigAttempt(value => value + 1)}>Retry</button></div>}
    <div className="photo-workspace">
      <section className={`photo-stage ${cameraOpen ? 'camera-active' : ''} ${!finished && !cameraOpen && !photo ? 'photo-stage-placeholder' : ''}`} aria-label={finished ? 'Generated model preview' : 'Photo capture'}>
        {(finished || cameraOpen || photo) && <div className="photo-stage-top"><span className="tag">{!finished && cameraOpen && <span className="photo-status-dot"/>}{finished ? '3D model' : cameraOpen ? 'Camera on' : 'Photo'}</span>{finished && <span className="tag">{height ? 'Height set' : 'Preview scale'}</span>}</div>}
        {finished ? <>
          {model ? <Viewer ref={viewer} src={model.url} name="Your reconstructed furniture" interactive ar={height !== null} expectedDimensions={model.dimensions} onReady={setModelReady} onStatus={setArStatus} onUnavailable={() => setArStatus('Use Safari on iPhone or Chrome on a compatible Android phone for AR.')}/> : <div className="photo-stage-empty">{modelLoading ? <><LoaderCircle className="spin" size={32}/><h2>Loading model…</h2></> : <><Box size={34}/><p role="alert">{modelError}</p><button className="button secondary" onClick={() => setModelAttempt(value => value + 1)}>Reload model</button></>}</div>}
          {model && <p className="photo-stage-caption">Drag to orbit · Pinch or scroll to zoom</p>}
        </> : cameraOpen ? <>
          <video ref={video} autoPlay playsInline muted aria-label="Live camera preview" onLoadedData={() => setCameraReady(true)}/><div className="photo-frame" aria-hidden="true"><i/><i/><i/><i/></div>
          <div className="photo-camera-bar"><button className="photo-camera-close" onClick={stopCamera} aria-label="Close camera" title="Close camera"><X size={20}/></button><button className="photo-shutter" onClick={() => void capture()} disabled={!cameraReady || preparingPhoto} aria-label="Take photo" title="Take photo"><span/></button><span>Keep the whole piece in frame</span></div>
        </> : photo ? <>
          <img className="photo-selected-image" src={photo.url} alt="Your furniture photo ready for reconstruction"/>
          {busy && <div className="photo-busy-overlay" aria-hidden="true"/>}
          {busy && <p className="photo-stage-caption">Generating…</p>}
        </> : job ? <div className="photo-stage-empty"><Box size={32} strokeWidth={1.5}/><h2>{job.status === 'failed' ? 'Photo unavailable' : 'Photo submitted'}</h2><p>Photo previews are cleared when you leave this page.</p></div> : <div className="photo-stage-empty"><Camera size={32} strokeWidth={1.5}/><h2>Add a furniture photo</h2><button className="button primary" onClick={() => void openCamera()} disabled={openingCamera || busy}>{openingCamera ? <LoaderCircle size={17} className="spin"/> : <Camera size={17}/>}{openingCamera ? 'Opening camera…' : 'Open camera'}</button><button className="text-button" onClick={() => input.current?.click()} disabled={busy || preparingPhoto}><ImagePlus size={16}/>Upload photo</button><small className="photo-file-hint">JPG, PNG, WebP · Up to 20 MB</small></div>}
      </section>
      <aside className="photo-panel">
        {finished ? <>
          <h2>Model ready</h2>
          <form className="photo-size-form" onSubmit={event => { event.preventDefault(); const value = Number(heightDraft); if (Number.isFinite(value) && value >= 5 && value <= 500) { setHeight(value / 100); setArStatus(''); } }}>
            <label htmlFor="photo-height"><Ruler size={16}/>Measured height</label><div className="photo-height-input"><input className="input" id="photo-height" aria-describedby="photo-height-hint" type="number" inputMode="decimal" min="5" max="500" step="any" required value={heightDraft} onChange={event => setHeightDraft(event.target.value)} placeholder="e.g. 75"/><span>cm</span><button className="button secondary" type="submit" disabled={modelLoading}>Set size</button></div><p id="photo-height-hint">Enter the real height to enable AR. Width and depth scale proportionally.</p>
          </form>
          {model && height && <div className="photo-dimensions">{(['width', 'depth', 'height'] as const).map(key => <span key={key}><small>{key}</small><strong>{Math.round(model.dimensions[key] * 100)} <small>cm</small></strong></span>)}</div>}
          <button className="button primary" disabled={!height || !modelReady || modelLoading} onClick={() => viewer.current?.startAR()}><ScanLine size={18}/>View in your room</button>
          {arStatus && <p className="notice" role="status">{arStatus}</p>}
          {model && <a className="button secondary" href={model.url} download="my-furniture.glb"><Download size={16}/>Download GLB</a>}
          <button className="text-button" onClick={reset}><Camera size={16}/>New photo</button><p className="photo-fineprint">AI models are estimates. Check dimensions before buying.</p>
        </> : busy || job ? <>
          <h2>{job?.status === 'failed' ? 'Generation failed' : pollError ? 'Couldn’t check model status' : uploading ? 'Uploading photo' : job?.status === 'queued' ? 'Waiting in queue' : stageLabels[job?.stage || ''] || 'Building model'}</h2>
          <p>{job?.status === 'failed' ? 'Try a clearer photo with the whole piece visible.' : 'This can take several minutes.'}</p>
          {job?.progress !== undefined && !pollError && job.status !== 'failed' ? <div className="photo-progress"><div><span>Progress</span><strong>{Math.round(job.progress)}%</strong></div><progress max="100" value={job.progress} aria-label="Generation progress"/></div> : busy && !pollError && <progress className="photo-indeterminate" aria-label={uploading ? 'Uploading photo' : 'Generating model'}/>}
          {busy && <div className="photo-elapsed"><Clock3 size={14}/>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed</div>}
          <div role="status" className="sr-only">{job?.status === 'queued' ? 'Generation queued.' : job?.status === 'processing' ? stageLabels[job.stage || ''] || 'Generation in progress.' : ''}</div>
          {pollError && <div className="photo-error" role="alert"><p>{pollError}</p><button className="button secondary" onClick={() => setPollAttempt(value => value + 1)}>Check status</button></div>}
          {job?.status === 'failed' && <button className="button secondary" onClick={reset}><RefreshCw size={16}/>Try another photo</button>}
          {job?.status!=='failed'&&<p className="photo-fineprint">You can switch pages and return here to check progress.</p>}
        </> : <>
          <h2>{photo ? 'Ready to generate' : 'Photo tips'}</h2>
          <ul className="photo-tips"><li>Show the whole piece against a simple background.</li><li>Use even light and show the front and side.</li></ul>
          {photo && <><button className="button primary" onClick={() => void generate()} disabled={!readyForGeneration}>{preparingPhoto ? 'Preparing photo…' : 'Generate 3D model'}</button><div className="photo-retake-actions"><button className="button secondary" onClick={() => void openCamera()} disabled={openingCamera || preparingPhoto}><Camera size={15}/>Retake</button><button className="button secondary" onClick={() => input.current?.click()} disabled={preparingPhoto}><ImagePlus size={15}/>Change photo</button></div></>}
          <div className="notice"><ShieldCheck size={17}/><p>Only your selected photo is uploaded when you generate.</p></div>
        </>}
        {error && <div className="photo-error" role="alert"><p>{error}</p></div>}
        {error && !finished && !busy && !job && <div className="photo-fallback"><button className="text-button" onClick={() => nativeCamera.current?.click()} disabled={preparingPhoto}><Camera size={14}/>Use device camera</button></div>}
      </aside>
    </div>
    <input className="photo-file-input" tabIndex={-1} ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload furniture photo" onChange={event => { void acceptPhoto(event.target.files?.[0]); event.target.value = ''; }}/>
    <input className="photo-file-input" tabIndex={-1} ref={nativeCamera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take furniture photo with device camera" onChange={event => { void acceptPhoto(event.target.files?.[0]); event.target.value = ''; }}/>
  </div>;
}
