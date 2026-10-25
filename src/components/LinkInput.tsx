import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowRight, Link2, LoaderCircle, Search } from 'lucide-react';
import { importAmazonProduct } from '../lib/amazon';
import { createImportedItem } from '../lib/workspace';
import type { ProductItem } from '../lib/workspace';
import AmazonSearch from './AmazonSearch';

export default function LinkInput({ onProduct, buttonLabel = 'Preview product', compact = false }: {
  onProduct: (item: ProductItem) => void; buttonLabel?: string; compact?: boolean;
}) {
  const [link, setLink] = useState('');
  const [mode, setMode] = useState<'search' | 'link'>('search');
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  const cancelImport = () => {
    request.current?.abort(); request.current = null; setBusy(false);
  };
  const changeMode = (next: 'search' | 'link') => {
    cancelImport(); setMode(next); setError('');
  };

  return <div className={`product-entry ${compact ? 'compact' : ''}`}>
    <div className="product-entry-modes segmented" role="group" aria-label="Find an Amazon product">
      <button type="button" aria-pressed={mode === 'search'} onClick={() => changeMode('search')}><Search size={14}/>Search Amazon</button>
      <button type="button" aria-pressed={mode === 'link'} onClick={() => changeMode('link')}><Link2 size={14}/>Paste link</button>
    </div>
    {mode === 'search' ? <form className={`product-link-form ${compact ? 'compact' : ''}`} onSubmit={event => {
      event.preventDefault();
      const value = query.trim();
      if (value.length < 2) { setError('Enter at least two characters, such as a lamp or dining table.'); return; }
      setError(''); setSearchQuery(value);
    }} noValidate>
      <div className={`product-link-field ${error ? 'invalid' : ''}`}><Search size={17}/><input id={fieldId} type="search" aria-label="Search Amazon products" placeholder="Lamps, dining tables, sofas…" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}/>{compact && <button aria-label="Search Amazon products" type="submit"><Search size={18}/></button>}</div>
      {!compact && <button type="submit" className="button primary">Search</button>}
      {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
    </form> : <form className={`product-link-form ${compact ? 'compact' : ''}`} onSubmit={async event => {
      event.preventDefault(); setError('');
      const url = link.trim();
      if (!url) { setError('Paste an Amazon product link first.'); return; }
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 65000);
      setBusy(true);
      try {
        const result = await importAmazonProduct(url, controller.signal);
        if (request.current !== controller) return;
        const item = createImportedItem(result.listing, result.product);
        setLink('');
        onProduct(item);
      } catch (caught) {
        if (request.current !== controller) return;
        setError(timedOut ? 'Amazon is taking longer than expected. Try again shortly.' : caught instanceof Error ? caught.message : 'We couldn’t open this product. Please try again.');
      } finally {
        clearTimeout(timeout);
        if (request.current === controller) { request.current = null; setBusy(false); }
      }
    }} noValidate>
      <div className={`product-link-field ${error ? 'invalid' : ''}`}><Link2 size={17}/><input id={fieldId} type="url" aria-label="Product link" placeholder="Paste an Amazon.com link" value={link} onChange={event => { setLink(event.target.value); setError(''); }} disabled={busy} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}/>{compact && <button aria-label={buttonLabel} disabled={busy} type="submit">{busy ? <LoaderCircle size={16} className="spin"/> : <ArrowRight size={16}/>}</button>}</div>
      {!compact && <button type="submit" className="button primary" disabled={busy}>{busy && <LoaderCircle size={16} className="spin"/>}{busy ? 'Loading product…' : buttonLabel}</button>}
      {busy && <button className="text-button cancel-product-import" type="button" onClick={cancelImport}>Cancel</button>}
      {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
    </form>}
    {searchQuery && <AmazonSearch initialQuery={searchQuery} buttonLabel={buttonLabel} onClose={() => setSearchQuery(null)} onProduct={item => {
      // Finish the search dialog's focus cleanup before the product preview opens.
      flushSync(() => setSearchQuery(null));
      onProduct(item);
    }}/>}
  </div>;
}
