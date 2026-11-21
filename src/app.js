const main = document.querySelector('#main');
const header = document.querySelector('#header');
const footer = document.querySelector('#footer');
const dialog = document.querySelector('#settings');
const figureDialog = document.querySelector('#figure-preview');
const settingsForm = document.querySelector('#settings-form');
const keyField = document.querySelector('#api-key');
const modelField = document.querySelector('#model');
const settingsMessage = document.querySelector('#settings-message');
const historyFile = document.querySelector('#history-file');
const portable = location.protocol === 'file:' || location.hostname.endsWith('.github.io');
const QUERY_LIMIT = 64;
const CACHE_KEY = 'jflatbad:v1:results';
const DISCLAIMER = '架空の特許・制度を扱うパロディ作品です。実在の特許機関とは無関係です。';
const APP_TITLE = '特許・不実用新案公報検索';
const MAX_BATCHES = 12;
const historyStorage = searchHistoryStorage();
const historyTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' });

let apiKey = '';
let selectedModel = DEFAULT_MODEL;
let keyCheck = null;
let keyTrigger = null;
let job = null;
let currentPath = '';
let currentResult = null;
let activeFigure = null;
let figureTrigger = null;
let historyImporting = false;
let historyNotice = '';
const session = restoreSession();
const savedSearches = readSearchHistory(historyStorage);

const entity = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => entity[char]);
const icon = (name) => '<span class="icon icon-' + name + '" aria-hidden="true"></span>';
const href = (path) => portable ? '#' + path : path;
const infoPath = (slug) => '/info/' + slug;
const infoLink = (slug, label = INFO_TITLES.get(slug)) => link(infoPath(slug), html(label));

function link(path, content, className = '', extra = '') {
  return `<a href="${html(href(path))}" data-route="${html(path)}"${className ? ' class="' + className + '"' : ''}${extra}>${content}</a>`;
}

function readRoute() {
  const path = portable
    ? (location.hash.startsWith('#/') ? location.hash.slice(1) : '/')
    : location.pathname + location.search;
  return new URL('https://jflatbad.invalid' + path);
}

function routeString(route) {
  return route.pathname + route.search;
}

function queryValue(value) {
  return (value ?? '').trim().slice(0, QUERY_LIMIT);
}

function filterValue(value) {
  return Object.hasOwn(FILTERS, value) ? value : 'all';
}

function searchPath({ query = '', filter = 'all', random = false, source = 'sample' }, batchId) {
  const params = new URLSearchParams({ filter, source });
  if (query) params.set('q', query);
  if (random) params.set('mode', 'random');
  if (batchId) params.set('batch', batchId);
  return '/search?' + params.toString();
}

function editSearchPath({ query, filter }) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filter !== 'all') params.set('filter', filter);
  const encoded = params.toString();
  return encoded ? '/?' + encoded : '/';
}

function publicationPath(id, batchId) {
  return '/publication/' + encodeURIComponent(id) + (batchId ? '?batch=' + encodeURIComponent(batchId) : '');
}

function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null');
    if (Array.isArray(saved?.batches) && Number.isSafeInteger(saved.serial)
      && saved.serial >= 200000 && saved.serial <= 999999) {
      return {
        serial: saved.serial,
        batches: saved.batches.filter((batch) =>
          isHistoryId(batch?.id) && typeof batch.spec?.query === 'string' && Array.isArray(batch.records))
      };
    }
  } catch {
    // Private browsing and file URLs can prevent storage.
  }
  return { batches: [], serial: 200000 };
}

function keepBatch(batch) {
  batch = { ...batch, savedAt: Date.now() };
  session.batches = [...session.batches.slice(-(MAX_BATCHES - 1)), batch];
  if (batch.records.length) saveToHistory(batch);
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(session));
  } catch {
    // The active page still keeps the records in memory.
  }
}

function saveToHistory(batch) {
  if (savedSearches.has(batch.id)) return 'existing';
  const archived = archivedBatch(batch);
  const saved = archived && persistSearchBatch(historyStorage, archived);
  if (!saved) return 'failed';
  savedSearches.set(batch.id, saved.batch);
  return saved.added ? 'added' : 'existing';
}

function historyBatches() {
  const available = new Map(session.batches.map((batch) => [batch.id, batch]));
  for (const [id, batch] of savedSearches) available.set(id, batch);
  return [...available.values()].sort((a, b) => b.savedAt - a.savedAt);
}

function adoptTabHistory() {
  const now = Date.now();
  session.batches = session.batches.map((batch, i) => {
    const datedBatch = { savedAt: now - session.batches.length + i, ...batch };
    if (datedBatch.records.length) saveToHistory(datedBatch);
    return datedBatch;
  });
}

function freshId() {
  return [...crypto.getRandomValues(new Uint32Array(3))].map((part) => part.toString(36)).join('-');
}

function batchFor(id) {
  return savedSearches.get(id) ?? session.batches.find((batch) => batch.id === id);
}

function recordFor(id, batch) {
  return batch?.records.find((entry) => entry.id === id) ?? SAMPLE_BY_ID.get(id);
}

function dated(date) {
  return `<time class="date" datetime="${html(date)}">${html(date.replaceAll('-', '.'))}</time>`;
}

function badge(label, cls) {
  return `<span class="badge ${cls ? 'badge-' + html(cls) : ''}">${html(label)}</span>`;
}

function verdictBadge(entry) {
  return badge(entry.verdict === 'approved' ? '認定' : '不認定', entry.verdict);
}

function crumbs(current, previous = []) {
  return `<nav class="crumbs" aria-label="現在位置"><ol><li>${link('/', 'トップ')}</li>
    ${previous.map(([path, text]) => '<li>' + link(path, html(text)) + '</li>').join('')}
    <li aria-current="page">${html(current)}</li></ol></nav>`;
}

