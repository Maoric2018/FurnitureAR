import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { DetailedHTMLProps, ReactNode } from 'react';
import type { ModelViewerElement } from '@google/model-viewer';
import { Box, RotateCcw } from 'lucide-react';
import { dimensionsMatch } from '../lib/products';
import type { FurnitureProduct, MaterialColorOverride } from '../lib/products';
import { createViewerColorController } from '../lib/material-colors';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': DetailedHTMLProps<React.HTMLAttributes<ModelViewerElement>, ModelViewerElement> & { [key: string]: unknown };
    }
  }
}
export interface ViewerHandle { startAR: () => void; reset: () => void }
interface Props {
  src: string; iosSrc?: string; name: string; interactive?: boolean; ar?: boolean;
  autoRotate?: boolean; onReady?: (ready: boolean) => void;
  expectedDimensions?: FurnitureProduct['dimensions'];
  onUnavailable?: () => void; onStatus?: (status: string) => void;
  materialOverrides?: MaterialColorOverride[]; arControls?: ReactNode;
}
export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer({src,iosSrc,name,interactive=false,ar=false,autoRotate=false,onReady,onUnavailable,onStatus,expectedDimensions,materialOverrides,arControls}, ref) {
  const element = useRef<ModelViewerElement>(null);
  const [state,setState] = useState<'loading'|'loaded'|'error'>('loading');
  const [attempt,setAttempt] = useState(0);
  const [arMessage,setArMessage] = useState('Move your phone slowly to find the floor.');
  const [colorError,setColorError] = useState('');
  const hadColorError = useRef(false);
  const ready = useRef(false);
  const latest = useRef({onReady,onUnavailable,onStatus,expectedDimensions,materialOverrides});
  latest.current = {onReady,onUnavailable,onStatus,expectedDimensions,materialOverrides};
  const colorController = useRef<{model: NonNullable<ModelViewerElement['model']>; controller: ReturnType<typeof createViewerColorController>} | null>(null);
  const syncColors = useCallback(() => {
    const viewer = element.current;
    if (!viewer?.loaded || !viewer.model) return;
    ready.current = false;
    const current = latest.current;
    try {
      if (colorController.current?.model !== viewer.model) {
        colorController.current = {model:viewer.model,controller:createViewerColorController(viewer.model)};
      }
      colorController.current.controller.apply(current.materialOverrides);
      setColorError('');
      if (hadColorError.current) { current.onStatus?.(''); hadColorError.current=false; }
      if (current.expectedDimensions && !dimensionsMatch(viewer.getDimensions(),current.expectedDimensions)) {
        current.onReady?.(false);
        current.onStatus?.('This model’s size doesn’t match the product dimensions. AR is unavailable until the importer supplies a correctly scaled model.');
        return;
      }
      ready.current = true;
      current.onReady?.(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This finish couldn’t load. Choose another finish before opening AR.';
      setColorError(message);
      hadColorError.current = true;
      current.onReady?.(false);
      current.onStatus?.(message);
    }
  },[]);
  const colorsKey = JSON.stringify(materialOverrides ?? []);
  const dimensionsKey = JSON.stringify(expectedDimensions);
  useLayoutEffect(() => { syncColors(); },[colorsKey,dimensionsKey,src,attempt,syncColors]);
  useEffect(() => {
    const viewer = element.current;
    if (!viewer) return;
    let cancelled = false;
    setState('loading'); ready.current = false; latest.current.onReady?.(false);
    const loaded = () => {
      if (cancelled) return;
      setState('loaded');
      syncColors();
    };
    const error = () => { if (!cancelled) { setState('error'); ready.current=false; latest.current.onReady?.(false); } };
    const status = (event: Event) => {
      const value = (event as CustomEvent).detail.status;
      const onStatus = latest.current.onStatus;
      if (value === 'session-started') onStatus?.('Move your phone slowly. Tap and drag to position your furniture.');
      if (value === 'object-placed') { setArMessage('Placed at actual size. Drag to move; use two fingers to rotate.'); onStatus?.('Placed at actual size.'); }
      if (value === 'failed') onStatus?.('AR couldn’t start. Check camera access and try again in Safari on iPhone or Chrome on Android.');
      if (value === 'not-presenting') onStatus?.('');
    };
    const tracking = (event: Event) => {
      if ((event as CustomEvent).detail.status === 'not-tracking') setArMessage('Tracking paused. Move slowly toward a well-lit, textured floor.');
      else setArMessage('Drag to move; use two fingers to rotate. Size stays true to life.');
    };
    viewer.addEventListener('load',loaded); viewer.addEventListener('error',error);
    viewer.addEventListener('ar-status',status); viewer.addEventListener('ar-tracking',tracking);
    // Load the AR engine only when a preview is opened, keeping the workspace light.
    void import('@google/model-viewer').catch(error);
    if (viewer.loaded) loaded();
    return () => { cancelled=true; viewer.removeEventListener('load',loaded); viewer.removeEventListener('error',error); viewer.removeEventListener('ar-status',status); viewer.removeEventListener('ar-tracking',tracking); };
  },[src,attempt,syncColors]);
  useImperativeHandle(ref, () => ({
    startAR() {
      const viewer=element.current;
      if (!viewer?.loaded || !ready.current) return;
      if (!window.isSecureContext || !viewer.canActivateAR) { latest.current.onUnavailable?.(); return; }
      latest.current.onStatus?.('Opening your phone’s AR viewer…');
      // Must stay directly within the user's tap for iOS Quick Look permission.
      viewer.activateAR().catch(() => latest.current.onStatus?.('AR couldn’t start. Check camera access and try again.'));
    },
    reset() { if(element.current) { element.current.cameraOrbit='32deg 72deg auto'; element.current.cameraTarget='auto auto auto'; element.current.fieldOfView='30deg'; element.current.jumpCameraToGoal(); } }
  }),[]);
  return <div className={`viewer ${interactive ? 'viewer-interactive' : ''}`}>
    <model-viewer key={`${src}-${attempt}`} ref={element} src={src} ios-src={materialOverrides?.length ? undefined : iosSrc} alt={`3D view of ${name}`}
      camera-controls={interactive || undefined} auto-rotate={autoRotate || undefined} rotation-per-second="12deg"
      camera-orbit="32deg 72deg auto" field-of-view="30deg" min-camera-orbit="auto 12deg 70%" max-camera-orbit="auto 90deg 180%"
      shadow-intensity="1.15" shadow-softness="1" environment-image="neutral" exposure="1.1"
      interaction-prompt="none" touch-action="pan-y" loading="eager" reveal="auto"
      ar={ar || undefined} ar-modes="webxr quick-look" ar-scale="fixed" ar-placement="floor" xr-environment={ar || undefined}>
      <span slot="ar-button" />
      <div slot="ar-prompt" className="ar-coach"><span className="pulse-dot"/>{arMessage}</div>
      {arControls && <div className="ar-color-controls" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>{arControls}</div>}
      <div slot="progress-bar" />
    </model-viewer>
    {state === 'loading' && <div className="viewer-loading" aria-label="Loading 3D furniture"><span className="loading-ring"/><span>Getting your piece ready</span></div>}
    {state === 'error' && <div className="viewer-error"><Box size={28}/><p>This 3D model couldn’t load.</p><button className="text-button" onClick={() => setAttempt(v=>v+1)}><RotateCcw size={15}/> Try again</button></div>}
    {state === 'loaded' && colorError && <p role="alert" className="viewer-color-error">{colorError}</p>}
  </div>;
});
