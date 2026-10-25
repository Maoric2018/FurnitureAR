import { ArrowUpRight, Check, LoaderCircle } from 'lucide-react';
import Modal from './Modal';
import { modelJobLabel } from '../lib/model-jobs';
import type { ModelJob } from '../lib/model-jobs';
import type { ProductItem } from '../lib/workspace';
import './model-jobs-panel.css';

export default function ModelJobsPanel({ jobs, onClose, onOpen, onCheck }: {
  jobs: ModelJob[]; onClose: () => void; onOpen: (item: ProductItem) => void; onCheck: (asin: string) => void;
}) {
  return <Modal label="Your 3D models" onClose={onClose} className="small-modal">
    <div className="model-jobs-panel"><div className="overline">KEEP EXPLORING</div><h2>Your 3D models</h2>
      <p>Models keep generating while you browse. Requested items are kept in Saved items, ready to add to a layout once their models are finished.</p>
      {jobs.length ? <ul className="model-job-list">{jobs.map(job => <li key={job.asin}>
        <div className="model-job-heading">{job.state === 'ready' ? <Check size={18}/> : ['starting', 'pending', 'checking'].includes(job.state) ? <LoaderCircle size={18} className="spin"/> : <span className="model-job-dot"/>}
          <div><strong>{job.item.name}</strong><span>{modelJobLabel(job)}</span></div></div>
        {job.message && <p>{job.message}</p>}
        <div className="model-job-actions"><button className="text-button" onClick={() => onOpen(job.item)}>{job.state === 'ready' ? 'View item' : 'Open item'}<ArrowUpRight size={14}/></button>
          {job.state === 'paused' && <button className="text-button" onClick={() => onCheck(job.asin)}>Check progress</button>}</div>
      </li>)}</ul> : <div className="model-jobs-empty">Browse an Amazon item and choose <strong>Generate 3D model</strong> when you want to try it in your room.</div>}
      <button className="button outlined" onClick={onClose}>Keep browsing</button>
    </div>
  </Modal>;
}
