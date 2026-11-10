import assert from 'node:assert/strict';
import { createServer as createHttpServer, request } from 'node:http';
import { test } from 'node:test';
import { createServer } from 'vite';

test('development API bounds bodies and imports only known routes', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const imports = [];
  vite.ssrLoadModule = async (path) => {
    imports.push(path);
    return { default: (req, res) => res.json({ body: req.body }) };
  };
  const http = createHttpServer(vite.middlewares);
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const send = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: http.address().port, path, method: 'POST', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    for (const path of ['/api/../index', '/api/%2e%2e/index', '/api/unknown', '/api/analyze/extra']) {
      assert.equal(await send(path, '{}'), 404);
    }
    assert.deepEqual(imports, []);
    for (const body of ['null', '[]', '{']) assert.equal(await send('/api/search', body), 400);
    assert.equal(await send('/api/search', JSON.stringify({ question: '数学' })), 200);
    assert.deepEqual(imports, ['/api/search.js']);
    assert.equal(await send('/api/analyze', 'x'.repeat(8 * 1024 * 1024 + 1), { 'Content-Type': 'application/json' }), 413);
    assert.equal(await send('/api/status?check=1', ''), 200);
  } finally {
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
    await vite.close();
  }
});
