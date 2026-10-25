import { useEffect, useRef, useState } from 'react';
import { ModelJobs } from './model-jobs';
import type { AmazonProductResult } from './amazon';
import type { ProductItem } from './workspace';

export function useModelJobs(onResult: (id: string, result: AmazonProductResult) => void, onReady: (item: ProductItem) => void) {
  const callbacks = useRef({ onResult, onReady }); callbacks.current = { onResult, onReady };
  const [manager] = useState(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Browsing still works with storage disabled. */ }
    return new ModelJobs({ storage, onResult: (id, result) => callbacks.current.onResult(id, result),
      onReady: item => callbacks.current.onReady(item) });
  });
  const [jobs, setJobs] = useState(manager.getSnapshot);
  useEffect(() => {
    const unsubscribe = manager.subscribe(() => setJobs(manager.getSnapshot()));
    manager.resume();
    return () => { unsubscribe(); manager.stop(); };
  }, [manager]);
  return { jobs, manager };
}
