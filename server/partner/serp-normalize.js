// Response schemas: https://serpapi.com/amazon-product-api and
// https://serpapi.com/amazon-product-product-details . No raw provider response
// is returned to the mobile client (provider links can contain credentials).
const AXES = ['height', 'width', 'length'];
const FACTORS = new Map([
  ['in', 0.0254], ['inch', 0.0254], ['inches', 0.0254], ['"', 0.0254], ['″', 0.0254],
  ['cm', 0.01], ['centimeter', 0.01], ['centimeters', 0.01], ['centimetre', 0.01], ['centimetres', 0.01],
  ['mm', 0.001], ['millimeter', 0.001], ['millimeters', 0.001], ['millimetre', 0.001], ['millimetres', 0.001],
  ['m', 1], ['meter', 1], ['meters', 1], ['metre', 1], ['metres', 1],
  ['ft', 0.3048], ['foot', 0.3048], ['feet', 0.3048], ["'", 0.3048], ['′', 0.3048],
]);
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const UNIT = String.raw`(?:centimeters?|centimetres?|millimeters?|millimetres?|inches|inch|meters?|metres?|feet|foot|cm|mm|in|ft|m|["″'′])`;
const AXIS = String.raw`(?:height|width|length|depth|[HWLD])`;
const SEPARATOR = String.raw`\s*[x×]\s*`;
const ORDER = new RegExp(`^(${AXIS})${SEPARATOR}(${AXIS})${SEPARATOR}(${AXIS})$`, 'i');

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asin(value) {
  const candidate = text(value)?.toUpperCase();
  return candidate && /^[A-Z0-9]{10}$/.test(candidate) ? candidate : null;
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!url.hostname || url.username || url.password) return null;
    // Never expose a provider API key in images or links, including encoded keys.
    if ([...url.searchParams.keys()].some((key) => /^(?:api[_-]?key|access[_-]?token|token)$/i.test(key))) return null;
    return url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function normalizeImages(product) {
  const thumbnails = Array.isArray(product?.thumbnails) ? product.thumbnails : [];
  const candidates = thumbnails.length ? thumbnails : [product?.thumbnail];
  const seen = new Set();
  return candidates.flatMap((image) => {
    const url = httpsUrl(typeof image === 'string' ? image : image?.url ?? image?.link);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, width: positive(image?.width), height: positive(image?.height) }];
  });
}

function brandName(value) {
  const name = text(value) ?? text(value?.name);
  return name ? text(name.replace(/^Brand:\s*/i, '')) : null;
}

function currencyFor(display, amazonDomain) {
  if (!display) return null;
  const explicit = display.match(/\b(USD|EUR|GBP|CAD|AUD|JPY|INR|BRL|MXN|AED|SAR|SGD|SEK|PLN|TRY)\b/i)?.[1];
  if (explicit) return explicit.toUpperCase();
  if (/^US\$/.test(display)) return 'USD';
  if (/^CA?\$/.test(display)) return 'CAD';
  if (/^A\$/.test(display)) return 'AUD';
  if (/^R\$/.test(display)) return 'BRL';
  if (/^€/.test(display)) return 'EUR';
  if (/^£/.test(display)) return 'GBP';
  if (/^₹/.test(display)) return 'INR';
  // A bare dollar sign is only USD when the caller/request establishes US Amazon.
  return /^\$/.test(display) && amazonDomain === 'amazon.com' ? 'USD' : null;
}

function price(offer, amazonDomain) {
  const amount = offer?.extracted_price;
  const display = text(offer?.price);
  const currency = currencyFor(display, amazonDomain);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !currency) return null;
  return { amount, currency, display };
}

function normalizeOffer(data, amazonDomain) {
  const main = data?.product_results;
  // Retain stock and price from the same offer. Do not substitute subscription,
  // used, crossed-out, unit, or unrelated seller prices for the main offer.
  for (const offer of [main, data?.purchase_options?.single_offer, data?.purchase_options?.buy_new]) {
    const currentPrice = price(offer, amazonDomain);
    if (currentPrice) return { price: currentPrice, availability: text(offer?.stock) };
  }
  return { price: null, availability: text(main?.stock) };
}

function axisName(value) {
  return { h: 'height', w: 'width', l: 'length', d: 'length' }[value.toLowerCase()[0]];
}

function dimensionsFromPairs(pairs) {
  const raw = Object.fromEntries(AXES.map((axis) => [axis, null]));
  const meters = { ...raw };
  for (const { label, value, unit } of pairs) {
    const axis = axisName(label);
    const factor = FACTORS.get(unit.toLowerCase());
    if (!axis || raw[axis] || !factor || !positive(value)) return null;
    raw[axis] = { value, unit };
    meters[axis] = value * factor;
    if (!positive(meters[axis])) return null;
  }
  return {
    source: 'serpapi-product-dimensions', raw, meters,
    complete: AXES.every((axis) => meters[axis] !== null), needsVerification: true,
  };
}

