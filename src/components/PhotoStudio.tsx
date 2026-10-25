import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Box, Camera, Check, ChevronRight, Clock3, Download, ImagePlus, LoaderCircle, RefreshCw, Ruler, ScanLine, ShieldCheck, Sparkles, X } from 'lucide-react';
import { createGeneration, generationConfig, generationModelUrl, getGeneration, preparePhoto, readPendingGeneration, rememberGeneration, trackGeneration, generationElapsedSeconds, GenerationError } from '../lib/reconstruction';
import type { GenerationConfig, PendingGeneration } from '../lib/reconstruction';
import { prepareGeneratedModel } from '../lib/reconstruction-model';
import type { PreparedModel } from '../lib/reconstruction-model';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
import './photo-studio.css';

const stageLabels: Record<string, string> = { preparing: 'Preparing your photo', reconstructing: 'Reconstructing the shape', texturing: 'Adding surface details', exporting: 'Finishing your 3D model' };
export default function PhotoStudio({ autoOpenCamera = false, onBack }: { autoOpenCamera?: boolean; onBack: () => void }) {
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
  useEffect(() => { const pause = () => { if (document.hidden && stream.current) { stopCamera(); setError('Camera paused while this tab was hidden. Open it again when you are ready.'); } }; document.addEventListener('visibilitychange', pause); return () => document.removeEventListener('visibilitychange', pause); }, [stopCamera]);
  useEffect(() => { if (cameraOpen && video.current && stream.current) { video.current.srcObject = stream.current; void video.current.play().catch(() => setError('The camera preview could not start. Try uploading a photo instead.')); } }, [cameraOpen]);
  useEffect(() => { const controller = new AbortController(); setConfigError(''); generationConfig(controller.signal).then(setConfig).catch(() => { if (!controller.signal.aborted) setConfigError('Could not check the generation service.'); }); return () => controller.abort(); }, [configAttempt]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => { rememberGeneration(job); }, [job]);
  const openCamera = useCallback(async () => {
    stopCamera(); setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError('Live camera needs HTTPS or localhost. You can use Take a photo or upload an image instead.'); return; }
    const sequence = ++cameraSequence.current; setOpeningCamera(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } } });
      if (!mounted.current || sequence !== cameraSequence.current) { next.getTracks().forEach(track => track.stop()); return; }
      stream.current = next; setCameraOpen(true); setOpeningCamera(false);
    } catch (cause) {
      if (!mounted.current || sequence !== cameraSequence.current) return;
      setOpeningCamera(false);
      const name = cause instanceof Error ? cause.name : '';
      setError(name === 'NotAllowedError' ? 'Camera access was not allowed. Enable it in your browser, or upload a photo below.' : name === 'NotFoundError' ? 'No camera was found. You can upload a photo instead.' : 'The camera is unavailable or in use. Close other camera apps, or upload a photo.');
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
    const context = canvas.getContext('2d'); if (!context) { setError('Could not take this photo. Try uploading one instead.'); return; }
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
        setError(controller.signal.aborted ? 'The upload response took too long. Retry to check the same request without creating a second generation.' : (cause as Error).message);
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
        if (Date.now() - start > 20 * 60000) { setPollError('This is taking longer than expected. Your model may still be generating; check its status again.'); return; }
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
        if (!response.ok) throw new Error('Your model could not be downloaded. Try loading it again.');
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
    <button className="photo-back" onClick={onBack}><ArrowLeft size={15}/>Back to workspace</button>
    <div className="photo-heading"><div><div className="overline">FROM REAL LIFE TO YOUR ROOM</div><h1>A photo. A new perspective.</h1><p>Capture a piece you love. Turn it into 3D. See it in your space.</p></div><span className="photo-beta"><Sparkles size={13}/>PHOTO TO 3D</span></div>
    <ol className="photo-steps" aria-label="Photo to 3D steps">{['Capture your piece', 'Create the model', 'Preview & AR'].map((label, index) => <li key={label} className={step === index ? 'current' : step > index ? 'complete' : ''} aria-current={step === index ? 'step' : undefined}><span>{step > index ? <Check size={14}/> : `0${index + 1}`}</span>{label}{index < 2 && <ChevronRight size={14}/>}</li>)}</ol>
    {config && !config.configured && <div className="photo-service-note" role="status"><Box size={18}/><div><strong>Photo capture is ready. 3D generation is not connected yet.</strong><p>You can take or upload a photo now. Generation will become available when the model service is connected.</p></div><button onClick={() => setConfigAttempt(value => value + 1)} aria-label="Check generation availability"><RefreshCw size={16}/></button></div>}
    {config?.configured && !config.signedIn && <div className="photo-service-note"><ShieldCheck size={18}/><div><strong>Sign in before taking your photo.</strong><p>Your photo is only sent when you choose Generate 3D model.</p></div><a href="/signin-with-chatgpt?return_to=%2F%3Fphoto%3D1" target="_top" className="button secondary">Sign in</a></div>}
    {configError && <div className="photo-service-note" role="alert">{configError}<button className="text-button" onClick={() => setConfigAttempt(value => value + 1)}>Retry</button></div>}
    <div className="photo-workspace">
      <section className={`photo-stage ${cameraOpen ? 'camera-active' : ''} ${busy ? 'is-generating' : ''}`} aria-label={finished ? 'Generated model preview' : 'Photo capture'}>
        <div className="photo-stage-top"><span><span className={`photo-status-dot ${cameraOpen ? 'live' : ''}`}/>{finished ? 'YOUR 3D MODEL' : cameraOpen ? 'CAMERA LIVE' : photo ? 'YOUR PHOTO' : 'CAPTURE STUDIO'}</span><span>{finished ? height ? 'SIZED BY YOU' : 'PREVIEW SCALE' : '01 PHOTO → 3D'}</span></div>
        {finished ? <>
          {model ? <Viewer ref={viewer} src={model.url} name="Your reconstructed furniture" interactive ar={height !== null} expectedDimensions={model.dimensions} onReady={setModelReady} onStatus={setArStatus} onUnavailable={() => setArStatus('Open this site over HTTPS in Safari on iPhone or Chrome on an AR-capable Android phone to use AR.')}/> : <div className="photo-stage-empty">{modelLoading ? <><LoaderCircle className="spin" size={32}/><h2>Preparing your preview</h2><p>Loading the model and getting it ready for your room.</p></> : <><Box size={34}/><p role="alert">{modelError}</p><button className="button secondary" onClick={() => setModelAttempt(value => value + 1)}>Reload model</button></>}</div>}
          <div className="photo-stage-bottom"><span>Drag to orbit · Pinch or scroll to zoom</span><Box size={16}/></div>
        </> : cameraOpen ? <>
          <video ref={video} autoPlay playsInline muted aria-label="Live camera preview" onLoadedData={() => setCameraReady(true)}/><div className="photo-frame" aria-hidden="true"><i/><i/><i/><i/></div>
          <div className="photo-camera-bar"><button className="photo-camera-close" onClick={stopCamera} aria-label="Close camera"><X size={20}/></button><button className="photo-shutter" onClick={() => void capture()} disabled={!cameraReady || preparingPhoto} aria-label="Take photo"><span/></button><span>Keep the whole piece in frame</span></div>
        </> : photo ? <>
          <img className="photo-selected-image" src={photo.url} alt="Your furniture photo ready for reconstruction"/>
          {busy && <div className="photo-scan-overlay" aria-hidden="true"><div className="photo-scan-line"/></div>}
          <div className="photo-stage-bottom"><span>{busy ? 'Creating from this photo' : 'Looking good? Let’s make it 3D.'}</span><Check size={16}/></div>
        </> : <div className="photo-stage-empty"><div className="photo-camera-illustration"><div className="photo-frame" aria-hidden="true"><i/><i/><i/><i/></div><Camera size={48} strokeWidth={1}/></div><h2>Bring your own piece.</h2><p>A chair, a table, a favorite find.<br/>Start with one clear photo.</p><button className="button primary photo-camera-button" onClick={() => void openCamera()} disabled={openingCamera || busy}>{openingCamera ? <LoaderCircle size={17} className="spin"/> : <Camera size={17}/>} {openingCamera ? 'Opening camera…' : 'Open camera'}<ArrowRight size={16}/></button><button className="photo-upload-link" onClick={() => input.current?.click()} disabled={busy || preparingPhoto}><ImagePlus size={16}/>Or upload a photo</button></div>}
      </section>
      <aside className="photo-panel">
        {finished ? <>
          <span className="photo-panel-kicker"><Check size={14}/>RECONSTRUCTION COMPLETE</span><h2>Meet your piece,<br/>in another dimension.</h2><p>Explore the model, then bring it into your room.</p>
          <form className="photo-size-form" onSubmit={event => { event.preventDefault(); const value = Number(heightDraft); if (Number.isFinite(value) && value >= 5 && value <= 500) { setHeight(value / 100); setArStatus(''); } }}>
            <label htmlFor="photo-height"><Ruler size={16}/>How tall is the real piece?</label><div className="photo-height-input"><input id="photo-height" type="number" inputMode="decimal" min="5" max="500" step="any" required value={heightDraft} onChange={event => setHeightDraft(event.target.value)} placeholder="e.g. 75"/><span>cm</span><button type="submit" disabled={modelLoading}>Set size</button></div><p>A photo doesn’t tell us the real size. Enter a measured height to enable AR; width and depth keep the model’s proportions.</p>
          </form>
          {model && height && <div className="photo-dimensions">{(['width', 'depth', 'height'] as const).map(key => <span key={key}><small>{key}</small><strong>{Math.round(model.dimensions[key] * 100)} <small>cm</small></strong></span>)}</div>}
          <button className="button primary photo-generate-button" disabled={!height || !modelReady || modelLoading} onClick={() => viewer.current?.startAR()}><ScanLine size={18}/>View in your room<ArrowRight size={16}/></button>
          {!height && <p className="photo-hint">Set the height above to unlock AR.</p>}
          {arStatus && <p className="photo-ar-status" role="status">{arStatus}</p>}
          {model && <a className="button secondary photo-download" href={model.url} download="my-furniture.glb"><Download size={16}/>Download 3D model</a>}
          <button className="photo-upload-link" onClick={reset}><Camera size={16}/>Create another model</button><p className="photo-fineprint">AI reconstruction is an approximation. Check the shape and measurements before planning a purchase.</p>
        </> : busy || job ? <>
          <span className="photo-panel-kicker">YOUR PIECE IS TAKING SHAPE</span><div className={`photo-processing-orb ${pollError || job?.status === 'failed' ? 'paused' : ''}`} aria-hidden="true"><span/><span/><Box size={33} strokeWidth={1}/></div>
          <h2>{job?.status === 'failed' ? 'Let’s try another view.' : pollError ? 'Let’s check on your model.' : uploading ? 'Sending your photo.' : job?.status === 'queued' ? 'Your piece is in line.' : stageLabels[job?.stage || ''] || 'Building your 3D model.'}</h2>
          <p>{job?.status === 'failed' ? 'The service could not reconstruct this photo. Try a clearer image with the entire piece visible.' : 'We’re turning your photo into a model you can move around and explore. This can take several minutes.'}</p>
          {job?.progress !== undefined && !pollError && job.status !== 'failed' ? <div className="photo-progress"><div><span>Reported progress</span><strong>{Math.round(job.progress)}%</strong></div><progress max="100" value={job.progress}/></div> : busy && !pollError && <progress className="photo-indeterminate" aria-label={uploading ? 'Uploading photo' : 'Generating model'}/>}
          {busy && <div className="photo-elapsed"><Clock3 size={14}/>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed{job?.status === 'queued' ? ' · Waiting for the model service' : ''}</div>}
          <div className="photo-status-list"><span><Check size={15}/>Photo ready</span><span>{uploading ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}Photo submitted</span><span className="pending"><Box size={15}/>3D preview & AR</span></div>
          <div role="status" className="photo-live-status">{job?.status === 'queued' ? 'Generation queued.' : job?.status === 'processing' ? stageLabels[job.stage || ''] || 'Generation in progress.' : ''}</div>
          {pollError && <div className="photo-error" role="alert"><p>{pollError}</p><button className="button secondary" onClick={() => setPollAttempt(value => value + 1)}>Check status again</button></div>}
          {job?.status === 'failed' && <button className="button secondary" onClick={reset}><RefreshCw size={16}/>Start a new photo</button>}
          <p className="photo-fineprint">You can leave this page and return to Photo to 3D in the same browser tab to check your generation. The photo preview stays only until you leave.</p>
        </> : <>
          <span className="photo-panel-kicker">A DIFFERENT WAY TO FIND YOUR FIT</span><h2>{photo ? 'One photo.<br/>Your next 3D model.'.split('<br/>').map((line, index) => <span key={line}>{index > 0 && <br/>}{line}</span>) : <>The real world,<br/>ready to rearrange.</>}</h2><p>{photo ? 'Check that your furniture is clear and fully visible. When you’re ready, send this photo to create its 3D model.' : 'Photograph furniture you already own, or something that caught your eye.'}</p>
          <ol className="photo-tips"><li><span>01</span><div><strong>Give it a little space.</strong><p>Keep one whole piece in frame, with a simple background.</p></div></li><li><span>02</span><div><strong>Find the good light.</strong><p>A three-quarter view helps show the front, side, and shape.</p></div></li><li><span>03</span><div><strong>Make it yours.</strong><p>Generate the model, set its height, and try it in AR.</p></div></li></ol>
          {photo && <><button className="button primary photo-generate-button" onClick={() => void generate()} disabled={!readyForGeneration}><Sparkles size={17}/>{preparingPhoto ? 'Preparing photo…' : 'Generate 3D model'}<ArrowRight size={16}/></button><div className="photo-retake-actions"><button onClick={() => void openCamera()} disabled={openingCamera || preparingPhoto}><Camera size={15}/>Retake</button><button onClick={() => input.current?.click()} disabled={preparingPhoto}><ImagePlus size={15}/>Choose another</button></div></>}
          <div className="photo-privacy"><ShieldCheck size={17}/><p>Your camera preview stays on this device. Only the selected photo is sent to the model service when you choose Generate.</p></div>
        </>}
        {error && <div className="photo-error" role="alert"><p>{error}</p></div>}
        {!finished && !busy && !job && <div className="photo-fallback"><button onClick={() => nativeCamera.current?.click()} disabled={preparingPhoto}><Camera size={14}/>Take a photo</button><span>·</span><button onClick={() => input.current?.click()} disabled={preparingPhoto}><ImagePlus size={14}/>Upload image</button><small>JPG, PNG, WebP · Up to 20 MB</small></div>}
      </aside>
    </div>
    <input className="photo-file-input" ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload furniture photo" onChange={event => { void acceptPhoto(event.target.files?.[0]); event.target.value = ''; }}/>
    <input className="photo-file-input" ref={nativeCamera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take furniture photo with device camera" onChange={event => { void acceptPhoto(event.target.files?.[0]); event.target.value = ''; }}/>
    <div className="photo-page-footer"><span><ScanLine size={15}/>One photo. One piece. A new point of view.</span><span>AR requires a compatible phone and HTTPS.</span></div>
  </div>;
}
