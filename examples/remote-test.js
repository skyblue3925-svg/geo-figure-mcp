// 원격(HTTP) 서버 시험: node examples/remote-test.js http://localhost:8787/mcp <토큰>
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base = process.argv[2] || 'http://localhost:8787/mcp', token = process.argv[3] || '';
const noTok = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
console.log('비밀번호 없이:', noTok.status);
const c = new Client({ name: 'remote-test', version: '0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${base}?token=${encodeURIComponent(token)}`)));
const tools = (await c.listTools()).tools.map((t) => t.name);
console.log('KOSIS 도구 없음:', !tools.some((t) => t.startsWith('kosis') || t === 'set_kosis_key'));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); return { err: r.isError, text: r.content[0].text }; };
const k = await call('find_data', { source: 'kosis', kosis: {} });
console.log('KOSIS 직접 조회 막힘:', k.err);
const b = await call('find_data', { source: 'bundle', bundle: { key: 'fertility', items: ['합계출산율'] } });
console.log('내장 자료:', JSON.parse(b.text).rows.length, '행');
const m = JSON.parse((await call('make_figures', { confirmed: true, name: '원격 시험', answerKey: '정답표\nA = 가', figures: [{ title: '원격 시험', chart: { type: 'bar', categories: ['가', '나'], series: [{ name: 'x', values: [3, 5] }] } }] })).text);
console.log('정답표는 대화창으로:', JSON.stringify(m.answerKey), '|', m.expires);
for (const f of m.files) {
  const buf = Buffer.from(await (await fetch(f)).arrayBuffer());
  const { default: JSZip } = await import('jszip').catch(() => ({}));
  let hasKey = 'jszip 없음';
  if (JSZip) { const z = await JSZip.loadAsync(buf); hasKey = false; for (const n of Object.keys(z.files)) if (/\.xml$/.test(n) && (await z.file(n).async('string')).includes('정답표')) hasKey = true; }
  console.log('  받기', buf.length, 'bytes | 파일 안 정답표:', hasKey, '| 두 번째 받기:', (await fetch(f)).status);
}
console.log('경로 공격 막힘:', (await fetch(base.replace('/mcp', '/files/../../etc/passwd'))).status);
await c.close();
