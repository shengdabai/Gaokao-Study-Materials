import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import analyze from '../api/analyze.js';
import search from '../api/search.js';

process.env.GEMINI_API_KEY = 'test-placeholder';
process.env.WEBHOOK_URL = 'https://example.test/notes';
afterEach(() => mock.restoreAll());

function response() {
  return {
    code: 200, headers: {},
    status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(data) { this.data = data; return this; },
  };
}

test('API rejects invalid JSON objects without contacting providers', async () => {
  const network = mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network'); });
  for (const handler of [analyze, search]) {
    for (const body of ['null', '[]', '{', '1', null, []]) {
      const res = response();
      await handler({ method: 'POST', body }, res);
      assert.equal(res.code, 400);
    }
  }
  assert.equal(network.mock.callCount(), 0);
});

test('API enforces question and image limits and data URL format', async () => {
  const network = mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network'); });
  for (const imageDataUrl of ['x,AAAA', 'data:text/html;base64,AAAA', 'data:image/png;base64,!!!!', 'data:image/png;base64,A']) {
    const res = response();
    await analyze({ method: 'POST', body: { imageDataUrl } }, res);
    assert.equal(res.code, 400);
  }
  const image = response();
  await analyze({ method: 'POST', body: { imageDataUrl: `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}` } }, image);
  assert.equal(image.code, 413);
  const question = response();
  await search({ method: 'POST', body: { question: 'x'.repeat(2001) } }, question);
  assert.equal(question.code, 400);
  assert.equal(network.mock.callCount(), 0);
});

test('search preserves answers containing error and rejects malformed webhook answers', async () => {
  for (const [payload, expectedSource] of [
    ['{"answer":"error function 的概念"}', '知识库'],
    ['null', 'AI'], ['{"answer":{"bad":true}}', 'AI'], ['["bad"]', 'AI'], ['accepted', 'AI'],
  ]) {
    const network = mock.method(globalThis, 'fetch', async (url, options) => {
      if (url === process.env.WEBHOOK_URL) {
        assert.ok(options.signal);
        assert.equal(options.redirect, 'error');
        return new Response(payload);
      }
      return Response.json({ candidates: [{ content: { parts: [{ text: 'fallback answer' }], role: 'model' } }] });
    });
    const res = response();
    await search({ method: 'POST', body: { question: '数学' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.data.source, expectedSource);
    assert.equal(typeof res.data.result.answer, 'string');
    network.mock.restore();
  }
});

test('valid image reaches the provider and returns analysis', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({
    candidates: [{ content: { parts: [{ text: '分步解答' }], role: 'model' } }],
  }));
  const res = response();
  await analyze({ method: 'POST', body: { imageDataUrl: 'data:image/png;base64,AAAA' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.analysis, '分步解答');
});

test('API only accepts POST', async () => {
  for (const handler of [analyze, search]) {
    const res = response();
    await handler({ method: 'GET' }, res);
    assert.equal(res.code, 405);
    assert.equal(res.headers.Allow, 'POST');
  }
});

test('upstream failure logs omit provider URLs, keys and response details', async () => {
  const logs = mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async () => { throw new Error('private-provider-detail'); });
  const res = response();
  await search({ method: 'POST', body: { question: '数学' } }, res);
  assert.equal(res.code, 500);
  assert.equal(logs.mock.callCount(), 2);
  assert.ok(logs.mock.calls.every(({ arguments: args }) => args.length === 1 && !args[0].includes('private-provider-detail')));
});
