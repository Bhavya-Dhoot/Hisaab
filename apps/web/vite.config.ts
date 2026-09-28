import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/web -> apps -> hisab (repo root)
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Dev-only middleware that runs `pnpm -F @hisab/api demo:seed` server-side and
 * relays its SEED_JSON summary to the browser. There is no HTTP seed endpoint in
 * the API (only the CLI script + POST /v1/demo/reset), and per the build brief we
 * do not modify apps/api — so the "Seed demo" button in the UI shells out to the
 * same script the e2e harness (apps/api/scripts/e2e.ts) already uses.
 */
function seedMiddleware(): Plugin {
  return {
    name: 'hisab-seed-middleware',
    configureServer(server) {
      server.middlewares.use('/__seed', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }
        execFile(
          'pnpm',
          ['-F', '@hisab/api', 'demo:seed'],
          { cwd: REPO_ROOT, shell: true, maxBuffer: 1024 * 1024 * 16 },
          (err, stdout, stderr) => {
            res.setHeader('Content-Type', 'application/json');
            if (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: { code: 'SEED_FAILED', message: stderr || String(err) } }));
              return;
            }
            const m = /SEED_JSON_START\s*([\s\S]*?)\s*SEED_JSON_END/.exec(stdout);
            if (!m) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: { code: 'SEED_NO_OUTPUT', message: stdout } }));
              return;
            }
            res.statusCode = 200;
            res.end(m[1]);
          }
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seedMiddleware()],
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://127.0.0.1:4000',
      '/mock': 'http://127.0.0.1:4000',
    },
  },
});