function shell() {
  header.innerHTML = `
    <header class="masthead">
      <div class="wrap mast-inner">
        ${link('/', '<span class="brand-mark" aria-hidden="true"></span><span class="brand-type"><strong class="wordmark">JFLATBAD</strong><span class="subtitle" lang="en">Patent Search for Bad Ideas</span></span>', 'brand', ' aria-label="JFLATBAD トップ"')}
        <div class="mast-actions">
          ${link(infoPath('agency'), '<span class="agency-seal" aria-hidden="true">無</span><span class="agency-name">無用発明庁<small lang="en">OFFICE FOR USELESS INVENTIONS</small></span>', 'agency-id')}
          <button class="button button-secondary api-button" type="button" data-action="settings" aria-haspopup="dialog">
            ${icon('key')} API設定
          </button>
        </div>
      </div>
      <nav class="navbar" aria-label="主なページ"><div class="wrap nav-inner">
        ${link('/', '公報検索', 'nav-item')}
        ${link('/history', '検索履歴', 'nav-item')}
        ${link(infoPath('notices'), 'お知らせ', 'nav-item')}
        ${link(infoPath('standards'), '審査基準', 'nav-item')}
        ${link(infoPath('related'), '関連情報', 'nav-item')}
      </div></nav>
      <div class="disclaimer"><div class="wrap"><strong>架空パロディ</strong><span>${DISCLAIMER}</span></div></div>
    </header>`;

  footer.innerHTML = `
    <footer class="footer"><div class="wrap footer-inner">
      <div>
        <p class="footer-name">JFLATBAD　無用発明庁</p>
        <p class="footer-disclaimer">${DISCLAIMER}</p>
      </div>
      <div>
        <ul class="footer-links">
          <li>${infoLink('agency')}</li>
          <li>${infoLink('faq')}</li>
          <li>${infoLink('archive')}</li>
        </ul>
        <p class="footer-motto" lang="en">Subtle, but Subversive.</p>
      </div>
    </div></footer>`;

  modelField.innerHTML = Object.entries(MODELS)
    .map(([id, name]) => `<option value="${html(id)}">${html(name)}</option>`).join('');
}

