import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project = new URL('../', import.meta.url);
const sources = new URL('src/', project);
const dist = new URL('dist/', project);
const readSource = (name) => readFile(new URL(name, sources), 'utf8');

const scriptFiles = ['catalog.js', 'figures.js', 'info.js', 'api.js', 'app.js'];
const [template, styles, icon, ...scripts] = await Promise.all([
  readSource('index.html'),
  readSource('styles.css'),
  readFile(new URL('icon.png', sources)),
  ...scriptFiles.map(readSource)
]);

const script = "(() => {\n'use strict';\n\n" + scripts.join('\n\n') + '\n})();\n';
if (/<\/script/i.test(script) || /<\/style/i.test(styles)) {
  throw new Error('A source would terminate its HTML element.');
}
const hash = (value) => "'sha256-" + createHash('sha256').update(value).digest('base64') + "'";
const csp = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
  'script-src ' + hash(script),
  'style-src ' + hash(styles),
  'img-src data:',
  'connect-src https://api.openai.com'
].join('; ');

const html = template
  .replace('%%CSP%%', () => csp)
  .replace('%%ICON%%', () => 'data:image/png;base64,' + icon.toString('base64'))
  .replace('%%CSS%%', () => styles)
  .replace('%%JS%%', () => script);

const headers = {
  'Content-Security-Policy': csp + "; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

await mkdir(dist, { recursive: true });
await Promise.all([
  writeFile(new URL('index.html', dist), html),
  writeFile(new URL('_headers', dist), '/*\n' + Object.entries(headers)
    .map(([name, value]) => '  ' + name + ': ' + value).join('\n') + '\n')
]);
console.log('Built dist/index.html');
