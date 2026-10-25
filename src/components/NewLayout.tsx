import { useState } from 'react';
import { ArrowLeft, ArrowRight, Ruler, ScanLine } from 'lucide-react';
import { createLayout } from '../lib/workspace';
import type { RoomLayout } from '../lib/workspace';
import Modal from './Modal';

export default function NewLayout({ onClose, onCreate, onScan }: {
  onClose: () => void;
  onScan: () => void;
  onCreate: (layout: RoomLayout) => void;
}) {
  const [step, setStep] = useState<'choose' | 'manual'>('choose');
  const [name, setName] = useState('');
  const [width, setWidth] = useState('5');
  const [depth, setDepth] = useState('4');
  const [error, setError] = useState('');

  return <Modal label="New layout" onClose={onClose} className="small-modal">
    {step === 'choose' ? <div className="modal-form room-setup">
      <span className="overline">NEW LAYOUT</span>
      <h2>Start with your room.</h2>
      <p>Choose how to create your floor plan.</p>
      <div className="room-methods">
        <button className="room-method" aria-label="Enter room size" onClick={() => setStep('manual')}>
          <Ruler size={24}/><span><strong>Enter room size</strong><small>Set the width and depth yourself.</small></span><ArrowRight size={18}/>
        </button>
        <button className="room-method" aria-label="Scan your room" onClick={onScan}>
          <ScanLine size={24}/><span><strong>Scan your room</strong><small>Scan with LiDAR or import a saved room file.</small></span><ArrowRight size={18}/>
        </button>
      </div>
      {error&&<p role="alert" className="form-error">{error}</p>}
    </div> : <form className="modal-form room-setup" onSubmit={event => {
      event.preventDefault();
      try { onCreate(createLayout(name, 'Room', Number(width), Number(depth))); }
      catch (caught) { setError((caught as Error).message); }
    }}>
      <button type="button" className="text-button setup-back" onClick={() => setStep('choose')}><ArrowLeft size={15}/>Back</button>
      <span className="overline">ROOM DIMENSIONS</span>
      <h2>Make room for your ideas.</h2>
      <p>Enter the size of your room to get started.</p>
      <label className="field-label">Layout name<input autoFocus required maxLength={80} placeholder="e.g. Living room" value={name} onChange={event => { setName(event.target.value); setError(''); }}/></label>
      <div className="two-fields">
        <label className="field-label">Width (m)<input required type="number" min="1" max="20" step="any" value={width} onChange={event => { setWidth(event.target.value); setError(''); }}/></label>
        <label className="field-label">Depth (m)<input required type="number" min="1" max="20" step="any" value={depth} onChange={event => { setDepth(event.target.value); setError(''); }}/></label>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="button primary" type="submit">Create floor plan<ArrowRight size={16}/></button>
    </form>}
  </Modal>;
}
