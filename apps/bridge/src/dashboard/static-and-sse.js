import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { subscribeLogs, tailLogs } from '../terminal-log.js';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
};

export function handleSseAndStatic(server, request, response, url) {
  if (url.pathname === '/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(`data: ${JSON.stringify(server.state.snapshot())}\n\n`);
    server.clients.add(response);
    request.on('close', () => server.clients.delete(response));
    return;
  }

  if (url.pathname === '/logs') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    for (const line of tailLogs(200)) {
      response.write(`data: ${line}\n\n`);
    }
    const unsubscribe = subscribeLogs((line) => {
      response.write(`data: ${line}\n\n`);
    });
    request.on('close', () => {
      unsubscribe();
    });
    return;
  }

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const relative = normalize(requested).replace(/^([/\\])+/, '');
  let filePath = join(server.publicRoot, relative);

  if (!filePath.startsWith(server.publicRoot) || !existsSync(filePath)) {
    const fallbackPath = join(server.publicRoot, 'index.html');
    if (
      !url.pathname.startsWith('/api/')
      && !url.pathname.startsWith('/events')
      && !url.pathname.startsWith('/logs')
      && !url.pathname.startsWith('/downloads/')
      && existsSync(fallbackPath)
    ) {
      filePath = fallbackPath;
    } else {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
  }

  const headers = {
    'Content-Type': CONTENT_TYPES[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  };
  if (extname(filePath) === '.apk') {
    headers['Content-Disposition'] = 'attachment; filename="feaglewxbot-agent.apk"';
    headers['Content-Type'] = 'application/vnd.android.package-archive';
  }
  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
}
