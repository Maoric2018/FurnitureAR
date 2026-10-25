import { Box, Check, CircleAlert, Clock3, LoaderCircle } from 'lucide-react';
import Modal from './Modal';
import { modelJobLabel } from '../lib/model-jobs';
import type { ModelJob } from '../lib/model-jobs';
import type { ProductItem } from '../lib/workspace';
import './model-jobs-panel.css';

export default function ModelJobsPanel({ jobs, onClose, onOpen, onCheck }: {
  jobs: ModelJob[]; onClose: () => void; onOpen: (item: ProductItem) => void; onCheck: (asin: string) => void;
}) {
  return <Modal label="Your 3D models" onClose={onClose} className="small-modal">
    <div className="modal-form model-jobs-panel"><h2>Your 3D models</h2>
      <p>Models keep generating while you browse. Requested models stay here, ready to preview or add to a layout when they finish.</p>
      {jobs.length ? <ul className="model-job-list">{jobs.map(job => <li key={job.asin}>
        <div className={`model-job-heading ${job.state}`}>{job.state === 'ready' ? <Check size={16}/> : ['starting', 'pending', 'checking'].includes(job.state) ? <LoaderCircle size={16} className="spin"/> : job.state === 'failed' ? <CircleAlert size={16}/> : <Clock3 size={16}/>}
          <div><strong>{job.item.name}</strong><span>{modelJobLabel(job)}</span></div></div>
        {job.message && <p>{job.message}</p>}
        <div className="model-job-actions"><button className="text-button" onClick={() => onOpen(job.item)}>{job.state === 'ready' ? 'View item' : 'Open item'}</button>
          {job.state === 'paused' && <button className="text-button" onClick={() => onCheck(job.asin)}>Check progress</button>}</div>
      </li>)}</ul> : <div className="empty-state model-jobs-empty"><Box size={28}/><p>Browse an Amazon item and choose <strong>Generate 3D model</strong> when you want to try it in your room.</p></div>}
      <button className="button secondary" onClick={onClose}>Keep browsing</button>
    </div>
  </Modal>;
}
