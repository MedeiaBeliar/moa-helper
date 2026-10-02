import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore, validateState } from './storage.mjs';

const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };
export function createServer({ dataDir = fileURLToPath(new URL('./data/', import.meta.url)) } = {}) {
  const store = createStore(dataDir);
  return http.createServer(async (req, res) => {
    try {
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host || '')) { res.writeHead(403); return res.end('Local access only'); }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/state') {
        res.setHeader('Content-Type','application/json; charset=utf-8');
        res.setHeader('Cache-Control','no-store');
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) { res.writeHead(403); return res.end(JSON.stringify({error:'다른 사이트에서는 저장할 수 없습니다.'})); }
        if (req.method === 'GET') return res.end(JSON.stringify(await store.read()));
        if (req.method !== 'PUT') { res.writeHead(405); return res.end('{}'); }
        if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415); return res.end('{}'); }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) { res.writeHead(413); return res.end(JSON.stringify({error:'저장 데이터가 너무 큽니다.'})); } chunks.push(chunk); }
        const body = Buffer.concat(chunks).toString('utf8');
        let state;
        try { state = validateState(JSON.parse(body)); } catch (error) { res.writeHead(400); return res.end(JSON.stringify({error:error.message})); }
        const saved = await store.write(state);
        return res.end(JSON.stringify({savedAt:saved.savedAt}));
      }
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(root, '.' + relative);
      if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); return res.end(); }
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'",
        'Referrer-Policy':'no-referrer'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (req.url?.startsWith('/api/')) { res.writeHead(500); res.end(JSON.stringify({error:'저장 파일을 읽거나 쓸 수 없습니다. data 폴더의 권한과 state.json을 확인하세요.'})); }
      else { res.writeHead(404); res.end('Not found'); }
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3210);
  const server = createServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Open http://localhost:${port} or set PORT.` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Moa helper: http://localhost:${port}\nStop: Ctrl+C`));
}
