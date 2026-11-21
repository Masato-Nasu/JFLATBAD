import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const sources = await Promise.all(['catalog', 'figures', 'api', 'history'].map((name) =>
  readFile(new URL('../src/' + name + '.js', import.meta.url), 'utf8')
));
const { CATALOG, archivedBatch, readSearchHistory, persistSearchBatch, serializeSearchHistory, parseSearchHistory } =
  runInNewContext(sources.join('\n') + '\n({ CATALOG, archivedBatch, readSearchHistory, persistSearchBatch, serializeSearchHistory, parseSearchHistory });');

const sample = CATALOG[0];
const batch = {
  id: 'test-1', savedAt: 1795280400000,
  spec: { query: '冷蔵庫', subject: '冷蔵庫', filter: 'all', random: false, source: 'ai' },
  records: [{
    ...sample, id: 'gen-test-1-1', source: 'ai', slot: 1, number: '特開無2026-200001',
    citations: ['gen-test-1-2', sample.id],
    figure: {
      caption: '冷蔵庫の斜視図', hidden: '', contour: 'M 120 140 L 205 75 H 415 V 200 L 330 265 H 120 Z',
      parts: [
        { name: 'カバー', x: 120, y: 160, labelX: 58, labelY: 164 },
        { name: '回転棚', x: 390, y: 218, labelX: 460, labelY: 242 }
      ]
    },
    apiKey: 'sk-test-do-not-export'
  }, {
    ...sample, id: 'gen-test-1-2', source: 'ai', slot: 2, figure: null, number: '特開無2026-200002'
  }],
  warning: '一部の公報を取得しました。'
};

function storageFixture() {
  const contents = new Map();
  return {
    get length() { return contents.size; },
    key: (i) => [...contents.keys()][i],
    getItem: (key) => contents.get(key) ?? null,
    setItem: (key, value) => contents.set(key, value)
  };
}

test('writes a portable JSON backup of generated publications and drawings without the key', () => {
  const json = serializeSearchHistory([batch, {
    id: 'sample-search', savedAt: batch.savedAt, spec: { ...batch.spec, source: 'sample' }, records: CATALOG
  }]);
  assert.doesNotMatch(json, /sk-test-do-not-export|apiKey/);
  const [reopened, samples] = parseSearchHistory(json);
  assert.equal(reopened.spec.query, batch.spec.query);
  assert.equal(reopened.savedAt, batch.savedAt);
  assert.equal(reopened.records[0].figure.contour, batch.records[0].figure.contour);
  assert.equal(reopened.records[0].figure.parts[1].name, '回転棚');
  assert.equal(reopened.records[0].claims[0], batch.records[0].claims[0]);
  assert.equal(reopened.records[0].number, batch.records[0].number);
  assert.equal(reopened.records[0].citations[0], 'gen-test-1-2');
  assert.equal(reopened.records[1].figure, null);
  assert.ok(samples.records.every((entry) => entry.figure?.contour));
});

test('keeps independent searches and does not overwrite an existing search on import', () => {
  const storage = storageFixture();
  const first = archivedBatch(batch);
  storage.setItem('jflatbad:history:damaged', '{');
  assert.equal(persistSearchBatch(storage, first).added, true);
  const duplicate = archivedBatch({ ...batch, spec: { ...batch.spec, query: '重複' } });
  assert.equal(persistSearchBatch(storage, duplicate).added, false);
  assert.equal(persistSearchBatch(storage, archivedBatch({ ...batch, id: 'test-2' })).added, true);
  const reopened = readSearchHistory(storage);
  assert.equal(reopened.size, 2);
  assert.equal(reopened.get('test-1').spec.query, '冷蔵庫');
  assert.ok(reopened.has('test-2'));
});

test('rejects incompatible or damaged JSON and reports storage write failure', () => {
  const file = JSON.parse(serializeSearchHistory([batch]));
  assert.throws(() => parseSearchHistory(JSON.stringify({ ...file, version: 2 })));
  file.batches[0].records[0].date = null;
  assert.throws(() => parseSearchHistory(JSON.stringify(file)));
  const storage = storageFixture();
  storage.setItem = () => { throw new Error('Storage quota exceeded'); };
  assert.equal(persistSearchBatch(storage, archivedBatch(batch)), null);
  assert.equal(readSearchHistory(storage).size, 0);
});
