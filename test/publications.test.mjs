import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const scripts = await Promise.all(['catalog', 'figures', 'api'].map((name) =>
  readFile(new URL('../src/' + name + '.js', import.meta.url), 'utf8')
));
const source = scripts.join('\n') + '\n({ generatePublications, readPublicationRows });';

function mockPublication(slot, changes = {}) {
  return {
    slot, title: '車両用作品番号' + slot,
    abstract: '車両の収納部の使用を抑制する。',
    field: '車内の収納設備に関する。',
    background: '収納部は、移動中に物品が散乱しないよう設けられる。',
    problem: '収納を容易にすることで収納部の使用頻度が上がる問題を解決する。',
    solution: '複数のトレーと開閉弁により収納部への物品の挿入を制限する。',
    effect: '収納部に空間を保つことができる。',
    review: '収納部への挿入制限が適切に機能することを確認した。',
    classCode: 'A01',
    claims: ['複数のトレーと、収納部を覆う開閉弁とを備える装置。'],
    citations: [],
    figure: {
      caption: '車内収納部の構成図',
      contour: 'M 110 80 H 430 V 230 H 110 Z M 130 120 H 400',
      hidden: '',
      parts: [
        { name: '開閉弁', x: 130, y: 120, labelX: 60, labelY: 105 },
        { name: 'トレー', x: 400, y: 120, labelX: 490, labelY: 110 }
      ]
    },
    ...changes
  };
}

function envelope(text, status = 'completed', reason) {
  return {
    status,
    incomplete_details: reason ? { reason } : null,
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }]
  };
}

function fakeAPI(handler) {
  const requests = [];
  const api = runInNewContext(source, {
    crypto: webcrypto, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.input);
      requests.push({ body, input });
      return handler(input.slots, requests.length);
    }
  });
  const run = (onProgress) => api.generatePublications({
    subject: '車', random: false, filter: 'all', recentTitles: [],
    model: 'gpt-5.4-mini', key: 'test-key', signal: new AbortController().signal, onProgress
  });
  return { run, requests };
}

test('keeps complete car publications from a truncated response and only requests missing slots', async () => {
  const api = fakeAPI((slots, call) => {
    const records = slots.map(({ slot }) => mockPublication(slot));
    if (call === 1) {
      records[0].background = '寸法の限られた車内について、機器の構成と収納する条件を定める。'.repeat(12);
      records[0].citations = [3];
      records[1].figure = { parts: [] };
      const prefix = '{"publications":[' + records.slice(0, 2).map((row) => JSON.stringify(row)).join(',');
      return Response.json(envelope(prefix + ',{"slot":3,"title":"途中', 'incomplete', 'max_output_tokens'));
    }
    return Response.json(envelope(JSON.stringify({ publications: records })));
  });
  const progress = [];
  const { entries } = await api.run((state) => progress.push({ ...state }));
  assert.deepEqual(api.requests.map(({ input }) => input.slots.map(({ slot }) => slot)), [
    [1, 2, 3, 4], [5, 6, 7, 8], [3, 4]
  ]);
  assert.ok(api.requests.every(({ input }) => input.subject === '車'));
  assert.ok(progress.some(({ count, refilling }) => count === 6 && refilling));
  assert.equal(entries.length, 8);
  assert.ok(entries[0].background.length > 210);
  assert.deepEqual(Array.from(entries[0].citations), [3]);
  assert.equal(entries[1].figure, null);
  assert.ok(entries[2].figure?.contour);
  assert.deepEqual(Array.from(entries.filter((row) => row.verdict === 'rejected'), (row) => row.slot), [4, 8]);
});

test('returns the available publications without automatically retrying a rate limit', async () => {
  const api = fakeAPI((slots, call) => call === 2
    ? Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 })
    : Response.json(envelope(JSON.stringify({ publications: slots.map(({ slot }) => mockPublication(slot)) }))));
  const { entries, warning } = await api.run();
  assert.equal(api.requests.length, 2);
  assert.equal(entries.length, 4);
  assert.match(warning, /利用制限/);
});

test('does not reuse an output stopped by the content filter', async () => {
  const api = fakeAPI((slots) => Response.json(envelope(
    JSON.stringify({ publications: slots.map(({ slot }) => mockPublication(slot)) }),
    'incomplete', 'content_filter'
  )));
  await assert.rejects(api.run(), (error) => error.code === 'refusal');
  assert.equal(api.requests.length, 2);
});
