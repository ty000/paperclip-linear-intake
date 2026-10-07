import { createServer } from 'node:http';
import { once } from 'node:events';

// Real loopback sockets; deliberately synthetic MCP replies, never Linear data.
export function reply(res, rpc, result) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
}

export async function syntheticGateway(t, handle) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const rpc = JSON.parse(body);
      requests.push({ method: req.method, url: req.url, headers: req.headers, rpc });
      if (handle?.(req, res, rpc)) return;
      if (rpc.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
      } else {
        reply(res, rpc, rpc.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
          : { tools: [{ name: 'fixture_read', inputSchema: { type: 'object' } }] });
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp/gateways/fixture`,
    requests,
  };
}
