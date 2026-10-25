import { useEffect, useRef, useState } from 'react';
import { Box, ExternalLink, ImageOff, LoaderCircle, Search, Star } from 'lucide-react';
import { importAmazonProduct } from '../lib/amazon';
import { searchAmazonProducts } from '../lib/amazon-search';
import type { AmazonSearchProduct, AmazonSearchResults } from '../lib/amazon-search';
import { createImportedItem } from '../lib/workspace';
import type { ProductItem } from '../lib/workspace';
import Modal from './Modal';

interface SearchFailure { message: string; page: number }
interface ProductFailure { asin: string; message: string }

function ProductPhoto({ product }: { product: AmazonSearchProduct }) {
  const [failed, setFailed] = useState(false);
  return <div className="amazon-result-photo">{product.imageUrl && !failed
    ? <img src={product.imageUrl} alt={product.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : <div className="amazon-photo-missing"><ImageOff size={30}/><span>Photo unavailable</span></div>}</div>;
}

function priceText(product: AmazonSearchProduct) {
  if (!product.price) return null;
  if (product.price.display) return product.price.display;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: product.price.currency }).format(product.price.amount); }
  catch { return `${product.price.amount.toFixed(2)} ${product.price.currency}`; }
}

export default function AmazonSearch({ initialQuery, buttonLabel, onClose, onProduct }: {
  initialQuery: string; buttonLabel: string; onClose: () => void; onProduct: (item: ProductItem) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<AmazonSearchResults | null>(null);
  const [searching, setSearching] = useState<'initial' | 'more' | null>('initial');
  const [searchError, setSearchError] = useState<SearchFailure | null>(null);
  const [productError, setProductError] = useState<ProductFailure | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const importRequest = useRef<AbortController | null>(null);
  const resultRegion = useRef<HTMLDivElement | null>(null);
  const addingToLayout = /layout/i.test(buttonLabel);

  const cancelRequests = () => {
    searchRequest.current?.abort(); searchRequest.current = null;
    importRequest.current?.abort(); importRequest.current = null;
  };
  const close = () => { cancelRequests(); onClose(); };
  const runSearch = async (value: string, page = 1) => {
    const term = value.trim();
    cancelRequests(); setImporting(null); setProductError(null); setSearchError(null);
    if (!term) { setSearching(null); setSearchError({ message: 'Enter a product to search for, such as a lamp or dining table.', page: 1 }); return; }
    const controller = new AbortController();
    searchRequest.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 65000);
    setSearching(page === 1 ? 'initial' : 'more');
    if (page === 1) { setResults(null); resultRegion.current?.scrollTo({ top: 0 }); }
    try {
      const data = await searchAmazonProducts(term, page, controller.signal);
      if (searchRequest.current !== controller) return;
      setResults(previous => {
        if (page === 1 || !previous || previous.query !== data.query) return data;
        const seen = new Set(previous.products.map(product => product.asin));
        return { ...data, products: [...previous.products, ...data.products.filter(product => !seen.has(product.asin))] };
      });
    } catch (caught) {
      if (searchRequest.current !== controller) return;
      setSearchError({
        message: timedOut ? 'Amazon is taking longer than expected. Try again shortly.' : caught instanceof Error ? caught.message : 'We couldn’t search Amazon. Please try again.',
        page,
      });
    } finally {
      clearTimeout(timeout);
      if (searchRequest.current === controller) { searchRequest.current = null; setSearching(null); }
    }
  };
  useEffect(() => {
    const initialSearch = setTimeout(() => { void runSearch(initialQuery); }, 0);
    return () => { clearTimeout(initialSearch); cancelRequests(); };
    // Each dialog starts one search; subsequent searches use the form below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const chooseProduct = async (product: AmazonSearchProduct) => {
    if (importRequest.current) return;
    searchRequest.current?.abort(); searchRequest.current = null; setSearching(null);
    const controller = new AbortController();
    importRequest.current = controller;
    setImporting(product.asin); setProductError(null);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 65000);
    try {
      const imported = await importAmazonProduct(product.url, controller.signal);
      if (importRequest.current !== controller) return;
      const item = createImportedItem(imported.listing, imported.product);
      onProduct(item);
    } catch (caught) {
      if (importRequest.current !== controller) return;
      setProductError({ asin: product.asin,
        message: timedOut ? 'This product is taking longer than expected. Please try again.' : caught instanceof Error ? caught.message : 'We couldn’t open this product. Please try again.',
      });
    } finally {
      clearTimeout(timeout);
      if (importRequest.current === controller) { importRequest.current = null; setImporting(null); }
    }
  };
  const count = results?.products.length ?? 0;
  return <Modal label="Search Amazon products" onClose={close} className="amazon-search-modal">
    <div className="amazon-search-header">
      <h2>Browse Amazon</h2>
      <p>Products with a matching 3D model can be previewed in AR.</p>
      <form className="amazon-results-search" role="search" onSubmit={event => { event.preventDefault(); void runSearch(query); }}>
        <div className="product-link-field"><Search size={18}/><input type="search" aria-label="Search within Amazon" autoFocus value={query} maxLength={200} placeholder="Lamps, dining tables, sofas…" onChange={event => {
          cancelRequests(); setSearching(null); setImporting(null); setSearchError(null); setProductError(null); setQuery(event.target.value);
        }}/></div>
        <button type="submit" className="button primary">Search</button>
      </form>
    </div>
    <div className="amazon-search-body" ref={resultRegion} aria-busy={searching === 'initial'}>
      {searching === 'initial' ? <div className="amazon-search-state empty-state" role="status"><LoaderCircle size={28} className="spin"/><h3>Searching Amazon</h3><p>Looking for “{query.trim()}”…</p></div> : <>
        {!results && !searchError && <div className="amazon-search-state empty-state"><Search size={28}/><h3>Search for a product</h3><p>Enter a product above, then select Search.</p></div>}
        {results && <div className="amazon-results-summary"><span role="status">{count ? `${count} ${count === 1 ? 'item' : 'items'} shown` : 'No matching items'} for <strong>“{results.query}”</strong></span><span className="amazon-model-hint"><Box size={13}/>Look for the AR model badge</span></div>}
        {results && !count && !searchError && <div className="amazon-search-state empty-state"><Search size={28}/><h3>Try a different search</h3><p>Use a broader phrase, such as “floor lamp” or “round dining table”.</p></div>}
        {searchError?.page === 1 && <div className="amazon-search-state amazon-search-error empty-state"><Search size={28}/><h3>Search failed</h3><p role="alert">{searchError.message}</p><button type="button" className="button secondary" onClick={() => void runSearch(query)}>Try again</button></div>}
        {!!count && <div className="amazon-result-grid">{results!.products.map(product => {
          const loading = importing === product.asin;
          const failure = productError?.asin === product.asin ? productError : null;
          const action = product.modelAvailable ? addingToLayout ? 'Add to layout' : 'Preview in AR' : 'View details';
          return <article className="amazon-result-card" key={product.asin}>
            <ProductPhoto key={product.imageUrl ?? 'missing'} product={product}/>
            <div className="amazon-result-info">
              <span className={`tag amazon-model-badge ${product.modelAvailable ? 'accent' : ''}`}><Box size={12}/>{product.modelAvailable ? 'AR model available' : 'Check 3D availability'}</span>
              <h3>{product.title}</h3>
              {(product.rating !== null || product.ratingsTotal !== null) && <p className="amazon-result-rating">{product.rating !== null && <><Star size={13} fill="currentColor"/><span>{product.rating.toFixed(1)}<span className="sr-only"> out of 5 stars</span></span></>}{product.ratingsTotal !== null && <span className="amazon-result-count">({product.ratingsTotal.toLocaleString()} ratings)</span>}</p>}
              <div className="amazon-result-price">{priceText(product) ? <strong>{priceText(product)}</strong> : <span>Price unavailable</span>}<a href={product.url} target="_blank" rel="noreferrer" aria-label={`View ${product.title} on Amazon`}><ExternalLink size={14}/></a></div>
              {product.availability && <p className="amazon-result-availability">{product.availability}</p>}
              <button className={`button ${product.modelAvailable ? 'primary' : 'secondary'}`} type="button" aria-label={`${action}: ${product.title}`} disabled={!!importing} onClick={() => void chooseProduct(product)}>{loading && <LoaderCircle size={16} className="spin"/>}{loading ? 'Checking saved model…' : action}</button>
              {failure && <div className="amazon-product-error"><p role="alert">{failure.message}</p></div>}
            </div>
          </article>;
        })}</div>}
        {searchError && searchError.page > 1 && <div className="amazon-more-error"><p role="alert">{searchError.message}</p><button className="button secondary" type="button" onClick={() => void runSearch(results?.query ?? query, searchError.page)}>Try loading more</button></div>}
        {results?.nextPage && !searchError && <div className="amazon-load-more"><button type="button" className="button secondary" disabled={!!searching || !!importing} onClick={() => void runSearch(results.query, results.nextPage!)}>{searching === 'more' ? <><LoaderCircle size={16} className="spin"/>Finding more items…</> : 'Load more products'}</button></div>}
      </>}
    </div>
    <div className="amazon-search-footer"><p>{importing ? 'Opening the product and checking for a saved 3D model…' : 'Products without a 3D model can still be saved for later.'}</p>{importing ? <button type="button" className="text-button" onClick={() => { importRequest.current?.abort(); importRequest.current = null; setImporting(null); }}>Cancel</button> : <span>Prices and availability may change.</span>}</div>
  </Modal>;
}
