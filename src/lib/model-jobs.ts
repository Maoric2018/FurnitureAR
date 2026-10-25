import { generateAmazonProductModel, getAmazonProductModel, ImportError } from './amazon';
import type { AmazonProductResult } from './amazon';
import { parseWorkspace } from './workspace';
import type { ProductItem } from './workspace';
import { resolveModelItem } from './model-resolution';

export interface ModelJob {
  asin: string;
  item: ProductItem;
  state: 'starting' | 'pending' | 'checking' | 'ready' | 'failed' | 'paused';
  message?: string;
  updatedAt: number;
}
export const MODEL_JOBS_KEY = 'furniture-ar:model-jobs:v1';
const active = (job: ModelJob) => ['starting', 'pending', 'checking'].includes(job.state);
type Store = Pick<Storage, 'getItem' | 'setItem'>;
interface Options {
  storage?: Store;
  generate?: typeof generateAmazonProductModel;
  check?: typeof getAmazonProductModel;
  onResult?: (id: string, result: AmazonProductResult) => void;
  onReady?: (item: ProductItem) => void;
  now?: () => number;
  pollDelayMs?: number;
  timeoutMs?: number;
  maxPollMs?: number;
}

export function readModelJobs(storage?: Store): ModelJob[] {
  try {
    const data: unknown = JSON.parse(storage?.getItem(MODEL_JOBS_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.slice(0, 30).flatMap(value => {
      if (!value || !['starting', 'pending', 'checking', 'ready', 'failed', 'paused'].includes(value.state)
        || !Number.isFinite(value.updatedAt) || typeof value.asin !== 'string' || seen.has(value.asin)) return [];
      const item = parseWorkspace({ items: [value.item], layouts: [] }).items[0];
      if (!item?.listing || item.listing.asin !== value.asin || !/^[A-Z0-9]{10}$/.test(value.asin)
        || item.sourceUrl !== `https://www.amazon.com/dp/${value.asin}`) return [];
      if ((value.state === 'ready') !== !!item.product) return [];
      seen.add(value.asin);
      // Do not trust serialized messages or replay POSTs after a reload.
      return [{ asin: value.asin, item, state: value.state, updatedAt: value.updatedAt } as ModelJob];
    });
  } catch { return []; }
}

/** Owns generation requests independently of product previews and room navigation. */
export class ModelJobs {
  private jobs: ModelJob[];
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private requests = new Map<string, AbortController>();
  private deadlines = new Map<string, number>();
  private failures = new Map<string, number>();
  private running = false;
  private now: () => number;
  constructor(private options: Options = {}) {
    this.jobs = readModelJobs(options.storage);
    this.now = options.now ?? Date.now;
  }
  getSnapshot = () => this.jobs;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit() {
    try { this.options.storage?.setItem(MODEL_JOBS_KEY, JSON.stringify(this.jobs)); } catch { /* Current-session jobs continue without browser storage. */ }
    this.listeners.forEach(listener => listener());
  }
  private update(asin: string, patch: Partial<ModelJob>) {
    this.jobs = this.jobs.map(job => job.asin === asin ? { ...job, ...patch, updatedAt: this.now() } : job);
    this.emit();
  }
  private add(item: ProductItem, state: ModelJob['state']) {
    const asin = item.listing!.asin;
    if (this.jobs.length >= 30 && !this.jobs.some(job => job.asin === asin)) {
      const removable = [...this.jobs].reverse().find(job => !active(job));
      if (!removable) throw new Error('Finish an existing model before requesting another.');
      this.jobs = this.jobs.filter(job => job.asin !== removable.asin);
    }
    this.jobs = [{ asin, item, state, updatedAt: this.now() }, ...this.jobs.filter(job => job.asin !== asin)];
    this.emit();
  }
  resume() {
    this.running = true;
    for (const job of this.jobs) {
      if (job.state === 'ready' && job.item.listing) {
        // Recover a completed result even if a refresh interrupted the
        // workspace's separate save. This is reconciliation, not a new toast.
        this.options.onResult?.(job.item.id, { listing: job.item.listing, product: job.item.product });
      } else if (active(job)) {
        this.deadlines.set(job.asin, this.now() + (this.options.maxPollMs ?? 20 * 60 * 1000));
        this.schedule(job.asin, 0);
      }
    }
  }
  stop() {
    this.running = false;
    this.timers.forEach(clearTimeout); this.timers.clear();
    this.requests.forEach(controller => controller.abort()); this.requests.clear();
  }
  /** Observe an already accepted job without creating a new one. */
  track(item: ProductItem, resumeInactive = false) {
    if (item.product || item.listing?.model?.status !== 'pending') return;
    const existing = this.jobs.find(job => job.asin === item.listing?.asin);
    if (existing && (!resumeInactive || active(existing) || existing.item.product)) return;
    this.add(item, 'pending');
    this.failures.delete(item.listing.asin);
    this.deadlines.set(item.listing.asin, this.now() + (this.options.maxPollMs ?? 20 * 60 * 1000));
    this.schedule(item.listing.asin, 0);
  }
  generate(item: ProductItem) {
    const asin = item.listing?.asin;
    if (!asin || item.product) return;
    const existing = this.jobs.find(job => job.asin === asin);
    if (existing && (active(existing) || existing.item.product)) return;
    this.clearTimer(asin);
    this.add(item, 'starting');
    this.failures.delete(asin);
    this.deadlines.set(asin, this.now() + (this.options.maxPollMs ?? 20 * 60 * 1000));
    void this.request(asin, true);
  }
  check(asin: string) {
    const job = this.jobs.find(job => job.asin === asin);
    if (!job || job.item.product || this.requests.has(asin)) return;
    this.failures.delete(asin);
    this.deadlines.set(asin, this.now() + (this.options.maxPollMs ?? 20 * 60 * 1000));
    this.clearTimer(asin);
    void this.request(asin, false);
  }
  private clearTimer(asin: string) {
    const timer = this.timers.get(asin);
    if (timer) clearTimeout(timer);
    this.timers.delete(asin);
  }
  private schedule(asin: string, delay: number) {
    if (!this.running) return;
    this.clearTimer(asin);
    this.timers.set(asin, setTimeout(() => {
      this.timers.delete(asin);
      void this.request(asin, false);
    }, delay));
  }
  private async request(asin: string, start: boolean) {
    if (!this.running || this.requests.has(asin)) return;
    const job = this.jobs.find(value => value.asin === asin);
    if (!job) return;
    if (!start && this.now() >= (this.deadlines.get(asin) ?? Infinity)) {
      this.update(asin, { state: 'paused', message: 'This is taking longer than usual. Generation may still be running; check its progress again.' });
      return;
    }
    const controller = new AbortController();
    this.requests.set(asin, controller);
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? (start ? 65000 : 20000));
    if (!start) this.update(asin, { state: 'checking', message: undefined });
    let nextDelay: number | undefined;
    try {
      const result = await (start ? (this.options.generate ?? generateAmazonProductModel)(job.item.sourceUrl, controller.signal)
        : (this.options.check ?? getAmazonProductModel)(asin, controller.signal));
      if (this.requests.get(asin) !== controller || !this.running) return;
      if (controller.signal.aborted) throw new Error('Request timed out');
      if (result.listing.asin !== asin) throw new ImportError('The model did not match this product.', 'PRODUCT_MISMATCH');
      const item = resolveModelItem(job.item, job.item.id, result);
      this.failures.delete(asin);
      if (result.product) {
        this.update(asin, { item, state: 'ready', message: undefined });
        this.options.onResult?.(job.item.id, result);
        this.options.onReady?.(item);
      } else if (result.listing.model?.status === 'pending') {
        this.update(asin, { item, state: 'pending', message: undefined });
        this.options.onResult?.(job.item.id, result);
        nextDelay = this.options.pollDelayMs ?? Math.max(3000, Math.min(15000, result.listing.model.retryAfterMs ?? 4000));
      } else {
        const unavailable = result.listing.model?.status === 'storage_unavailable';
        this.update(asin, { item, state: unavailable ? 'paused' : 'failed', message: unavailable
          ? 'Model status is temporarily unavailable. Check again shortly.'
          : result.listing.model?.status === 'not_requested' ? 'Generation was not started. Choose Generate 3D model to try again.'
          : result.listing.model?.status === 'not_configured' ? '3D generation is currently unavailable.'
          : result.listing.model?.status === 'no_image' ? 'This item has no usable product photo.'
          : 'The model could not be generated. You can try again.' });
        this.options.onResult?.(job.item.id, result);
      }
    } catch (error) {
      if (this.requests.get(asin) !== controller || !this.running) return;
      const terminal = error instanceof ImportError && ['MODEL_NOT_FOUND', 'PRODUCT_MISMATCH', 'INVALID_MODEL_RESPONSE'].includes(error.code);
      const failures = (this.failures.get(asin) ?? 0) + 1;
      this.failures.set(asin, failures);
      this.update(asin, { state: terminal ? 'failed' : failures <= 3 ? 'pending' : 'paused', message: terminal
        ? 'No completed model was found. You can request it again.'
        : 'Connection interrupted. Your model may still be generating; checking its progress.' });
      // A lost POST response may already have started GPU work. Only GET status
      // is retried automatically; never submit another generation implicitly.
      if (!terminal && failures <= 3) nextDelay = this.options.pollDelayMs ?? Math.min(15000, 3000 * 2 ** (failures - 1));
    } finally {
      clearTimeout(timeout);
      if (this.requests.get(asin) === controller) {
        this.requests.delete(asin);
        if (nextDelay !== undefined) this.schedule(asin, nextDelay);
      }
    }
  }
}

export function modelJobLabel(job: ModelJob): string {
  if (job.state === 'ready') return '3D model ready';
  if (job.state === 'starting') return 'Starting 3D model…';
  if (job.state === 'failed') return 'Generation needs another try';
  if (job.state === 'paused') return 'Check model progress';
  return ({ preparing: 'Preparing product photo…', reconstructing: 'Building 3D shape…',
    texturing: 'Adding its appearance…', exporting: 'Finishing 3D model…' } as const)[job.item.listing?.model?.stage ?? 'preparing'];
}
