import { useEffect, useRef, useState } from 'react';
import type { ModelViewerElement } from '@google/model-viewer';
import { Box, Ruler, Sparkles } from 'lucide-react';

// Supplied catalog models with their measured bounds in meters (public/models/catalog/catalog.json).
const models = [
  { src: '/models/catalog/seating/chita-swivel-accent-chair.glb', name: 'Swivel accent chair', size: [0.762, 0.838, 0.838] },
  { src: '/models/catalog/seating/poly-bark-weave-dining-chair.glb', name: 'Wishbone dining chair', size: [0.546, 0.546, 0.775] },
  { src: '/models/catalog/seating/homepop-round-velvet-ottoman.glb', name: 'Velvet storage ottoman', size: [0.483, 0.483, 0.457] },
  { src: '/models/catalog/seating/novogratz-brittany-futon.glb', name: 'Linen sofa futon', size: [2.07, 0.876, 0.8] },
] as const;
const cm = (meters: number) => Math.round(meters * 100);

export default function HeroShowcase() {
  const [index, setIndex] = useState(0), [shown, setShown] = useState(0);
  const [ready, setReady] = useState(false), [loaded, setLoaded] = useState(false), [switching, setSwitching] = useState(false);
  const viewer = useRef<ModelViewerElement>(null), paused = useRef(false);
  // The viewer library loads after first paint so the hero text never waits for WebGL.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { import('@google/model-viewer').then(() => { if (!cancelled) setReady(true); }).catch(() => {}); }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => { if (!paused.current && !document.hidden) setIndex(value => (value + 1) % models.length); }, 7000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (index === shown) return;
    setSwitching(true);
    const timer = setTimeout(() => setShown(index), 380);
    return () => clearTimeout(timer);
  }, [index, shown]);
  useEffect(() => {
    const element = viewer.current;
    if (!element) return;
    const settle = () => { setSwitching(false); setLoaded(true); };
    element.addEventListener('load', settle); element.addEventListener('error', settle);
    return () => { element.removeEventListener('load', settle); element.removeEventListener('error', settle); };
  }, [ready]);
  const model = models[shown], [width, depth, height] = model.size;
  return <div className="hero-stage" onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; }}>
    {ready && <model-viewer ref={viewer} className={switching ? 'switching' : undefined} src={model.src} alt={`3D model of a ${model.name.toLowerCase()}`}
      camera-controls="" disable-zoom="" disable-pan="" auto-rotate="" auto-rotate-delay="0" rotation-per-second="16deg"
      camera-orbit="38deg 72deg 135%" field-of-view="28deg" interaction-prompt="none" touch-action="pan-y"
      shadow-intensity="1.2" shadow-softness="0.85" environment-image="neutral" exposure="1.08" loading="eager">
      <div slot="progress-bar"/>
    </model-viewer>}
    {!loaded && <div className="hero-stage-loading" role="status" aria-label="Loading 3D preview"><span className="loading-ring"/></div>}
    <span className="hero-chip top-left"><Sparkles/><span>AR-ready<small>Locked 1:1 scale</small></span></span>
    <span className="hero-chip top-right"><Ruler/><span>{cm(width)} × {cm(depth)} × {cm(height)} cm<small>Measured bounds</small></span></span>
    <span className="hero-chip bottom-left"><Box/><span>Real Amazon product<small>Price, colors, link</small></span></span>
    <div className="hero-stage-footer">
      <div className="hero-model-name"><strong>{model.name}</strong><span>Drag to orbit</span></div>
      <div className="hero-dots" role="group" aria-label="Choose a 3D model">{models.map((item, i) => <button key={item.src} type="button" aria-label={`Show ${item.name}`} aria-current={i === index} onClick={() => setIndex(i)}/>)}</div>
    </div>
  </div>;
}
