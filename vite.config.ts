import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig, type ViteDevServer, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { MAX_BODY_BYTES, parseJsonObject } from './server/request.js';

function apiRoutesPlugin(): Plugin {
  return {
    name: 'api-routes',
    config() {
      // Load .env.local into process.env for server-side API handlers
      try {
        const envContent = readFileSync(path.resolve(__dirname, '.env.local'), 'utf-8');
        for (const line of envContent.split('\n')) {
          const idx = line.indexOf('=');
          if (idx > 0) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            if (key && !process.env[key]) process.env[key] = val;
          }
        }
      } catch {}
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/')) return next();
        const route = req.url.split('?')[0];
        const routes: Record<string, string> = {
          '/api/analyze': '/api/analyze.js',
          '/api/search': '/api/search.js',
          '/api/status': '/api/status.js',
        };
        if (!Object.hasOwn(routes, route)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Not found' }));
        }

        // Express-compatible response shim
        const mockRes: any = {
          _statusCode: 200,
          _headers: {} as Record<string, string>,
          setHeader(k: string, v: string) { this._headers[k] = v; return this; },
          status(code: number) { this._statusCode = code; return this; },
          json(data: unknown) {
            res.writeHead(this._statusCode, { 'Content-Type': 'application/json', ...this._headers });
            res.end(JSON.stringify(data));
          },
        };

        try {
          if (req.method === 'POST' && route !== '/api/status') {
            const chunks: Buffer[] = [];
            let size = 0;
            const raw = await new Promise<string>((resolve, reject) => {
              req.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_BODY_BYTES) {
                  chunks.length = 0;
                  reject(Object.assign(new Error('Request too large'), { status: 413 }));
                } else {
                  chunks.push(chunk);
                }
              });
              req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
              req.on('error', reject);
              req.on('aborted', () => reject(new Error('Request aborted')));
            });
            const body = parseJsonObject(raw);
            if (!body) return mockRes.status(400).json({ error: 'Expected a JSON object' });
            (req as any).body = body;
          }
          const mod = await server.ssrLoadModule(routes[route]);
          await mod.default(req, mockRes);
        } catch (e) {
          if (res.destroyed || res.writableEnded) return;
          const status = (e as { status?: number }).status === 413 ? 413 : 500;
          mockRes.status(status).json({ error: status === 413 ? 'Request too large' : 'Internal server error' });
        }
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react(), tailwindcss(), apiRoutesPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