function updateShell(route) {
  const path = route.pathname.replace(/\/+$/, '') || '/';
  let active = '/';
  if (path === '/history') active = path;
  else if (path.startsWith('/info/notice')) active = infoPath('notices');
  else if (path === infoPath('standards')) active = path;
  else if (path.startsWith('/info/')) active = infoPath('related');
  for (const item of header.querySelectorAll('.nav-item')) {
    if (item.dataset.route === active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  updateKeyState();
}

function updateKeyState() {
  header.querySelector('.api-button').dataset.configured = String(Boolean(apiKey));
  document.querySelector('#key-state').textContent = apiKey
    ? '設定済み。別のキーに切り替える場合は入力してください。'
    : '未設定';
  const source = main.querySelector('.search-source');
  if (source) {
    source.querySelector('.key-guide-message').textContent = apiKey
      ? 'AIで新しい公報を生成します。'
      : 'AIで新しい公報を生成するには、OpenAI APIキーを入力してください。';
    source.querySelector('.key-guide-note').hidden = Boolean(apiKey);
    source.querySelector('button').hidden = Boolean(apiKey);
  }
}

function apiKeyButton(style = 'button-secondary') {
  return '<button class="button ' + style + '" type="button" data-action="settings" aria-haspopup="dialog">APIキーを入力</button>';
}

function noticeList() {
  return NOTICES.map((item) => `<li>
    <div class="notice-meta">${dated(item.date)}${badge(item.category, item.tone)}</div>
    ${infoLink(item.slug, item.title)}
  </li>`).join('');
}

function banners() {
  return `<ul class="banners">${BANNERS.map(({ slug, title, note, icon: symbol, tone }) => `<li>
    ${link(infoPath(slug), '<span class="banner-symbol">' + icon(symbol) + '</span><span><strong>' + html(title)
      + '</strong><small>' + html(note) + '</small></span>', 'banner tone-' + tone)}
  </li>`).join('')}</ul>`;
}

function homeView(route) {
  const query = queryValue(route.searchParams.get('q'));
  const filter = filterValue(route.searchParams.get('filter'));
  return { title: APP_TITLE, content: `
    <div class="page-title home-title">
      <h1>${APP_TITLE}</h1>
      <p>無用特許・不実用新案の公報本文と審査記録を照会できます。</p>
    </div>
    <div class="home-workspace">
      <section class="search-panel" aria-labelledby="search-heading">
        <div class="section-top"><h2 id="search-heading">${icon('search')} 簡易検索</h2>${infoLink('faq', '検索の使い方')}</div>
        <form id="search-form" class="search-form" role="search" autocomplete="off" novalidate>
          <fieldset><legend>検索対象</legend><div class="choices">
            ${Object.entries(FILTERS).map(([value, label]) => `<label class="choice"><input name="filter" type="radio" value="${value}"
              ${value === filter ? ' checked' : ''}>${html(label)}</label>`).join('')}
          </div></fieldset>
          <label class="search-label" for="query">キーワード</label>
          <input id="query" class="search-input" name="q" type="search" enterkeyhint="search" spellcheck="false"
            autocapitalize="off" maxlength="${QUERY_LIMIT}" value="${html(query)}" placeholder="例：冷蔵庫、傘、申請書"
            aria-describedby="query-error">
          <p id="query-error" class="search-error" role="alert" hidden></p>
          <div class="search-examples"><span>入力例</span>
            ${['冷蔵庫', '傘', '申請書'].map((word) => `<button type="button" data-action="example" data-word="${word}">${word}</button>`).join('')}
          </div>
          <div class="search-actions">
            <button class="button button-primary" type="submit">${icon('search')} 検索</button>
            <button class="button button-secondary" type="button" data-action="random">${icon('random')} ランダム検索</button>
          </div>
        </form>
        <div class="key-guide search-source">
          <div aria-live="polite">
            <p class="key-guide-message"></p>
            <p class="key-guide-note">キーなしでも「冷蔵庫」「傘」などの見本公報を検索できます。</p>
          </div>
          ${apiKeyButton()}
        </div>
      </section>
      <section class="notice-panel" aria-labelledby="notices-heading">
        <div class="notice-head"><h2 id="notices-heading">${icon('alert')} お知らせ</h2>${infoLink('notices', '一覧を見る')}</div>
        <ul class="notice-list">${noticeList()}</ul>
      </section>
    </div>
    <section class="related-section" aria-labelledby="related-heading">
      <h2 class="section-heading" id="related-heading">${icon('files')} 関連情報</h2>
      ${banners()}
    </section>
  ` };
}

function searchLabel(spec) {
  return spec.random ? spec.subject || 'ランダム検索' : spec.query || '検索結果';
}

function historyView() {
  const batches = historyBatches().filter(({ records }) => records.length);
  const rows = batches.map(({ id, spec, records, savedAt }) => {
    const date = new Date(savedAt);
    return `<li class="history-row">
      <div>
        ${link(searchPath(spec, id), html(searchLabel(spec)), 'history-title')}
        ${spec.random && spec.subject ? '<span class="hint">ランダム検索</span>' : ''}
        <div class="history-meta">${badge(spec.source === 'ai' ? 'AI生成公報' : '見本公報')}
          <span>${html(FILTERS[spec.filter])}</span><span>${records.length} 件</span>
          ${savedSearches.has(id) ? '' : '<span>このタブのみ</span>'}
        </div>
      </div>
      <time class="date" datetime="${date.toISOString()}">${historyTime.format(date)}</time>
    </li>`;
  }).join('');
  return { title: '検索履歴', content: `
    ${crumbs('検索履歴')}
    <div class="result-head">
      <div class="page-title">
        <h1>検索履歴</h1>
        <p>このブラウザに保存した公報を、APIキーなしで照会できます。</p>
      </div>
      <div class="result-actions">
        <button class="button button-secondary" type="button" data-action="export-history"${batches.length ? '' : ' disabled'}>履歴をJSONで書き出す</button>
        <button class="button button-secondary" type="button" data-action="import-history"${historyImporting ? ' disabled' : ''}>JSONを読み込む</button>
      </div>
    </div>
    <p class="archive-status" id="archive-status" role="status">${html(historyNotice)}</p>
    ${rows ? '<ul class="history-list" aria-label="保存した検索結果">' + rows + '</ul>'
      : '<section class="state-panel"><h2>保存した検索結果はありません</h2><p>公報が見つかった検索は、ここに表示されます。</p></section>'}` };
}

function archiveFeedback(message) {
  const status = main.querySelector('#archive-status');
  if (status) status.textContent = message;
}

function exportBatches(batches, label) {
  if (!batches.length) return;
  archiveFeedback('');
  try {
    const json = serializeSearchHistory(batches);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const download = document.createElement('a');
    const name = label.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 48);
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    download.href = url;
    download.download = 'JFLATBAD-' + name + '-' + day + '.json';
    document.body.append(download);
    try { download.click(); }
    finally {
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch {
    archiveFeedback('JSONを書き出せませんでした。もう一度お試しください。');
  }
}

function exportCurrentResult() {
  if (!currentResult?.records?.length) return;
  const { records, batch, ...spec } = currentResult;
  exportBatches([batch ?? { id: freshId(), spec, records, savedAt: Date.now() }], searchLabel(spec));
}

async function importHistory(file) {
  historyImporting = true;
  main.querySelector('[data-action="import-history"]').disabled = true;
  archiveFeedback('JSONを読み込んでいます。');
  try {
    const batches = parseSearchHistory(await file.text());
    const counts = { added: 0, existing: 0, failed: 0 };
    for (const batch of batches) counts[saveToHistory(batch)] += 1;
    historyNotice = [
      counts.added ? counts.added + '回分の検索結果を読み込みました。' : '',
      counts.existing ? counts.existing + '回分は保存済みです。' : '',
      counts.failed ? counts.failed + '回分を保存できませんでした。ブラウザの保存設定や空き容量を確認してください。' : ''
    ].join('');
  } catch {
    historyNotice = 'JSONを読み込めませんでした。JFLATBADで書き出したJSONファイルを選んでください。';
  } finally {
    historyImporting = false;
    if (main.querySelector('[data-action="import-history"]')) {
      render();
      main.querySelector('[data-action="import-history"]').focus({ preventScroll: true });
    }
  }
}

function resultView(route) {
  const params = route.searchParams;
  const batchId = params.get('batch');
  const batch = batchFor(batchId);
  const task = job?.id === batchId ? job : null;
  const spec = batch?.spec ?? task?.spec ?? {
    query: queryValue(params.get('q')),
    filter: filterValue(params.get('filter')),
    random: params.get('mode') === 'random',
    source: params.get('source') === 'ai' ? 'ai' : 'sample'
  };
  const records = batch?.records ?? (
    !task && spec.source === 'sample' && !spec.random && spec.query
      ? searchSamples(spec.query, spec.filter)
      : null
  );
  currentResult = { ...spec, records, batch };
  const busy = task?.stage === 'pending';
  const mode = spec.random ? (spec.subject ? 'ランダム検索 / ' + spec.subject : 'ランダム検索') : 'キーワード検索';
  const count = records ? `<div class="result-count"><dt>該当件数</dt><dd><b>${records.length}</b> 件</dd></div>` : '';
  return { title: '検索結果', content: `
    ${crumbs('検索結果')}
    <div class="result-head">
      <div class="page-title"><h1>検索結果</h1></div>
      <div class="result-actions">
        ${link(editSearchPath(spec), '検索条件を変更', 'button button-secondary')}
        <button class="button button-secondary" type="button" data-action="random"${busy ? ' disabled' : ''}>
          ${icon('random')} ランダム検索
        </button>
        ${spec.source === 'sample' && records?.length && apiKey
          ? '<button class="button button-primary" type="button" data-action="retry">AIでこの条件を検索</button>' : ''}
        ${records?.length ? '<button class="button button-secondary" type="button" data-action="export-result">JSON書き出し</button>' : ''}
      </div>
    </div>
    <dl class="result-conditions">
      <div><dt>方法</dt><dd>${html(mode)}</dd></div>
      ${spec.query ? `<div><dt>検索語</dt><dd>${html(spec.query)}</dd></div>` : ''}
      <div><dt>対象</dt><dd>${html(FILTERS[spec.filter])}</dd></div>
      <div><dt>出典</dt><dd>${spec.source === 'ai' ? 'AI生成公報' : '見本公報'}</dd></div>
      ${count}
    </dl>
    ${batch?.records.length
      ? `<p class="archive-note">${savedSearches.has(batch.id)
        ? 'このブラウザに保存しました。' : 'このブラウザに保存できませんでした。JSONで書き出せます。'}
        ${link('/history', '検索履歴')}</p>` : ''}
    <p class="archive-status" id="archive-status" role="status"></p>
    ${spec.source === 'sample' && records?.length && !apiKey ? `<div class="key-guide result-key-guide">
      <p class="key-guide-message">見本公報を表示しています。AIで新しい公報を生成するには、OpenAI APIキーを入力してください。</p>
      ${apiKeyButton()}
    </div>` : ''}
    ${batch?.spec.source === 'ai' && records.length < RECORD_COUNT ? `<div class="key-guide result-key-guide" role="status">
      <div>
        <p class="key-guide-message">${records.length}件の公報を取得できました。取得済みの公報を表示しています。</p>
        ${batch.warning ? '<p class="key-guide-note">' + html(batch.warning) + '</p>' : ''}
      </div>
      ${apiKey ? '<button class="button button-secondary" type="button" data-action="retry">同じ条件で再検索</button>' : ''}
    </div>` : ''}
    ${resultBody(spec, records, task, batch?.id)}
    <p class="result-disclaimer">検索結果の有用性について一切保証しません。</p>` };
}

function resultBody(spec, records, task, batchId) {
  if (task?.stage === 'pending') {
    return `<section class="state-panel">
      <h2 class="loading-line"><span class="spinner" aria-hidden="true"></span>公報を編纂しています</h2>
      <p id="generation-status" role="status">${generationStatus(task)}</p>
      <div class="result-actions"><button class="button button-secondary" type="button" data-action="cancel">中止</button></div>
    </section>`;
  }
  if (task?.stage === 'error' || task?.stage === 'cancelled') {
    const settingsAction = ['key', 'access', 'quota'].includes(task.errorCode) || !apiKey;
    return `<section class="state-panel ${task.stage === 'error' ? 'state-error' : ''}">
      <h2>${task.stage === 'error' ? '公報を取得できませんでした' : '公報の編纂を中止しました'}</h2>
      <p role="status">${html(task.message)}</p>
      <div class="result-actions">
        ${settingsAction ? '<button class="button button-primary" type="button" data-action="settings">API設定を開く</button>' : ''}
        ${apiKey ? '<button class="button button-secondary" type="button" data-action="retry">再試行</button>' : ''}
        <button class="button button-secondary" type="button" data-action="sample">見本公報で検索</button>
      </div>
    </section>`;
  }
  if (!records) {
    return `<section class="state-panel"><h2>検索結果を照会できません</h2>
      <p>このブラウザの検索履歴に結果が見つかりません。書き出したJSONがあれば、検索履歴から読み込めます。</p>
      ${link('/history', '検索履歴へ', 'button button-text')}
      ${link(editSearchPath(spec), '検索画面へ', 'button button-text')}
    </section>`;
  }
  if (records.length === 0) {
    return `<section class="state-panel"><h2>該当する見本公報がありません</h2>
      <p>検索条件が有用すぎる可能性があります。</p>
      <p>${apiKey ? '同じ検索語で新しい公報を生成できます。' : 'この検索語で新しい公報を生成するには、OpenAI APIキーを入力してください。'}</p>
      <div class="result-actions">
        ${apiKey ? '<button class="button button-primary" type="button" data-action="retry">AIでこの条件を検索</button>' : apiKeyButton('button-primary')}
        <button class="button button-secondary" type="button" data-action="random">無用化して再検索</button>
        ${infoLink('archive', '見本公報の収録分野')}
      </div>
    </section>`;
  }
  const items = records.map((entry) => `<li class="result-row">
    <div class="record-number">${html(entry.number)}</div>
    <div class="result-main">
      ${link(publicationPath(entry.id, batchId), html(entry.title))}
      <p>${html(entry.abstract)}</p>
    </div>
    <div class="result-status">${badge(KINDS[entry.kind], entry.kind)}${verdictBadge(entry)}</div>
  </li>`).join('');
  return `<div class="result-labels" aria-hidden="true"><span>公報番号</span><span>発明の名称・要約</span><span>区分・審査結果</span></div>
    <ol class="result-list" aria-label="公報一覧">${items}</ol>`;
}

const DOCUMENT_SECTIONS = [
  ['field', '技術分野'],
  ['background', '背景技術'],
  ['problem', '課題'],
  ['solution', '解決手段'],
  ['effect', '発明の効果']
];

function recordLinks(entries, batchId) {
  return `<ul class="record-links">${entries.map((entry) => `<li>
    <span class="record-number">${html(entry.number)}</span>
    ${link(publicationPath(entry.id, batchId), html(entry.title))}
  </li>`).join('')}</ul>`;
}

function documentSection(id, title, content) {
  return `<section class="document-section" id="${id}"><h2 tabindex="-1">${title}</h2>${content}</section>`;
}

function publicationView(route, id) {
  const batch = batchFor(route.searchParams.get('batch'));
  const entry = recordFor(id, batch);
  if (!entry) return missingView('公報を照会できません',
    'このブラウザの検索履歴に公報が見つかりません。書き出したJSONがあれば、検索履歴から読み込めます。',
    link('/history', '検索履歴へ', 'button button-text'));
  const figure = publicationFigure(entry);
  activeFigure = figure;
  const figureSection = figure ? exhibitFigure(figure)
    : entry.source === 'ai' && entry.figure === null ? '<p>図面を読み取れませんでした。本文は以下から確認できます。</p>' : '';
  const remembered = history.state?.returnTo;
  const returnTo = remembered?.path?.startsWith('/search?') || remembered?.path?.startsWith('/info/')
    ? remembered
    : batch ? { path: searchPath(batch.spec, batch.id), label: '検索結果' }
      : { path: infoPath('archive'), label: '開放無用情報データベース' };
  const backText = returnTo.label === '検索結果' ? '検索結果一覧へ戻る' : returnTo.label + 'へ戻る';
  const backLink = (style) => link(returnTo.path, html(backText), style, ' data-restore-list');
  const citations = entry.citations.map((ref) => recordFor(ref, batch)).filter(Boolean);
  const articleSections = DOCUMENT_SECTIONS.map(([key, label]) => documentSection(key, label, '<p>' + html(entry[key]) + '</p>')).join('');
  const claims = entry.claims.map((text, index) => `<div class="claim"><h3>請求項${index + 1}</h3><p>${html(text)}</p></div>`).join('');
  const outline = [
    ['abstract', '要約'], ...(figureSection ? [['drawings', '図面']] : []), ...DOCUMENT_SECTIONS,
    ['claims', '特許請求の範囲'], ['review', '無用性審査結果'], ['citations', '引用公報']
  ];
  const claimHeading = entry.kind === 'model' ? '不実用新案登録請求の範囲' : '特許請求の範囲';
  return { title: entry.title, content: `
    ${crumbs('公報詳細', [[returnTo.path, returnTo.label]])}
    <div class="publication-layout">
      <article class="publication">
        <header class="document-header">
          <div class="document-kicker"><strong>無用発明庁公報</strong>${badge(entry.source === 'ai' ? 'AI生成公報' : '見本公報')}</div>
          <span class="record-number">${html(entry.number)}</span>
          <h1>${html(entry.title)}</h1>
          <dl class="document-meta">
            <div><dt>区分</dt><dd>${badge(KINDS[entry.kind], entry.kind)}</dd></div>
            <div><dt>審査</dt><dd>${verdictBadge(entry)}</dd></div>
            <div><dt>公表日</dt><dd>${dated(entry.date)}</dd></div>
            <div><dt>分類</dt><dd>${infoLink('classification', entry.classCode + ' ' + CLASSIFICATIONS[entry.classCode])}</dd></div>
          </dl>
        </header>
        <div class="document-body">
          ${documentSection('abstract', '要約', '<p>' + html(entry.abstract) + '</p>')}
          ${figureSection ? documentSection('drawings', '図面', figureSection) : ''}
          ${articleSections}
          ${documentSection('claims', claimHeading, claims)}
          ${documentSection('review', '無用性審査結果', `<div class="review-block ${html(entry.verdict)}">${verdictBadge(entry)}<p>${html(entry.review)}</p></div>`)}
          ${documentSection('citations', '引用公報', citations.length ? recordLinks(citations, batch?.id) : '<p>該当する引用公報はありません。</p>')}
        </div>
      </article>
      <aside class="document-side">
        ${backLink('button button-secondary')}
        <nav class="toc" aria-label="公報の目次"><strong>公報の目次</strong><ul>
          ${outline.map(([key, label]) => `<li><button type="button" data-action="jump" data-section="${key}">${key === 'claims' ? '請求項' : label}</button></li>`).join('')}
        </ul></nav>
      </aside>
    </div>
    <div class="document-back">${backLink('button button-secondary')}</div>` };
}

function infoSection(section) {
  const paragraphs = section.paragraphs?.map((line) => '<p>' + html(line) + '</p>').join('') ?? '';
  const table = section.rows ? `<table class="info-table">
    <thead><tr>${section.headings.map((label) => '<th scope="col">' + html(label) + '</th>').join('')}</tr></thead>
    <tbody>${section.rows.map(([key, ...cells]) => '<tr><th scope="row">' + html(key) + '</th>'
      + cells.map((cell) => '<td>' + html(cell) + '</td>').join('') + '</tr>').join('')}</tbody></table>` : '';
  return `<section class="info-section"><h2>${html(section.heading)}</h2>${paragraphs}${table}</section>`;
}

function infoView(slug) {
  if (slug === 'notices' || slug === 'related') {
    const title = INFO_TITLES.get(slug);
    return { title, content: `
      ${crumbs(title)}
      <div class="page-title"><h1>${title}</h1></div>
      ${slug === 'notices' ? '<ul class="notice-list notice-page-list">' + noticeList() + '</ul>' : banners()}` };
  }

  const notice = NOTICES.find((item) => item.slug === slug);
  const page = notice ?? (Object.hasOwn(INFO_PAGES, slug) ? INFO_PAGES[slug] : null);
  if (!page) return missingView();
  const references = page.references?.map((id) => SAMPLE_BY_ID.get(id)).filter(Boolean) ?? [];
  const searchLinks = page.searches?.map(({ query, text }) => '<li>' + link(searchPath({ query }), html(text)) + '</li>').join('');
  const article = [
    page.sections?.map(infoSection).join(''),
    searchLinks ? '<section class="info-section"><h2>指定の検索で照会</h2><ul class="inline-links">' + searchLinks + '</ul></section>' : '',
    references.length ? '<section class="info-section"><h2>参照公報</h2>' + recordLinks(references) + '</section>' : ''
  ].filter(Boolean).join('');
  const questions = page.questions ? `<div class="faq-list">${page.questions.map(([q, a]) =>
    '<details><summary>' + html(q) + '</summary><p>' + html(a) + '</p></details>').join('')}</div>` : '';
  const related = page.related?.map((item) => '<li>' + infoLink(item) + '</li>').join('') ?? '';
  const parent = notice ? 'notices' : 'related';
  return { title: page.title, content: `
    <div class="info-page">
      ${crumbs(page.title, [[infoPath(parent), INFO_TITLES.get(parent)]])}
      <div class="page-title">
        ${notice ? '<div class="notice-title-meta">' + dated(notice.date) + badge(notice.category, notice.tone) + '</div>' : ''}
        <h1>${html(page.title)}</h1>
        <p>${html(page.intro)}</p>
      </div>
      ${article ? '<article class="info-article">' + article + '</article>' : ''}
      ${questions}
      ${related ? '<nav class="info-related" aria-label="関連資料"><h2>関連資料</h2><ul class="inline-links">' + related + '</ul></nav>' : ''}
    </div>` };
}

function missingView(title = 'ページを照会できません', message = '指定された資料は収録されていません。',
  action = link('/', '公報検索へ', 'button button-text')) {
  return { title, content: `${crumbs(title)}
    <div class="state-panel"><h1>${html(title)}</h1><p>${html(message)}</p>
    ${action}</div>` };
}

function render() {
  if (figureDialog.open) figureDialog.close();
  const route = readRoute();
  currentPath = routeString(route);
  currentResult = null;
  activeFigure = null;
  const path = route.pathname.replace(/\/+$/, '') || '/';
  if (job?.stage === 'pending' && (path !== '/search' || route.searchParams.get('batch') !== job.id)) {
    cancelJob();
  }

  let view;
  if (path === '/' || path === '/index.html') view = homeView(route);
  else if (path === '/search') view = resultView(route);
  else if (path === '/history') view = historyView();
  else if (/^\/publication\/[a-z0-9-]+$/.test(path)) view = publicationView(route, path.split('/')[2]);
  else if (/^\/info\/[a-z0-9-]+$/.test(path)) view = infoView(path.split('/')[2]);
  else view = missingView();

  main.innerHTML = view.content;
  document.title = view.title + ' | JFLATBAD';
  updateShell(route);
}

function focusView(scrollY = 0) {
  main.focus({ preventScroll: true });
  window.scrollTo(0, scrollY);
}

function navigate(path, { replace = false, returnTo, scrollY = 0 } = {}) {
  // The stored position belongs to the history entry that is being left.
  if (!replace) history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
  const state = { returnTo, scrollY };
  if (replace) history.replaceState(state, '', href(path));
  else history.pushState(state, '', href(path));
  render();
  focusView(scrollY);
}

function keywordProblem(value) {
  if (!value.trim()) return 'キーワードを入力してください。ランダム検索では入力は不要です。';
  if (value.trim().length > QUERY_LIMIT) return QUERY_LIMIT + '文字以内で入力してください。';
  if (/\bsk-[a-z0-9_-]{8,}/i.test(value) || (apiKey && value.includes(apiKey))) {
    return 'APIキーは検索欄ではなく、API設定に入力してください。';
  }
  return '';
}

function showInputError(message) {
  const field = main.querySelector('#query');
  if (!field) return;
  const target = main.querySelector('#query-error');
  target.textContent = message;
  target.hidden = !message;
  if (message) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  } else {
    field.removeAttribute('aria-invalid');
  }
}

function currentFilter() {
  const selected = main.querySelector('input[name="filter"]:checked')?.value;
  return filterValue(selected ?? currentResult?.filter);
}

function pickLens() {
  const recent = new Set(historyBatches().filter(({ spec }) => spec.random && spec.subject)
    .slice(0, 5).map(({ spec }) => spec.subject));
  return shuffled(LENSES.filter((lens) => !recent.has(lens)))[0];
}

function priorTitles(spec) {
  const past = historyBatches()
    .filter((batch) => batch.spec.source === 'ai'
      && (spec.random ? batch.spec.random : normalize(batch.spec.query) === normalize(spec.query)))
    .slice(0, 3).reverse().flatMap((batch) => batch.records.map((entry) => entry.title));
  const samples = spec.random ? [] : searchSamples(spec.query, 'all').map((entry) => entry.title);
  return [...new Set([...past, ...samples, SELF.title])].slice(-30);
}

function generationStatus(task) {
  if (task.refilling) {
    return task.received ? task.received + '件を取得しました。不足分だけ追加で取得しています。'
      : '件数を減らし、短い公報にして取得し直しています。';
  }
  if (task.received) return task.received + '件を取得しました。残りの公報を編纂しています。';
  return '公報を4件ずつ編纂しています。応答には時間がかかる場合があります。';
}

function numberGenerated(entries, batchId) {
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const year = date.slice(0, 4);
  const issued = new Set(historyBatches().flatMap(({ records }) => records.map(({ number }) => number)));
  const ids = new Map(entries.map((entry) => [entry.slot, 'gen-' + batchId + '-' + entry.slot]));
  return entries.map((entry) => {
    let number;
    do {
      session.serial = session.serial >= 999999 ? 200001 : session.serial + 1;
      number = publicationNumber(entry.kind, year, session.serial);
    } while (issued.has(number));
    const related = CATALOG.find((record) => record.classCode === entry.classCode);
    const id = ids.get(entry.slot);
    const references = entry.citations.map((citation) => ids.get(citation)).filter((ref) => ref && ref !== id);
    return {
      ...entry, id, date, source: 'ai',
      number,
      citations: references.length ? references : [related.id]
    };
  });
}

async function runJob(task, key, model) {
  try {
    const result = await generatePublications({
      subject: task.spec.subject,
      random: task.spec.random,
      filter: task.spec.filter,
      recentTitles: priorTitles(task.spec),
      model,
      key,
      signal: task.controller.signal,
      onProgress: ({ count, refilling }) => {
        task.received = count;
        task.refilling = refilling;
        const status = main.querySelector('#generation-status');
        if (currentPath === task.path && status) status.textContent = generationStatus(task);
      }
    });
    if (task.controller.signal.aborted) return;
    const generated = numberGenerated(result.entries, task.id);
    const records = maybeIncludeSpecial(generated, task.spec.filter);
    // If the rare fixed record replaced a generated result, retarget references to it.
    const replaced = generated.find((entry) => !records.includes(entry));
    const included = replaced ? records.map((entry) => entry === SELF ? entry : {
      ...entry, citations: entry.citations.map((ref) => ref === replaced.id ? SELF_ID : ref)
    }) : records;
    keepBatch({ id: task.id, spec: task.spec, records: included, warning: result.warning });
    task.stage = 'done';
  } catch (error) {
    if (task.controller.signal.aborted) return;
    task.stage = 'error';
    task.errorCode = error instanceof APIProblem ? error.code : 'format';
    task.message = error instanceof APIProblem ? error.message : '公報を処理できませんでした。再試行できます。';
  }
  if (currentPath === task.path) {
    const wasInside = main.contains(document.activeElement);
    render();
    if (wasInside) main.focus({ preventScroll: true });
  }
}

function startSearch({ query = '', random = false, filter = 'all', forceSample = false, replace = false } = {}) {
  if (job?.stage === 'pending') return;
  const q = random ? '' : queryValue(query);
  if (!random && keywordProblem(q)) {
    if (main.querySelector('#query')) showInputError(keywordProblem(q));
    else navigate(editSearchPath({ query: '', filter }));
    return;
  }
  const live = Boolean(apiKey) && !forceSample;
  const spec = {
    query: q, filter, random, source: live ? 'ai' : 'sample',
    subject: random ? (live ? pickLens() : '') : q
  };
  const id = freshId();
  const path = searchPath(spec, id);
  if (!live) {
    const found = random ? randomSamples(filter) : searchSamples(q, filter);
    keepBatch({ id, spec, records: maybeIncludeSpecial(found, filter) });
    navigate(path, { replace });
    return;
  }
  const task = { id, spec, path, controller: new AbortController(), stage: 'pending', received: 0, refilling: false };
  job = task;
  navigate(path, { replace });
  void runJob(task, apiKey, selectedModel);
}

function cancelJob() {
  if (job?.stage !== 'pending') return;
  job.stage = 'cancelled';
  job.message = '必要に応じて、同じ条件で対象を照会し直すことができます。';
  job.controller.abort();
}

function settingsFeedback(message = '', error = false) {
  settingsMessage.textContent = message;
  settingsMessage.dataset.error = String(error);
  settingsMessage.hidden = message.length === 0;
}

function endKeyCheck() {
  if (keyCheck) keyCheck.abort();
  keyCheck = null;
  settingsForm.querySelector('[data-action="check-key"]').disabled = false;
}

function openSettings(button) {
  if (dialog.open) return;
  keyTrigger = button;
  endKeyCheck();
  keyField.value = '';
  modelField.value = selectedModel;
  settingsFeedback();
  updateKeyState();
  dialog.showModal();
  keyField.focus();
}

function expandFigure(button) {
  if (!activeFigure || figureDialog.open) return;
  figureTrigger = button;
  const stage = document.querySelector('#large-figure');
  document.querySelector('#figure-preview-caption').textContent = '図1　' + activeFigure.caption;
  stage.innerHTML = figureSvg(activeFigure, 'large-plate') + figureLegend(activeFigure);
  figureDialog.showModal();
  stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
  stage.scrollTop = 0;
}

figureDialog.addEventListener('close', () => {
  document.querySelector('#large-figure').replaceChildren();
  if (figureTrigger?.isConnected) figureTrigger.focus({ preventScroll: true });
  figureTrigger = null;
});

function keyCandidate() {
  const draft = keyField.value.trim();
  if (draft && !/^sk-[a-z0-9_-]{4,509}$/i.test(draft)) {
    settingsFeedback('OpenAI APIキーの形式を確認してください。', true);
    keyField.focus();
    return null;
  }
  return draft || apiKey;
}

async function checkKey() {
  const candidate = keyCandidate();
  if (candidate === null) return;
  if (!candidate) {
    settingsFeedback('接続を確認するにはAPIキーを入力してください。', true);
    keyField.focus();
    return;
  }
  endKeyCheck();
  const check = new AbortController();
  keyCheck = check;
  const checkButton = settingsForm.querySelector('[data-action="check-key"]');
  checkButton.disabled = true;
  settingsFeedback('OpenAI APIへの接続を確認しています。');
  try {
    const model = Object.hasOwn(MODELS, modelField.value) ? modelField.value : DEFAULT_MODEL;
    const data = await checkModelAccess(model, candidate, check.signal);
    if (check.signal.aborted) return;
    if (!data.id) throw new APIProblem('format', '接続確認の応答を読み取れませんでした。');
    settingsFeedback('選択したモデルへの接続を確認しました。');
  } catch (error) {
    if (!check.signal.aborted) settingsFeedback(error.message, true);
  } finally {
    if (keyCheck === check) endKeyCheck();
  }
}

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const candidate = keyCandidate();
  if (candidate === null) return;
  const changed = apiKey !== candidate;
  const pending = changed && job?.stage === 'pending';
  if (pending) cancelJob();
  apiKey = candidate;
  selectedModel = Object.hasOwn(MODELS, modelField.value) ? modelField.value : DEFAULT_MODEL;
  keyField.value = '';
  dialog.close();
  if (pending || currentResult) render();
  else updateKeyState();
});

