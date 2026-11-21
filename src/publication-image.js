const SHEET_WIDTH = 1080;
const SHEET_INSET = 56;
const SHEET_CONTENT = SHEET_WIDTH - 2 * SHEET_INSET;
const SHEET_HEIGHT_LIMIT = 8192;
const SHEET_INK = '#182a3e';
const SHEET_NAVY = '#172f50';
const SHEET_MUTED = '#52647a';
const SHEET_RULE = '#cbd6df';
const SHEET_TINT = '#f1f6fa';

function sheetLines(context, value, width, maxLines) {
  const lines = [];
  function add(line) {
    if (lines.length >= maxLines) throw new RangeError('Publication image is too long');
    lines.push(line.trimEnd());
  }
  for (const paragraph of String(value ?? '').split(/\r\n?|\n/)) {
    let current = '';
    for (const char of paragraph) {
      const next = current + char;
      if (current && context.measureText(next).width > width) {
        add(current);
        current = char.trimStart();
      } else {
        current = next;
      }
    }
    add(current);
  }
  return lines;
}

function drawSheetFigure(context, figure, x, y, width, mono) {
  const scale = width / FIGURE_WIDTH;
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (figure.hidden) {
    context.setLineDash([5, 5]);
    context.strokeStyle = '#4e5864';
    context.lineWidth = 1.1;
    context.stroke(new Path2D(figure.hidden));
    context.setLineDash([]);
  }
  context.strokeStyle = '#171c25';
  context.fillStyle = context.strokeStyle;
  context.lineWidth = 1.8;
  context.stroke(new Path2D(figure.contour));
  context.font = '700 21px ' + mono;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  figure.parts.forEach((part, index) => {
    const [endX, endY] = leaderEnd(part);
    context.beginPath();
    context.moveTo(part.x, part.y);
    context.lineTo(endX, endY);
    context.strokeStyle = '#171c25';
    context.lineWidth = 1.08;
    context.stroke();
    context.beginPath();
    context.arc(part.x, part.y, 2.15, 0, 2 * Math.PI);
    context.fill();
    context.strokeStyle = '#fff';
    context.lineWidth = 4;
    const label = String(10 + index);
    context.strokeText(label, part.labelX, part.labelY);
    context.fillText(label, part.labelX, part.labelY);
  });
  context.restore();
}

