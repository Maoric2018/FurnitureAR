import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, CircleHelp, ExternalLink, LoaderCircle, LockKeyhole, Move, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { RoomLayout } from '../lib/workspace';
import type { DesignPhoto, DesignProposal, DesignResult, PieceRule } from '../lib/design';
import { designStatus, prepareRoomPhoto, requestDesign } from '../lib/design-client';
import type { DesignStatus } from '../lib/design-client';
import Modal from './Modal';
import FloorPlan from './FloorPlan';
import './room-designer.css';

type Brief = { brief: string; style: string; budget: string; rules: Record<string, PieceRule> };
const styles = ['Let the room lead', 'Warm minimal', 'Mid-century', 'Japandi', 'Colorful & playful', 'Industrial'];
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
function readBrief(layout: RoomLayout): Brief {
  const defaults: Brief = { brief: '', style: styles[0], budget: '800', rules: Object.fromEntries(layout.items.map(i => [i.id, 'fixed'])) };
  try {
    const value = JSON.parse(localStorage.getItem(`furniture-ar:design:${layout.id}`) ?? 'null');
    if (value && typeof value.brief === 'string' && typeof value.style === 'string' && typeof value.budget === 'string' && value.rules && typeof value.rules === 'object') {
      return { brief: value.brief.slice(0, 1600), style: value.style.slice(0, 100), budget: value.budget,
        rules: Object.fromEntries(layout.items.map(i => [i.id, ['fixed', 'move', 'remove'].includes(value.rules[i.id]) ? value.rules[i.id] : 'fixed'])) };
    }
  } catch { /* A brief is optional; corrupted storage must not block the editor. */ }
  return defaults;
}
export default function RoomDesigner({ layout, onClose, onApply }: { layout: RoomLayout; onClose: () => void; onApply: (proposal: DesignProposal) => void }) {
  const [brief, setBrief] = useState(() => readBrief(layout));
  const [photos, setPhotos] = useState<DesignPhoto[]>([]), [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<DesignStatus | null>(null), [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<DesignResult | null>(null);
  const [selected, setSelected] = useState(0), [refinement, setRefinement] = useState(''), [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(true);
  const [revisions, setRevisions] = useState<string[]>([]);
  const pending = useRef<AbortController | null>(null), mounted = useRef(true), timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = result?.proposals[selected];
  const returnTo = `/?layout=${encodeURIComponent(layout.id)}&design=1`;
  const signInPath = `${status?.signedIn ? '/signout-with-chatgpt' : '/signin-with-chatgpt'}?return_to=${encodeURIComponent(returnTo)}`;
  useEffect(() => {
    const controller = new AbortController();
    designStatus(controller.signal).then(setStatus).catch(() => { if (!controller.signal.aborted) setStatusError('Could not check the designer connection.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.abort(); if (timeout.current) clearTimeout(timeout.current); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(`furniture-ar:design:${layout.id}`, JSON.stringify(brief)); setSaved(true); } catch { setSaved(false); }
  }, [brief, layout.id]);
  const change = (patch: Partial<Brief>) => setBrief(current => ({ ...current, ...patch }));
  const cancel = () => { pending.current?.abort(); pending.current = null; if (timeout.current) clearTimeout(timeout.current); setBusy(false); };
  const generate = async (previous?: DesignProposal) => {
    if (!status?.configured || !status.authorized) { setError('Sign in with an approved account to use the room designer.'); return; }
    const budget = Number(brief.budget);
    if (!brief.brief.trim() || !brief.budget.trim() || !Number.isFinite(budget) || budget < 0 || budget > 100000) { setError('Describe what you want and enter a budget between $0 and $100,000.'); return; }
    if (previous && !refinement.trim()) { setError('Describe what you would like to change.'); return; }
    cancel(); const controller = new AbortController(); pending.current = controller; setBusy(true); setError('');
    timeout.current = setTimeout(() => { controller.abort(); if (mounted.current) { setError('This design took too long. Your layout is unchanged; try again.'); setBusy(false); } }, 300000);
    try {
      const changes = previous ? [...revisions, refinement.trim()] : [];
      const next = await requestDesign({ layout, brief: brief.brief, style: brief.style, budget, rules: brief.rules, photos,
        ...(previous ? { previous: previous.draft, refinement: changes.join('\n').slice(-800) } : {}) }, controller.signal);
      if (!controller.signal.aborted && mounted.current) { setResult(next); setRevisions(changes.slice(-4)); setSelected(0); setRefinement(''); setEditing(false); }
    } catch (e) { if (!controller.signal.aborted && mounted.current) setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { if (pending.current === controller) { pending.current = null; if (timeout.current) clearTimeout(timeout.current); if (mounted.current) setBusy(false); } }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (photos.length + files.length > 4) { setError('You can add up to four room photos.'); return; }
    setUploading(true); setError('');
    try { const added: DesignPhoto[] = []; for (const file of files) added.push(await prepareRoomPhoto(file)); if (mounted.current) setPhotos(current => [...current, ...added].slice(0, 4)); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Could not read that photo.'); }
    finally { if (mounted.current) setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const showBrief = !result || editing;
  return <Modal label="Design my room" onClose={onClose} className="designer-modal">
    <div className="designer-shell">
      <header className="designer-header"><div><span className="overline">A ROOM THAT WORKS FOR YOU</span><h2>Design my room<span>.</span></h2><p>{showBrief ? 'A little context. A few possibilities. All yours to arrange.' : 'Different ways to make the same room feel right.'}</p></div><span className="designer-room-tag">{layout.width.toFixed(1)} × {layout.depth.toFixed(1)} m<span>{layout.roomType}</span></span></header>
      {status && !status.configured && <div className="designer-connection" role="status"><CircleHelp size={18}/><div><strong>Ready for its Claude connection</strong><span>Prepare your brief now. Design generation will be available once the service is connected.</span></div><button onClick={() => { setStatusError(''); designStatus().then(setStatus).catch(() => setStatusError('The connection could not be checked.')); }} aria-label="Recheck Claude connection"><RefreshCw size={16}/></button></div>}
      {status?.configured && !status.authorized && <div className="designer-connection designer-access" role="status"><LockKeyhole size={18}/><div><strong>{status.signedIn ? 'This account does not have design access' : 'Sign in to design your room'}</strong><span>Use the app owner’s ChatGPT account. Your saved layout and brief will be here when you return.</span></div><a href={signInPath} target="_top" className="button secondary">{status.signedIn ? 'Sign out' : 'Sign in'}</a></div>}
      {statusError && <div className="designer-error" role="alert">{statusError}<button className="text-button" onClick={() => { setStatusError(''); designStatus().then(setStatus).catch(() => setStatusError('The connection could not be checked.')); }}>Try again</button></div>}
      {showBrief ? <form onSubmit={e => { e.preventDefault(); void generate(); }} className="designer-brief">
        <div className="designer-fields"><label className="designer-label">What would make this room better?<textarea value={brief.brief} onChange={e => change({ brief: e.target.value })} maxLength={1600} required rows={4} disabled={busy} placeholder="A cozy living room with a small workspace. Keep my sofa, add a reading corner, and leave the middle open."/></label>
          <div className="designer-examples">{['Make room for a workspace', 'Create a cozy reading corner', 'Make a small room feel open'].map(example => <button key={example} type="button" disabled={busy} onClick={() => change({ brief: example })}>{example}</button>)}</div>
          <div className="designer-form-row"><label className="designer-label">Direction<select value={brief.style} disabled={busy} onChange={e => change({ style: e.target.value })}>{styles.map(style => <option key={style}>{style}</option>)}</select></label><label className="designer-label">New furniture budget <span>USD</span><div className="designer-budget"><span>$</span><input aria-label="New furniture budget" type="number" min="0" max="100000" step="0.01" required value={brief.budget} disabled={busy} onChange={e => change({ budget: e.target.value })}/></div></label></div>
          <p className="designer-hint">Budget covers additions to this layout. Set $0 to rearrange its current pieces.</p>
          <div className="designer-label">Show us the room <span>Optional · up to 4 photos</span></div>
          <div className="designer-photos">{photos.map((photo, i) => <div className="designer-photo" key={i}><img src={`data:${photo.mediaType};base64,${photo.data}`} alt={`Room reference ${i + 1}`}/><button type="button" disabled={busy || uploading} aria-label={`Remove room photo ${i + 1}`} onClick={() => setPhotos(current => current.filter((_, n) => n !== i))}><X size={14}/></button></div>)}{photos.length < 4 && <button className="designer-upload" type="button" disabled={busy || uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle size={22} className="spin"/> : <Camera size={22}/>}<span>{uploading ? 'Preparing photo…' : 'Add photos'}</span></button>}<input ref={fileInput} className="sr-only" aria-label="Room photos" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => void upload(e.target.files)}/></div>
          <p className="designer-hint">Photos help with colors and style. They do not measure or map obstacles. They are sent to Claude only when you generate and are not saved with your layout.</p>
        </div>
        <aside className="designer-room-context"><div className="designer-context-title"><span>YOUR STARTING POINT</span><span>{layout.survey?.obstacles.length ? `${layout.survey.obstacles.length} existing · ${layout.items.length} added` : `${layout.items.length} pieces`}</span></div><div className="designer-context-plan"><FloorPlan layout={layout} compact/></div>
          {layout.items.length ? <div className="designer-piece-rules">{layout.items.map((item, i) => <label key={item.id}><span className="designer-piece-number">{i + 1}</span><span className="designer-rule-name">{item.name}</span><select aria-label={`Design rule for ${item.name}`} disabled={busy} value={brief.rules[item.id] ?? 'fixed'} onChange={e => change({ rules: { ...brief.rules, [item.id]: e.target.value as PieceRule } })}><option value="fixed">Keep here</option><option value="move">Can move</option><option value="remove">Leave out</option></select></label>)}</div> : <p className="designer-context-note">{layout.survey?.obstacles.length ? 'We’ll fit new pieces around the existing objects and keep doorways clear.' : 'A fresh floor plan. Tell us what you need and we’ll look for pieces that fit.'}</p>}
          {layout.survey ? <p className="designer-context-note"><LockKeyhole size={14}/>{layout.survey.obstacles.length} scanned objects stay in place. Their labels are hidden.</p> : <p className="designer-context-note"><CircleHelp size={15}/>Manual room size. Doorways and existing furniture are not mapped. Scanning returns in the app.</p>}
          <div className="designer-how"><span><Check size={15}/>Real product references</span><span><Check size={15}/>Fit and budget checks</span><span><Move size={15}/>Fully editable layouts</span></div>
        </aside>
        <footer className="designer-form-footer"><span>{saved ? 'Brief saved on this device' : 'Brief could not be saved on this device'}</span><div>{result && <button className="button outlined" type="button" disabled={busy} onClick={() => setEditing(false)}><ArrowLeft size={16}/>Back to designs</button>}<button className="button primary" type="submit" disabled={busy || uploading || !status?.configured || !status.authorized || !brief.brief.trim()}>{busy ? <><LoaderCircle size={17} className="spin"/>Designing…</> : <>Find my room’s possibilities<ArrowRight size={17}/></>}</button></div></footer>
      </form> : <div className="designer-results">
        <div className="designer-result-heading"><p>{result.summary}</p><button className="text-button" disabled={busy} onClick={() => setEditing(true)}><SlidersHorizontal size={15}/>Edit brief</button></div>
        {!!result.observations.length && <details className="designer-observations"><summary>What the room suggests</summary><ul>{result.observations.map((observation, i) => <li key={i}>{observation}</li>)}</ul></details>}
        <div className="designer-options">{result.proposals.map((proposal, i) => <button type="button" disabled={busy} className={`designer-option ${selected === i ? 'selected' : ''}`} key={proposal.id} aria-pressed={selected === i} onClick={() => { setSelected(i); setError(''); }}><div className="designer-option-number">0{i + 1}<span>{selected === i ? <Check size={16}/> : <ArrowRight size={16}/>}</span></div><div className="designer-option-plan"><FloorPlan layout={proposal.layout} compact/></div><div className="designer-option-copy"><h3>{proposal.name}</h3><p>{proposal.description}</p><div><strong>{money(proposal.total)}</strong><span>{proposal.added} new {proposal.added === 1 ? 'piece' : 'pieces'}</span></div></div></button>)}</div>
        {active && <><div className="designer-selection"><div className="designer-shopping"><span className="overline">IN THIS DESIGN</span><ul>{active.layout.items.map(item => <li key={item.id}><span>{item.name}</span><span>{layout.items.some(i => i.id === item.id) ? 'In starting layout' : item.listing?.price ? money(item.listing.price.amount) : 'Price unavailable'}</span><a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`View ${item.name} on Amazon`}><ExternalLink size={14}/></a></li>)}</ul><p>{active.notes.join(' ')}</p></div><form className="designer-refine" onSubmit={e => { e.preventDefault(); void generate(active); }}><label className="designer-label">Close, but not quite?<textarea rows={3} maxLength={800} disabled={busy} value={refinement} onChange={e => setRefinement(e.target.value)} placeholder="Use a smaller desk and make it feel warmer."/></label><button className="button outlined" disabled={busy || !status?.authorized || !refinement.trim()}>Refine this direction<ArrowRight size={16}/></button></form></div>
        {!!result.notices.length && <div className="designer-notices">{result.notices.map((notice, i) => <p key={i}>{notice}</p>)}</div>}
        <footer className="designer-form-footer"><span>Saved as a new layout. Your starting room stays available.</span><button className="button primary" disabled={busy} onClick={() => onApply(active)}>Use this design<ArrowRight size={17}/></button></footer></>}
      </div>}
      {busy && <div className="designer-progress" role="status"><LoaderCircle className="spin" size={19}/><span>Reading your room, finding furniture, and checking the fit. This can take a few minutes.</span><button onClick={cancel}>Cancel</button></div>}
      {error && <div className="designer-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}