dialog.addEventListener('close', () => {
  endKeyCheck();
  keyField.value = '';
  settingsFeedback();
  if (keyTrigger?.isConnected) keyTrigger.focus({ preventScroll: true });
  else header.querySelector('.api-button').focus({ preventScroll: true });
  keyTrigger = null;
});

for (const field of [keyField, modelField]) {
  field.addEventListener('input', () => {
    endKeyCheck();
    settingsFeedback();
  });
}

main.addEventListener('input', (event) => {
  if (event.target.id === 'query' && event.target.hasAttribute('aria-invalid')) showInputError('');
});

main.addEventListener('submit', (event) => {
  if (event.target.id !== 'search-form') return;
  event.preventDefault();
  const query = main.querySelector('#query').value;
  const problem = keywordProblem(query);
  if (problem) showInputError(problem);
  else startSearch({ query, filter: currentFilter() });
});

historyFile.addEventListener('change', () => {
  const file = historyFile.files[0];
  historyFile.value = '';
  if (file && !historyImporting && main.querySelector('[data-action="import-history"]')) void importHistory(file);
});

document.addEventListener('click', (event) => {
  if (event.defaultPrevented) return;
  const action = event.target.closest('button[data-action]');
  if (action) {
    const { action: kind } = action.dataset;
    switch (kind) {
      case 'settings':
        openSettings(action);
        break;
      case 'close-settings':
        dialog.close();
        break;
      case 'expand-figure':
        expandFigure(action);
        break;
      case 'close-figure':
        figureDialog.close();
        break;
      case 'check-key':
        void checkKey();
        break;
      case 'delete-key':
        endKeyCheck();
        cancelJob();
        apiKey = '';
        keyField.value = '';
        if (currentResult) render();
        updateKeyState();
        settingsFeedback('APIキーを削除しました。見本公報を検索できます。');
        break;
      case 'example': {
        const field = main.querySelector('#query');
        field.value = action.dataset.word;
        showInputError('');
        field.focus();
        break;
      }
      case 'random':
        startSearch({ random: true, filter: currentFilter() });
        break;
      case 'cancel':
        cancelJob();
        render();
        main.focus({ preventScroll: true });
        break;
      case 'export-result':
        exportCurrentResult();
        break;
      case 'export-history':
        exportBatches(historyBatches().filter(({ records }) => records.length), '検索履歴');
        break;
      case 'import-history':
        historyFile.click();
        break;
      case 'retry':
      case 'sample':
        if (currentResult) startSearch({ ...currentResult, forceSample: kind === 'sample', replace: true });
        break;
      case 'jump': {
        const section = document.getElementById(action.dataset.section);
        section.querySelector('h2').focus({ preventScroll: true });
        section.scrollIntoView();
        break;
      }
    }
    return;
  }

  const anchor = event.target.closest('a');
  if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (anchor.classList.contains('skip-link')) {
    event.preventDefault();
    main.focus();
    main.scrollIntoView();
    return;
  }
  const destination = anchor.dataset.route;
  if (!destination) return;
  event.preventDefault();

  let returnTo;
  if (destination.startsWith('/publication/')) {
    if (currentPath.startsWith('/publication/')) {
      returnTo = history.state?.returnTo;
    } else {
      const label = currentResult ? '検索結果' : INFO_TITLES.get(readRoute().pathname.split('/')[2]);
      if (label) returnTo = { path: currentPath, label, scrollY: window.scrollY };
    }
  }
  const prior = history.state?.returnTo;
  const scrollY = anchor.hasAttribute('data-restore-list') && prior?.path === destination ? prior.scrollY : 0;
  navigate(destination, { returnTo, scrollY: scrollY ?? 0, replace: destination === currentPath });
});

history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => {
  render();
  focusView(history.state?.scrollY ?? 0);
});
window.addEventListener('pagehide', () => {
  apiKey = '';
  keyField.value = '';
  endKeyCheck();
  cancelJob();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) render();
});
window.addEventListener('storage', (event) => {
  if (event.storageArea !== historyStorage || (event.key !== null && !event.key.startsWith(HISTORY_PREFIX))) return;
  if (event.key === null) savedSearches.clear();
  else {
    const id = event.key.slice(HISTORY_PREFIX.length);
    const batch = readArchivedBatch(event.newValue, event.key);
    if (batch) savedSearches.set(id, batch);
    else savedSearches.delete(id);
  }
  if (!historyImporting && !dialog.open && main.querySelector('[data-action="import-history"]')) render();
});

adoptTabHistory();
shell();
render();
