import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const scripts = await Promise.all(['catalog', 'figures', 'api'].map((name) =>
  readFile(new URL('../src/' + name + '.js', import.meta.url), 'utf8')
));
const source = scripts.join('\n') + '\n({ generatePublications, normalizeFigure, readPublicationRows });';
const { normalizeFigure } = runInNewContext(source);

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

function fakeAPI(handler, random = Math.random) {
  const requests = [];
  const api = runInNewContext(source, {
    crypto: webcrypto, AbortController, setTimeout, clearTimeout,
    Math: Object.assign(Object.create(Math), { random }),
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.input);
      requests.push({ body, input });
      return handler(input.slots, requests.length, input.subject);
    }
  });
  const run = (onProgress, subject = '車') => api.generatePublications({
    subject, random: false, filter: 'all', recentTitles: [],
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

test('uses different drawing briefs and keeps different component diagrams when all outlines are boxes', async () => {
  const api = fakeAPI((slots) => Response.json(envelope(
    JSON.stringify({ publications: slots.map(({ slot }) => mockPublication(slot)) })
  )));
  const { entries } = await api.run();
  const views = api.requests.flatMap(({ input }) => input.slots.map(({ drawingView }) => drawingView));
  assert.equal(new Set(views).size, 8);
  assert.equal(entries.length, 8);
  assert.equal(new Set(entries.map((entry) => entry.figure.contour)).size, 8);
  for (const entry of entries) {
    assert.equal(entry.figure.caption, '主要構成要素の模式図');
    assert.deepEqual(Array.from(entry.figure.parts, ({ name }) => name), ['開閉弁', 'トレー']);
    assert.equal(JSON.stringify(normalizeFigure(entry.figure, entry).parts), JSON.stringify(entry.figure.parts));
  }
});

test('keeps a custom drawing and replaces repeated geometry even at a different scale and position', async () => {
  const contour = 'M 130 130 L 234 72 H 409 V 200 L 304 251 H 130 Z M 130 130 H 304 L 409 72 M 304 130 V 251';
  const reduced = 'M 80 90 L 132 61 H 219.5 V 125 L 167 150.5 H 80 Z M 80 90 H 167 L 219.5 61 M 167 90 V 150.5';
  const api = fakeAPI((slots) => Response.json(envelope(JSON.stringify({
    publications: slots.map(({ slot }) => {
      const entry = mockPublication(slot);
      entry.figure.contour = slot % 2 === 1 ? contour : reduced;
      return entry;
    })
  }))));
  const { entries } = await api.run();
  assert.equal(entries[0].figure.contour, contour);
  assert.equal(entries[1].figure.caption, '主要構成要素の模式図');
  assert.equal(new Set(entries.map((entry) => entry.figure.contour)).size, 8);
});

test('varies drawing views for a repeated keyword and uses publication parts for other subjects', async () => {
  const subjects = new Map([
    ['傘', ['回転軸', '開閉ばね']],
    ['申請書', ['提出票', '決裁端末']],
    ['加湿器', ['貯水容器', '送風ファン']]
  ]);
  let draw = 0.14;
  const api = fakeAPI((slots, _, subject) => Response.json(envelope(JSON.stringify({
    publications: slots.map(({ slot }) => {
      const entry = mockPublication(slot, { title: subject + 'の公報' + slot });
      entry.figure.parts.forEach((part, index) => { part.name = subjects.get(subject)[index]; });
      return entry;
    })
  }))), () => draw);

  for (const [subject, names] of subjects) {
    const { entries } = await api.run(undefined, subject);
    assert.equal(entries.length, 8);
    assert.equal(new Set(entries.map((entry) => entry.figure.contour)).size, 8);
    assert.deepEqual(Array.from(entries[0].figure.parts, ({ name }) => name), names);
  }
  const startingViews = api.requests.slice(0, 2).flatMap(({ input }) => input.slots.map((slot) => slot.drawingView));
  draw = 0.77;
  await api.run(undefined, '傘');
  const repeatedViews = api.requests.slice(-2).flatMap(({ input }) => input.slots.map((slot) => slot.drawingView));
  assert.equal(new Set(repeatedViews).size, 8);
  assert.notDeepEqual(new Set(repeatedViews), new Set(startingViews));
});

test('restores the hair-direction drawing from a stored outline without a new request', () => {
  const title = '黒点導毛方向指示装置';
  const figure = {
    caption: title + 'の正面図',
    contour: 'M 120 80 L 440 80 L 440 270 L 120 270 Z M 170 120 H 390 V 230 H 170 Z M 250 80 V 120 M 315 80 V 120',
    hidden: '',
    parts: ['検知板', '整流羽根', '指向札'].map((name, i) =>
      ({ name, x: 200 + i * 50, y: 125, labelX: 90 + i * 180, labelY: 96 }))
  };
  const drawing = normalizeFigure(figure, { id: 'gen-batch-1', title });
  assert.equal(drawing.caption, title + 'の使用状態図');
  assert.deepEqual(Array.from(drawing.parts, ({ name }) => name), figure.parts.map(({ name }) => name));
  assert.match(drawing.contour, /C/);
  assert.equal(normalizeFigure(drawing, { title }).caption, drawing.caption);
  assert.equal(normalizeFigure(figure, { title, figureView: 3 }).caption, '主要構成要素の模式図');
  assert.equal(normalizeFigure(figure, { title: '黒点辺縁の毛影写録装置' }).caption, '主要構成要素の模式図');
});
