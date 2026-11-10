#!/usr/bin/env node
// geo-figure-mcp 원격 실행(HTTP) — ChatGPT·Gemini·Claude 웹 등에 주소만 붙여 쓴다.
//   PORT=8787 PUBLIC_URL=https://내주소 node src/http.js
// - MCP 주소: <PUBLIC_URL>/mcp   (Streamable HTTP, 요청마다 새 서버 = 상태 없음)
// - 만든 파일: <PUBLIC_URL>/files/<무작위>/<이름>  — 한 번 받으면 바로 지우고, 안 받아도 KEEP_MINUTES(기본 60분) 뒤 지운다
// - ACCESS_TOKEN 필수: /mcp?token=… 또는 Authorization: Bearer … (비밀번호 없이 열려면 ALLOW_OPEN=1)
// - 정답표는 파일에 넣지 않고 대화창에만 돌려준다. KOSIS 직접 조회는 원격에서 끈다(내장 자료만).
// - 사용량: IP마다 1분 60번·그림 1시간 90번, 서버 전체 그림 하루 DAILY_MAX(기본 300)번
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './tools.js';

const PORT = +(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const FILES = process.env.FILES_DIR || path.join(os.tmpdir(), 'geo-figure-files');
const TOKEN = process.env.ACCESS_TOKEN || '';
const KEEP_MIN = +(process.env.KEEP_MINUTES || 60);
const KEEP_MS = KEEP_MIN * 60 * 1000;
const MAKE_PER_HOUR = 90;
const DAILY_MAX = +(process.env.DAILY_MAX || 300);
if (!TOKEN && process.env.ALLOW_OPEN !== '1') { console.error('ACCESS_TOKEN 을 정하세요(비밀번호 없이 열려면 ALLOW_OPEN=1).'); process.exit(1); }
const tokenOk = (got) => { const a = Buffer.from(String(got || '')), b = Buffer.from(TOKEN); return a.length === b.length && crypto.timingSafeEqual(a, b); };
let day = '', dayCount = 0;
const dailyOver = () => { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; dayCount = 0; } return ++dayCount > DAILY_MAX; };
fs.mkdirSync(FILES, { recursive: true });

const publish = {
  newDir: () => { const d = path.join(FILES, crypto.randomBytes(12).toString('hex')); fs.mkdirSync(d, { recursive: true }); return d; },
  keepText: KEEP_MIN >= 60 ? `${Math.round(KEEP_MIN / 60)}시간` : `${KEEP_MIN}분`,
  url: (p) => { const rel = path.relative(FILES, p).split(path.sep); return `${PUBLIC_URL}/files/${rel.map(encodeURIComponent).join('/')}`; },
};

// 오래된 파일 지우기(5분마다)
setInterval(() => {
  for (const d of fs.readdirSync(FILES)) {
    const p = path.join(FILES, d);
    try { if (Date.now() - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
}, 5 * 60 * 1000).unref();

// 사용량 제한: IP 마다 1분에 60번, 그림 만들기는 1시간에 90번
const hits = new Map();
function limited(ip, kind, max, windowMs) {
  const k = `${ip}|${kind}`, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  // 프록시 뒤(Render·Cloud Run)에서는 맨 끝 값이 프록시가 붙인 진짜 주소다(앞쪽은 사용자가 꾸밀 수 있음)
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',').pop().trim();
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' }); return res.end(); }

  if (url.pathname === '/' || url.pathname === '/health') return send(res, 200, { name: 'geo-figure-mcp', mcp: `${PUBLIC_URL}/mcp`, ok: true });

  if (url.pathname.startsWith('/files/') && req.method === 'GET') {
    const rel = url.pathname.slice('/files/'.length).split('/').map(decodeURIComponent);
    if (rel.length !== 2 || !/^[0-9a-f]{24}$/.test(rel[0]) || rel[1].includes('..') || rel[1].includes('/') || rel[1].includes('\\')) return send(res, 404, { error: 'not found' });
    const p = path.join(FILES, rel[0], rel[1]);
    if (!fs.existsSync(p)) return send(res, 404, { error: '파일이 없습니다(이미 받았거나 보관 시간이 지나 지워졌습니다).' });
    const type = p.endsWith('.pptx') ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : p.endsWith('.hwpx') ? 'application/hwp+zip' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rel[1])}`, 'Access-Control-Allow-Origin': '*' });
    const st = fs.createReadStream(p);
    st.on('end', () => { try { fs.rmSync(p, { force: true }); const d = path.dirname(p); if (!fs.readdirSync(d).length) fs.rmSync(d, { recursive: true, force: true }); } catch {} });
    return st.pipe(res);
  }

  if (url.pathname === '/mcp') {
    if (TOKEN) {
      const got = url.searchParams.get('token') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!tokenOk(got)) return send(res, 401, { error: 'unauthorized' });
    }
    if (limited(ip, 'all', 60, 60 * 1000)) return send(res, 429, { error: '요청이 너무 많습니다. 1분 뒤 다시 시도하세요.' });
    if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'POST 만 받습니다(상태 없는 서버).' }, id: null });
    let raw = '';
    for await (const ch of req) { raw += ch; if (raw.length > 2_000_000) return send(res, 413, { error: '요청이 너무 큽니다.' }); }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'JSON 이 아닙니다.' }); }
    const isMake = [].concat(body).some((m) => m?.method === 'tools/call' && m?.params?.name === 'make_figures');
    if (isMake && limited(ip, 'make', MAKE_PER_HOUR, 3600 * 1000)) return send(res, 429, { error: '같은 접속 IP에서는 최근 1시간에 ' + MAKE_PER_HOUR + '번까지 파일을 만들 수 있습니다.' });
    if (isMake && dailyOver()) return send(res, 429, { error: '오늘 서버 전체 사용량을 다 썼습니다. 내일 다시 쓰거나 내 컴퓨터에 설치해 쓰세요.' });
    try {
      const mcp = createServer({ remote: true, publish });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) send(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: String(e.message || e) }, id: null });
    }
    return;
  }
  send(res, 404, { error: 'not found' });
});
server.listen(PORT, () => console.log(`geo-figure-mcp 원격 서버: ${PUBLIC_URL}/mcp  (파일 ${FILES})`));
