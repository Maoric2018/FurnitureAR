import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowUpRight, Link2, LoaderCircle, Search } from 'lucide-react';
import { ImportError, importAmazonProduct } from '../lib/amazon';
import { createImportedItem } from '../lib/workspace';
import type { ProductItem } from '../lib/workspace';
import AmazonSearch from './AmazonSearch';

function pendingValue(key: string) {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}

export default function LinkInput({ onProduct, buttonLabel = 'Preview product', compact = false }: {
  onProduct: (item: ProductItem) => void; buttonLabel?: string; compact?: boolean;
}) {
  const [link, setLink] = useState(() => pendingValue('furniture-ar:pending-link'));
  const [mode, setMode] = useState<'search' | 'link'>(() => pendingValue('furniture-ar:pending-link') ? 'link' : 'search');
  const [query, setQuery] = useState(() => pendingValue('furniture-ar:pending-search'));
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const request = useRef<AbortController | null>(null);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  const cancelImport = () => {
    request.current?.abort(); request.current = null; setBusy(false);
  };
  const changeMode = (next: 'search' | 'link') => {
    cancelImport(); setMode(next); setError(''); setNeedsSignIn(false);
  };

  return <div className={`product-entry ${compact ? 'compact' : ''}`}>
    <div className="product-entry-modes" role="group" aria-label="Find an Amazon product">
      <button type="button" aria-pressed={mode === 'search'} onClick={() => changeMode('search')}><Search size={14}/>Search Amazon</button>
      <button type="button" aria-pressed={mode === 'link'} onClick={() => changeMode('link')}><Link2 size={14}/>Paste link</button>
    </div>
    {mode === 'search' ? <form className={`product-link-form amazon-search-entry ${compact ? 'compact' : ''}`} onSubmit={event => {
      event.preventDefault();
      const value = query.trim();
      if (value.length < 2) { setError('Enter at least two characters, such as a lamp or dining table.'); return; }
      setError(''); setSearchQuery(value);
    }} noValidate>
      <div className={`product-link-field ${error ? 'invalid' : ''}`}><Search size={17}/><input id={fieldId} type="search" aria-label="Search Amazon products" placeholder="Lamps, dining tables, sofas…" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}/>{compact && <button aria-label="Search Amazon products" type="submit"><Search size={18}/></button>}</div>
      {!compact && <button type="submit" className="button primary">Find furniture<Search size={17}/></button>}
      {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
    </form> : <form className={`product-link-form ${compact ? 'compact' : ''}`} onSubmit={async event => {
      event.preventDefault(); setError(''); setNeedsSignIn(false);
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
        try { sessionStorage.removeItem('furniture-ar:pending-link'); } catch { /* Storage is optional. */ }
        onProduct(item);
      } catch (caught) {
        if (request.current !== controller) return;
        setNeedsSignIn(caught instanceof ImportError && caught.code === 'SIGN_IN_REQUIRED');
        setError(timedOut ? 'Amazon is taking longer than expected. Try again shortly.' : caught instanceof Error ? caught.message : 'We couldn’t open this product. Please try again.');
      } finally {
        clearTimeout(timeout);
        if (request.current === controller) { request.current = null; setBusy(false); }
      }
    }} noValidate>
      <div className={`product-link-field ${error ? 'invalid' : ''}`}><Link2 size={17}/><input id={fieldId} type="url" aria-label="Product link" placeholder="Paste an Amazon.com link" value={link} onChange={event => { setLink(event.target.value); setError(''); setNeedsSignIn(false); }} disabled={busy} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}/>{compact && <button aria-label={buttonLabel} disabled={busy} type="submit">{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowUpRight size={18}/>}</button>}</div>
      {!compact && <button type="submit" className="button primary" disabled={busy}>{busy ? 'Loading product…' : buttonLabel}{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowUpRight size={17}/>}</button>}
      {busy && <button className="text-button cancel-product-import" type="button" onClick={cancelImport}>Cancel</button>}
      {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
      {needsSignIn && <a className="text-button" href="/signin-with-chatgpt?return_to=%2F" target="_top" onClick={() => { try { sessionStorage.setItem('furniture-ar:pending-link', link); } catch { /* Storage is optional. */ } }}>Sign in to continue <ArrowUpRight size={15}/></a>}
    </form>}
    {searchQuery && <AmazonSearch initialQuery={searchQuery} buttonLabel={buttonLabel} onClose={() => setSearchQuery(null)} onProduct={item => {
      // Finish the search dialog's focus cleanup before the product preview opens.
      flushSync(() => setSearchQuery(null));
      onProduct(item);
    }}/>}
  </div>;
}
