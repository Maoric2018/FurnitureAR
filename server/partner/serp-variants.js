// Documented fields: https://serpapi.com/amazon-product-api . Variant images
// are image references, not measured material colors or AR assets.
function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(record, key) {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asin(value) {
  const candidate = text(value)?.toUpperCase();
  return candidate && /^[A-Z0-9]{10}$/.test(candidate) ? candidate : null;
}

function boolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!url.hostname || url.username || url.password) return null;
    // Match the product normalizer's policy, including percent-encoded keys.
    if ([...url.searchParams.keys()].some((key) => /^(?:api[_-]?key|access[_-]?token|token)$/i.test(key))) return null;
    return url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function groupKind(title) {
  const normalized = title.trim().replace(/:$/, '').trim().replace(/[_\s]+/g, ' ').toLowerCase();
  return /^(?:color|colour)(?: name)?$/.test(normalized) ? 'color' : 'other';
}

function normalizeGroup(group) {
  if (!plainRecord(group)) return [];
  const title = own(group, 'title');
  if (!text(title)) return [];
  const items = own(group, 'items');
  const options = (Array.isArray(items) ? items : []).flatMap((item) => {
    if (!plainRecord(item)) return [];
    const label = text(own(item, 'name'));
    if (!label) return [];
    return [{
      label,
      asin: asin(own(item, 'asin')),
      imageUrl: httpsUrl(own(item, 'image')),
      selected: boolean(own(item, 'selected')),
      unavailable: boolean(own(item, 'unavailable')),
      available: boolean(own(item, 'available')),
    }];
  });
  return [{ title, kind: groupKind(title), options }];
}

function normalizeCombination(combination) {
  if (!plainRecord(combination)) return [];
  const dimensions = own(combination, 'dimensions');
  if (!plainRecord(dimensions)) return [];
  const entries = Object.keys(dimensions).map((key) => [key, text(own(dimensions, key))]);
  // Dropping a malformed dimension would change the meaning of the remaining
  // combination, so only complete, explicitly supplied maps are retained.
  if (!entries.length || entries.some(([key, value]) => !text(key) || value === null)) return [];
  return [{
    // fromEntries preserves own keys such as __proto__ without invoking setters.
    dimensions: Object.fromEntries(entries),
    asin: asin(own(combination, 'asin')),
    unavailable: boolean(own(combination, 'unavailable')),
    available: boolean(own(combination, 'available')),
  }];
}

/** Normalize supplied groups and combinations without guessing missing facts. */
export function normalizeSerpVariants(productResults) {
  if (!plainRecord(productResults)) return { variantGroups: [], variantCombinations: [] };
  const groups = own(productResults, 'variants');
  const combinations = own(productResults, 'variant_combinations');
  return {
    variantGroups: Array.isArray(groups) ? groups.flatMap(normalizeGroup) : [],
    variantCombinations: Array.isArray(combinations) ? combinations.flatMap(normalizeCombination) : [],
  };
}