function parseDimensions(value, explicitOrder = null) {
  if (!text(value) || /\b(?:package|packaging|shipping|carton)\b/i.test(value)) return null;
  let body = value.trim();
  // An explicitly supplied order such as "(L x W x H)" makes an otherwise
  // unlabeled triple usable. A bare "10 x 20 x 30 inches" remains ambiguous.
  const suffix = body.match(/\(([^()]*)\)\s*$/);
  if (suffix && ORDER.test(suffix[1])) {
    if (explicitOrder) {
      const supplied = explicitOrder.match(ORDER);
      const trailing = suffix[1].match(ORDER);
      if (!supplied || [1, 2, 3].some((index) => axisName(supplied[index]) !== axisName(trailing[index]))) return null;
    }
    explicitOrder = suffix[1];
    body = body.slice(0, suffix.index).trim();
  }
  const order = explicitOrder?.match(ORDER);
  if (explicitOrder) {
    const numbers = body.match(new RegExp(`^(${NUMBER})${SEPARATOR}(${NUMBER})${SEPARATOR}(${NUMBER})\\s*(${UNIT})$`, 'i'));
    if (!order) return null;
    if (numbers) return dimensionsFromPairs([1, 2, 3].map((index) => ({ label: order[index], value: Number(numbers[index]), unit: numbers[4] })));
  }
  const components = body.split(/\s*[x×,;]\s*/i);
  if (components.length > 3) return null;
  const pairs = [];
  for (const component of components) {
    const after = component.match(new RegExp(`^(${NUMBER})\\s*(${UNIT})\\s*(${AXIS})$`, 'i'));
    const before = component.match(new RegExp(`^(${AXIS})\\s*:?\\s*(${NUMBER})\\s*(${UNIT})$`, 'i'));
    if (after) pairs.push({ label: after[3], value: Number(after[1]), unit: after[2] });
    else if (before) pairs.push({ label: before[1], value: Number(before[2]), unit: before[3] });
    else return null;
  }
  // Ordered catalog fields can also repeat labels on each measurement. Accept
  // those labels only when all three agree with the field's stated order.
  if (order && (pairs.length !== 3 || pairs.some(({ label }, index) => axisName(label) !== axisName(order[index + 1])))) return null;
  return pairs.length ? dimensionsFromPairs(pairs) : null;
}

function normalizeDimensions(data) {
  const candidates = [];
  for (const source of [data?.product_details, data?.item_specifications]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
      const match = normalizedKey.match(/^(?:product|item)_dimensions(?:_([ld])_x_w_x_h)?$/);
      if (!match || !text(value)) continue;
      candidates.push({ value: text(value), order: match[1] ? `${match[1]} x W x H` : null });
    }
  }
  if (!candidates.length) return { dimensionText: null, dimensions: null };
  const dimensionText = [...new Set(candidates.map(({ value }) => value))].join(' | ');
  const parsed = candidates.map(({ value, order }) => parseDimensions(value, order));
  // Amazon often repeats a fully labeled measurement as an unlabeled triple.
  // Keep the labeled axes only when that duplicate has exactly the same three
  // lengths. An unlabeled triple by itself still cannot establish dimensions.
  const first = parsed.find(item => item?.complete) || parsed[0];
  const agree = first && parsed.every((item, index) => {
    if (item) return AXES.every(axis => item.meters[axis] === first.meters[axis]);
    if (!first.complete || candidates[index].order) return false;
    const numbers = candidates[index].value.match(new RegExp(`^(${NUMBER})${SEPARATOR}(${NUMBER})${SEPARATOR}(${NUMBER})\\s*(${UNIT})$`, 'i'));
    const factor = numbers && FACTORS.get(numbers[4].toLowerCase());
    if (!numbers || !factor) return false;
    const actual = [1, 2, 3].map(i => Number(numbers[i]) * factor).sort((a,b) => a-b);
    const expected = AXES.map(axis => first.meters[axis]).sort((a,b) => a-b);
    return actual.every((value, i) => Math.abs(value - expected[i]) < 1e-9);
  });
  return { dimensionText, dimensions: agree ? first : null };
}

function canonicalProductUrl(productAsin, amazonDomain) {
  // The integration currently targets US Amazon. Product Results links can be
  // category or Prime signup links, so they are deliberately not used here.
  return productAsin && amazonDomain === 'amazon.com' ? `https://www.amazon.com/dp/${productAsin}` : null;
}

/** Normalize one Amazon Product response. The default domain matches this US backend. */
export function normalizeSerpProduct(data, requestedAsin, amazonDomain = 'amazon.com') {
  const product = data?.product_results;
  const domain = text(data?.search_parameters?.amazon_domain) ?? amazonDomain;
  const productAsin = asin(data?.product_details?.asin) ?? asin(product?.asin) ?? asin(requestedAsin);
  const offer = normalizeOffer(data, domain);
  return {
    asin: productAsin,
    title: text(product?.title),
    brand: brandName(data?.product_details?.brand) ?? brandName(data?.product_details?.brand_name)
      ?? brandName(data?.item_specifications?.brand) ?? brandName(product?.brand),
    productUrl: canonicalProductUrl(productAsin, domain),
    images: normalizeImages(product),
    price: offer.price,
    availability: offer.availability,
    features: Array.isArray(data?.about_item) ? data.about_item.map(text).filter(Boolean) : [],
    ...normalizeDimensions(data),
    model: null,
  };
}

/** Search results contain only summaries; detailed dimensions require a lookup. */
export function normalizeSerpSearchItem(item, amazonDomain = 'amazon.com') {
  const productAsin = asin(item?.asin);
  return {
    asin: productAsin, title: text(item?.title), brand: brandName(item?.brand),
    productUrl: canonicalProductUrl(productAsin, amazonDomain),
    images: normalizeImages(item), price: price(item, amazonDomain), availability: text(item?.stock),
    features: [], dimensionText: null, dimensions: null, model: null,
  };
}
