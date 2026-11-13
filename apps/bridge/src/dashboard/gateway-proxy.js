import { request as httpRequest } from 'node:http';

export function handleGatewayProxy(request, response, url) {
  if (url.pathname === '/gw/outbound') {
    const outboundPort = Number(process.env.GATEWAY_OUTBOUND_PORT || 6192);
    const proxyReq = httpRequest({
      hostname: '127.0.0.1',
      port: outboundPort,
      path: '/gw/outbound',
      method: request.method,
      headers: {
        ...request.headers,
        host: `127.0.0.1:${outboundPort}`,
      },
    }, (proxyRes) => {
      response.writeHead(proxyRes.statusCode || 200, {
        ...proxyRes.headers,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      proxyRes.pipe(response);
    });
    proxyReq.on('error', (err) => {
      response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'outbound_unavailable', detail: err?.message || String(err) }));
    });
    request.pipe(proxyReq);
    return true;
  }

  const isGatewayPath = url.pathname.startsWith('/api/tools')
    || url.pathname.startsWith('/api/channels')
    || url.pathname.startsWith('/api/gateway/');

  if (!isGatewayPath) return false;

  const gatewayPort = Number(process.env.GATEWAY_PORT || 6185);
  let targetPath = url.pathname + url.search;
  if (url.pathname.startsWith('/api/gateway/')) {
    const subPath = url.pathname.slice('/api/gateway'.length) || '/status';
    targetPath = subPath + url.search;
  }

  const proxyReq = httpRequest({
    hostname: '127.0.0.1',
    port: gatewayPort,
    path: targetPath,
    method: request.method,
    headers: {
      ...request.headers,
      host: `127.0.0.1:${gatewayPort}`,
    },
  }, (proxyRes) => {
    response.writeHead(proxyRes.statusCode || 200, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    proxyRes.pipe(response);
  });

  proxyReq.on('error', (err) => {
    response.writeHead(502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({
      error: 'gateway_unavailable',
      message: `无法连接到 Gateway 服务 (127.0.0.1:${gatewayPort})`,
      detail: err?.message || String(err),
    }));
  });

  request.pipe(proxyReq);
  return true;
}
