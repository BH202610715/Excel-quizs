import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = process.env.NODE_ENV === 'production' && existsSync(join(root, 'dist', 'index.html'))
  ? join(root, 'dist')
  : root;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  const safePath = normalize(pathname).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
  let target = resolve(publicRoot, safePath || 'index.html');
  const publicTarget = resolve(publicRoot, 'public', safePath);
  if (!existsSync(target) && publicTarget.startsWith(resolve(publicRoot) + sep) && existsSync(publicTarget)) target = publicTarget;
  if (!target.startsWith(resolve(publicRoot) + sep) && target !== resolve(publicRoot, 'index.html')) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    if (pathname === '/' || !extname(pathname)) target = join(publicRoot, 'index.html');
    else {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
  }
  response.writeHead(200, {
    'Content-Type': mime[extname(target)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(target).pipe(response);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Excel Quiz listening on 0.0.0.0:${port}`));
