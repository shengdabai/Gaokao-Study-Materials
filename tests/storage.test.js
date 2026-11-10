import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../storage/notebookDb.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { persistNotebook, loadNotebook } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

for (const scenario of ['commit', 'abort', 'abort-empty']) {
  test(`notebook persistence: ${scenario}`, async () => {
    const abort = scenario !== 'commit';
    const saved = new Map();
    const item = { id: 1, subject: '数学', image: 'image', analysis: 'answer', date: 'today' };
    const items = scenario === 'abort-empty' ? [] : [item];
    let closed = false;
    let completed = false;
    const success = (result) => {
      const req = { result };
      queueMicrotask(() => req.onsuccess());
      return req;
    };
    const db = {
      close() { closed = true; },
      transaction() {
        const tx = {
          objectStore: () => ({
            clear: () => success(), put: () => success(),
            getAll: () => success([{ ...item, id: 99 }]),
          }),
        };
        setImmediate(() => {
          completed = true;
          if (abort) {
            tx.error = new Error('Quota exceeded during commit');
            tx.onabort?.();
          } else tx.oncomplete?.();
        });
        return tx;
      },
    };
    // Isolate browser globals without a DOM or a new test dependency.
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    Object.defineProperty(globalThis, 'indexedDB', { value: { open() {
      const req = { result: db };
      queueMicrotask(() => req.onsuccess());
      return req;
    } }, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: {
      setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key),
      getItem: (key) => saved.get(key),
    }, configurable: true });
    try {
      await persistNotebook(items);
      assert.equal(completed, true, 'individual request success is not transaction commit');
      assert.equal(closed, true, 'database connection must close');
      assert.equal(saved.get('app_error_notebook'), abort ? JSON.stringify(items) : undefined);
      if (abort) assert.deepEqual(await loadNotebook(), items, 'fallback must take precedence over stale database data');
    } finally {
      delete globalThis.window;
      delete globalThis.indexedDB;
      delete globalThis.localStorage;
    }
  });
}