function layOutPublicationSheet(context, publication, fonts, paint = false) {
  const { entry, figure, sections, citations, claimHeading, figureNotice } = publication;
  let y = 40;
  context.textBaseline = 'top';
  function text(value, {
    size = 28, weight = 400, line = Math.ceil(size * 1.52), color = SHEET_INK,
    x = SHEET_INSET, width = SHEET_WIDTH - SHEET_INSET - x, font = fonts.sans
  } = {}) {
    context.font = weight + ' ' + size + 'px ' + font;
    const lines = sheetLines(context, value, width, Math.floor((2 * SHEET_HEIGHT_LIMIT - y) / line));
    if (paint) context.fillStyle = color;
    for (const row of lines) {
      if (paint) context.fillText(row, x, y);
      y += line;
    }
  }

  function rule(at = y) {
    if (!paint) return;
    context.fillStyle = SHEET_RULE;
    context.fillRect(SHEET_INSET, at, SHEET_CONTENT, 1);
  }

  function section(label) {
    rule();
    y += 20;
    text(label, { size: 27, weight: 700, color: SHEET_NAVY });
    y += 8;
  }

  function partLegend(parts) {
    const columns = 3;
    const inset = 18;
    const columnWidth = (SHEET_CONTENT - 2 * inset) / columns;
    for (let start = 0; start < parts.length; start += columns) {
      const top = y;
      let bottom = top;
      parts.slice(start, start + columns).forEach(({ name }, column) => {
        y = top;
        text((10 + start + column) + '　' + name, {
          size: 21, x: SHEET_INSET + inset + column * columnWidth,
          width: columnWidth - 12, color: SHEET_MUTED
        });
        bottom = Math.max(bottom, y);
      });
      y = bottom;
    }
  }

  text('無用発明庁公報', { size: 23, weight: 700, color: '#18477a' });
  if (paint) {
    context.textAlign = 'right';
    context.fillText(entry.source === 'ai' ? 'AI生成公報' : '見本公報', SHEET_WIDTH - SHEET_INSET, 40);
    context.textAlign = 'left';
  }
  y += 7;
  text(entry.number, { size: 25, weight: 700, font: fonts.mono, color: SHEET_MUTED });
  y += 6;
  text(entry.title, { size: 44, weight: 700, line: 62, color: SHEET_NAVY });
  y += 12;
  const verdict = entry.verdict === 'approved' ? '認定' : '不認定';
  text('区分　' + KINDS[entry.kind] + '　　審査　' + verdict + '　　公表日　' + entry.date.replaceAll('-', '.'),
    { size: 22 });
  text('分類　' + entry.classCode + ' ' + CLASSIFICATIONS[entry.classCode], { size: 22 });
  const headerBottom = y + 20;
  y = headerBottom;

  section('要約');
  text(entry.abstract);
  y += 20;

  if (figure || figureNotice) {
    section('図面');
    if (figure) {
      const frameTop = y;
      const width = 752;
      const diagramHeight = width * FIGURE_HEIGHT / FIGURE_WIDTH;
      if (paint) drawSheetFigure(context, figure, (SHEET_WIDTH - width) / 2, y + 6, width, fonts.mono);
      y += Math.ceil(diagramHeight) + 16;
      rule();
      y += 12;
      text('図1　' + figure.caption, { size: 22, weight: 700, x: SHEET_INSET + 18, width: SHEET_CONTENT - 36 });
      partLegend(figure.parts);
      y += 12;
      if (paint) {
        context.strokeStyle = SHEET_RULE;
        context.lineWidth = 1;
        context.strokeRect(SHEET_INSET, frameTop, SHEET_CONTENT, y - frameTop);
      }
    } else {
      text(figureNotice);
    }
    y += 20;
  }

  for (const { label, value } of sections) {
    section(label);
    text(value);
    y += 20;
  }

  section(claimHeading);
  entry.claims.forEach((claim, index) => {
    text('請求項' + (index + 1), { size: 22, weight: 700, color: SHEET_MUTED });
    text(claim);
    y += 13;
  });
  y += 7;

  section('無用性審査結果');
  text(verdict, { size: 23, weight: 700, color: entry.verdict === 'approved' ? '#2b604d' : '#8e3e36' });
  text(entry.review);
  y += 20;

  section('引用公報');
  for (const citation of citations) text(citation.number + '　' + citation.title, { size: 24 });
  if (!citations.length) text('該当する引用公報はありません。');
  y += 24;
  rule();
  y += 16;
  text('JFLATBAD', { size: 22, weight: 700, color: SHEET_NAVY });
  text(DISCLAIMER, { size: 19, color: SHEET_MUTED });
  return { height: y + 32, headerBottom };
}

async function renderPublicationJpeg(publication) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas is unavailable');
  const style = getComputedStyle(document.documentElement);
  const fonts = {
    sans: style.getPropertyValue('--sans').trim(),
    mono: style.getPropertyValue('--mono').trim()
  };
  const { height, headerBottom } = layOutPublicationSheet(context, publication, fonts);
  const scale = Math.min(1, SHEET_HEIGHT_LIMIT / height);
  if (scale < .5) throw new RangeError('Publication image is too long');
  canvas.width = Math.ceil(SHEET_WIDTH * scale);
  canvas.height = Math.ceil(height * scale);
  context.scale(scale, scale);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width / scale, canvas.height / scale);
  context.fillStyle = SHEET_TINT;
  context.fillRect(0, 0, SHEET_WIDTH, headerBottom);
  context.fillStyle = SHEET_NAVY;
  context.fillRect(0, 0, SHEET_WIDTH, 7);
  layOutPublicationSheet(context, publication, fonts, true);
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .94));
  canvas.width = canvas.height = 1;
  if (!jpeg?.size || jpeg.type !== 'image/jpeg') throw new Error('JPEG encoding failed');
  return jpeg;
}
