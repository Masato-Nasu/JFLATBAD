import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import './build.mjs';

const argument = (name) => {
  const index = process.argv.indexOf(name, 2);
  return index < 0 ? undefined : process.argv[index + 1];
};
const port = Number(argument('--port') ?? process.env.PORT ?? 8788);
const host = argument('--host') ?? process.env.HOST ?? '127.0.0.1';
const index = new URL('../dist/index.html', import.meta.url);
const screenshot = new URL('../dist/assets/jflatbad-home.jpg', import.meta.url);

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const isScreenshot = pathname === '/assets/jflatbad-home.jpg';
    const content = await readFile(isScreenshot ? screenshot : index);
    response.writeHead(200, {
      'Content-Type': isScreenshot ? 'image/jpeg' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Unable to read dist/index.html.');
  }
});
server.listen(port, host, () => console.log('Local: http://' + host + ':' + port));
