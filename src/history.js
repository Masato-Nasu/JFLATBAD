const HISTORY_PREFIX = 'jflatbad:history:';
const HISTORY_FORMAT = 'jflatbad-search-history';
const HISTORY_VERSION = 1;

function isHistoryId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value);
}

function archivedPublication(value) {
  const { id, number, date, kind, verdict, classCode, source, claims, citations, slot, figureView } = value ?? {};
  if (!isHistoryId(id) || typeof number !== 'string' || !number || typeof date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Object.hasOwn(KINDS, kind)
    || !Object.hasOwn(CLASSIFICATIONS, classCode) || !['approved', 'rejected'].includes(verdict)
    || !['ai', 'sample'].includes(source)) return null;
  if (!Array.isArray(claims) || !claims.length || !claims.every((claim) => typeof claim === 'string')
    || !Array.isArray(citations) || !citations.every(isHistoryId)
    || !TEXT_FIELDS.every((key) => typeof value[key] === 'string')) return null;
  const text = Object.fromEntries(TEXT_FIELDS.map((key) => [key, value[key]]));
  return {
    id, number, date, kind, verdict, classCode, source, ...text, claims, citations,
    slot: Number.isInteger(slot) ? slot : undefined,
    figureView: Number.isInteger(figureView) ? figureView : undefined,
    figure: publicationFigure(value)
  };
}

function archivedBatch(value) {
  const { id, savedAt, spec, records, warning } = value ?? {};
  if (!isHistoryId(id) || !Number.isSafeInteger(savedAt) || savedAt < 0 || savedAt > 8640000000000000
    || typeof spec?.query !== 'string' || typeof spec.random !== 'boolean'
    || !Object.hasOwn(FILTERS, spec.filter) || !['ai', 'sample'].includes(spec.source)
    || !Array.isArray(records) || !records.length) return null;
  const publications = records.map(archivedPublication);
  if (publications.some((record) => !record)
    || new Set(publications.map((record) => record.id)).size !== publications.length) return null;
  return {
    id, savedAt,
    spec: {
      query: spec.query, random: spec.random, filter: spec.filter, source: spec.source,
      subject: typeof spec.subject === 'string' ? spec.subject : spec.query
    },
    records: publications,
    warning: typeof warning === 'string' ? warning : ''
  };
}

function searchHistoryStorage() {
  try { return localStorage; }
  catch { return null; }
}

function readArchivedBatch(text, key) {
  try {
    const batch = JSON.parse(text);
    return key === HISTORY_PREFIX + batch?.id ? archivedBatch(batch) : null;
  } catch { return null; }
}

function readSearchHistory(storage) {
  const batches = new Map();
  if (!storage) return batches;
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key?.startsWith(HISTORY_PREFIX)) continue;
      const batch = readArchivedBatch(storage.getItem(key), key);
      if (batch) batches.set(batch.id, batch);
    }
  } catch {
    // Keep entries that were readable if the browser restricts storage.
  }
  return batches;
}

function persistSearchBatch(storage, batch) {
  if (!storage) return null;
  // Independent keys let searches from different tabs coexist.
  const key = HISTORY_PREFIX + batch.id;
  try {
    const existing = readArchivedBatch(storage.getItem(key), key);
    if (existing) return { batch: existing, added: false };
    storage.setItem(key, JSON.stringify(batch));
    return { batch, added: true };
  } catch { return null; }
}

function serializeSearchHistory(batches) {
  const archived = batches.map(archivedBatch);
  if (archived.some((batch) => !batch)) throw new Error('Invalid search batch');
  return JSON.stringify({ format: HISTORY_FORMAT, version: HISTORY_VERSION, batches: archived }, null, 2) + '\n';
}

function parseSearchHistory(text) {
  const file = JSON.parse(text);
  if (file?.format !== HISTORY_FORMAT || file.version !== HISTORY_VERSION || !Array.isArray(file.batches)
    || !file.batches.length) throw new Error('Invalid history file');
  const batches = file.batches.map(archivedBatch);
  if (batches.some((batch) => !batch)) throw new Error('Invalid search batch');
  return batches;
}
