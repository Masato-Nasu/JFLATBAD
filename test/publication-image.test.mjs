import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const sources = await Promise.all(['catalog', 'figures', 'publication-image'].map((name) =>
  readFile(new URL('../src/' + name + '.js', import.meta.url), 'utf8')
));
const { CATALOG, sheetLines, layOutPublicationSheet } = runInNewContext(
  sources.join('\n') + '\n({ CATALOG, sheetLines, layOutPublicationSheet });',
  { DISCLAIMER: '架空の特許・制度を扱うパロディ作品です。' }
);

function drawingContext() {
  return {
    rows: [],
    measureText(text) { return { width: Array.from(text).length * 26 }; },
    fillText(text, x, y) { this.rows.push({ text, x, y }); },
    fillRect() {}
  };
}

test('wraps Japanese text and preserves line breaks and supplementary characters', () => {
  const wrapped = sheetLines(drawingContext(), '予備部品🙂\r\n末尾', 78, 10);
  assert.deepEqual(Array.from(wrapped), ['予備部', '品🙂', '末尾']);
  assert.throws(() => sheetLines(drawingContext(), '長い公報'.repeat(30), 78, 2), { name: 'RangeError' });
});

test('lays out a long publication through the last claim, review and citation', () => {
  const context = drawingContext();
  const entry = {
    ...CATALOG[0],
    title: '機構の位置とその判定に係る長い発明名称'.repeat(5),
    claims: ['試験措置について規定する。'.repeat(72), '最後の請求項本文。']
  };
  const publication = {
    entry, figure: null, figureNotice: '',
    sections: [{ label: '解決手段', value: entry.solution }],
    claimHeading: '特許請求の範囲', citations: [CATALOG[1]]
  };
  const sheet = layOutPublicationSheet(context, publication, { sans: 'sans-serif', mono: 'monospace' }, true);
  for (const expected of ['最後の請求項本文。', '無用性審査結果', '引用公報', 'JFLATBAD']) {
    assert.ok(context.rows.some(({ text }) => text === expected));
  }
  assert.ok(context.rows.at(-1).y < sheet.height - 30);
  assert.ok(sheet.height > 2400);
});
