import { ChevronRight, Box, Check, CircleAlert, Clock3, LoaderCircle, RefreshCw } from 'lucide-react';
import Modal from './Modal';
import { modelJobLabel } from '../lib/model-jobs';
import type { ModelJob } from '../lib/model-jobs';
import type { ProductItem } from '../lib/workspace';
import './model-jobs-panel.css';

export default function ModelJobsPanel({ jobs, onClose, onOpen, onCheck }: {
  jobs: ModelJob[]; onClose: () => void; onOpen: (item: ProductItem) => void; onCheck: (asin: string) => void;
}) {
  return <Modal label="Your 3D models" onClose={onClose} className="small-modal">
    <div className="modal-form model-jobs-panel"><h2>3D models</h2>
      {jobs.length > 0 && <p>Generates in the background. Open a completed model to add it to a layout.</p>}
      {jobs.length ? <ul className="model-job-list">{jobs.map(job => <li key={job.asin}>
        <div className={`model-job-heading ${job.state}`}>{job.state === 'ready' ? <Check size={16}/> : ['starting', 'pending', 'checking'].includes(job.state) ? <LoaderCircle size={16} className="spin"/> : job.state === 'failed' ? <CircleAlert size={16}/> : <Clock3 size={16}/>}
          <div><strong>{job.item.name}</strong><span>{modelJobLabel(job)}</span></div></div>
        {['starting', 'pending', 'checking'].includes(job.state) && <span className="model-job-bar" aria-hidden="true"/>}
        {job.message && <p>{job.message}</p>}
        <div className="model-job-actions"><button className="icon-button" aria-label={`Open ${job.item.name}`} title="Open item" onClick={() => onOpen(job.item)}><ChevronRight size={18}/></button>
          {job.state === 'paused' && <button className="icon-button" aria-label={`Check progress for ${job.item.name}`} title="Check progress" onClick={() => onCheck(job.asin)}><RefreshCw size={18}/></button>}</div>
      </li>)}</ul> : <div className="empty-state model-jobs-empty"><Box size={28}/><p>No models yet. Open an Amazon item and choose <strong>Generate 3D model</strong>.</p></div>}
    </div>
  </Modal>;
}
