// Color choices come from the fetched Amazon listing, not a generic palette.
// SerpApi documents these groups and combinations at:
// https://serpapi.com/amazon-product-api
const unconfirmed = () => ({ status: 'unconfirmed', options: [] });
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const credentialName = /^(?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|auth|authorization|password|secret|client[_-]?secret|credential|signature|sig|x-amz-(?:credential|signature|security-token))$/i;
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identity = value => typeof value === 'string' && /^[a-z0-9]{10}$/i.test(value) ? value.toUpperCase() : null;
const key = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid label');
  return value.trim();
}
function axis(value) {
  const name = key(label(value).replace(/:$/, '').replace(/_/g, ' '));
  if (/^(?:color|colour)(?: name)?$/.test(name)) return 'color';
  return name.replace(/^(size|style|pattern) name$/, '$1');
}
function flag(value) {
  if (value !== undefined && value !== null && typeof value !== 'boolean') throw new Error('Invalid flag');
  return value;
}
function unavailable(value) {
  const absent = flag(own(value, 'unavailable')), present = flag(own(value, 'available'));
  return absent === true || present === false;
}
function imageUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash
        || [...url.searchParams.keys()].some(name => credentialName.test(name))) return null;
    return value;
  } catch { return null; }
}
function dimensions(value) {
  if (!record(value) || !Object.keys(value).length || Object.keys(value).length > 20) throw new Error('Invalid dimensions');
  const result = new Map();
  for (const name of Object.keys(value)) {
    const normalized = axis(name);
    if (result.has(normalized)) throw new Error('Ambiguous axes');
    result.set(normalized, label(own(value, name)));
  }
  if (!result.has('color')) throw new Error('Missing color dimension');
  return result;
}
function sameConfiguration(a, b) {
  const entries = [...a].filter(([name]) => name !== 'color');
  return entries.length === [...b].filter(([name]) => name !== 'color').length
    && entries.every(([name, value]) => b.has(name) && key(b.get(name)) === key(value));
}

/** Return observed, same-configuration choices. This is not a live stock check. */
export function resolveAmazonColors(productResults, requestedAsin, selectedColor) {
  try {
    const asin = identity(requestedAsin);
    if (!asin || !record(productResults)) return unconfirmed();
    const rawGroups = own(productResults, 'variants');
    if (!Array.isArray(rawGroups) || !rawGroups.length || rawGroups.length > 20) return unconfirmed();
    const axes = new Set();
    const groups = rawGroups.map(group => {
      if (!record(group)) throw new Error('Invalid group');
      const name = axis(own(group, 'title'));
      const rawOptions = own(group, 'items');
      if (axes.has(name) || !Array.isArray(rawOptions) || !rawOptions.length || rawOptions.length > 100) throw new Error('Ambiguous group');
      axes.add(name);
      const labels = new Set(), identities = new Set();
      const options = rawOptions.map(option => {
        if (!record(option)) throw new Error('Invalid option');
        const name = label(own(option, 'name')), rawAsin = own(option, 'asin'), asin = identity(rawAsin);
        if (rawAsin !== undefined && rawAsin !== null && !asin) throw new Error('Invalid identity');
        if (labels.has(key(name)) || (asin && identities.has(asin))) throw new Error('Ambiguous option');
        labels.add(key(name));
        if (asin) identities.add(asin);
        return { name, asin, imageUrl: imageUrl(own(option, 'image')),
          selected: flag(own(option, 'selected')) === true, unavailable: unavailable(option) };
      });
      if (options.filter(option => option.selected).length > 1) throw new Error('Ambiguous selection');
      return { name, options };
    });
    const colors = groups.find(group => group.name === 'color');
    if (!colors) return unconfirmed();
    const rawCombinations = own(productResults, 'variant_combinations');
    if (rawCombinations !== undefined && rawCombinations !== null && !Array.isArray(rawCombinations)) return unconfirmed();
    if (rawCombinations?.length > 1000) return unconfirmed();
    const combinationIdentities = new Set();
    const combinations = (rawCombinations || []).map(combination => {
      if (!record(combination)) throw new Error('Invalid combination');
      const missing = unavailable(combination), rawAsin = own(combination, 'asin'), asin = identity(rawAsin);
      if (rawAsin !== undefined && rawAsin !== null && !asin) throw new Error('Invalid combination identity');
      // Documented unavailable combinations may deliberately omit the ASIN.
      if (!asin && !missing) throw new Error('Missing identity');
      if (asin && combinationIdentities.has(asin)) throw new Error('Ambiguous combination identity');
      if (asin) combinationIdentities.add(asin);
      return { asin, unavailable: missing, dimensions: dimensions(own(combination, 'dimensions')) };
    });
    const currentMatches = combinations.filter(combination => combination.asin === asin);
    let current;
    if (combinations.length) {
      if (currentMatches.length !== 1 || currentMatches[0].unavailable) return unconfirmed();
      current = currentMatches[0];
      for (const group of groups.filter(group => group.name !== 'color')) {
        const selected = group.options.find(option => option.selected);
        if (!current.dimensions.has(group.name) || (selected && (selected.unavailable
            || key(selected.name) !== key(current.dimensions.get(group.name))))) return unconfirmed();
      }
    } else if (groups.some(group => group.name !== 'color')) {
      // A color swatch can point at a different size or style. Without a
      // combination map there is no evidence that the other axes are retained.
      return unconfirmed();
    }
    const options = [], seen = new Set();
    for (const color of colors.options) {
      let optionAsin = color.asin;
      let missing = color.unavailable;
      if (current) {
        const matches = combinations.filter(combination => key(combination.dimensions.get('color')) === key(color.name)
          && sameConfiguration(current.dimensions, combination.dimensions));
        if (matches.length > 1) return unconfirmed();
        if (!matches.length) {
          if (color.selected || color.asin === asin) return unconfirmed();
          continue;
        }
        optionAsin = matches[0].asin;
        missing ||= matches[0].unavailable;
      }
      if (color.selected && optionAsin !== asin) return unconfirmed();
      if (missing) {
        if (optionAsin === asin || color.selected) return unconfirmed();
        continue;
      }
      if (!optionAsin || seen.has(optionAsin)) return unconfirmed();
      seen.add(optionAsin);
      options.push({ asin: optionAsin, name: color.name, url: `https://www.amazon.com/dp/${optionAsin}`,
        imageUrl: color.imageUrl, selected: optionAsin === asin });
    }
    const selected = options.find(option => option.selected);
    if (!selected || (selectedColor !== undefined && selectedColor !== null && key(label(selectedColor)) !== key(selected.name))
        || (current && key(current.dimensions.get('color')) !== key(selected.name))) return unconfirmed();
    return { status: 'observed', options: [selected, ...options.filter(option => option !== selected)] };
  } catch { return unconfirmed(); }
}
