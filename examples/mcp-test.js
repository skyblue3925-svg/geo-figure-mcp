// MCP 서버를 실제로 띄워 주요 도구를 불러 본다: node examples/mcp-test.js [출력 폴더]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.resolve(process.argv[2] || 'examples/out');
const here = path.dirname(fileURLToPath(import.meta.url));
const c = new Client({ name: 'test', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'src', 'server.js')], env: { ...process.env, GEO_FIGURE_OUT: out } }));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); return r.content[0].text; };
console.log('도구:', (await c.listTools()).tools.map((t) => t.name).join(', '));
const spots = JSON.parse(await call('list_exam_climate_spots', { code: 'Cs' }));
console.log('기출 Cs 지점:', spots.map((s) => s.name).join(', '));
const cl = JSON.parse(await call('find_data', { source: 'climate', regions: spots.slice(0, 4).map((s) => s.name) }));
console.log('기후:', cl.rows.map((r) => `${r.name}←${r.station}(${r.distanceKm}km)`).join(', '));
const wb = JSON.parse(await call('find_data', { source: 'worldbank', indicators: ['SP.URB.TOTL.IN.ZS'], regions: ['KOR', 'IND'] }));
console.log('세계은행:', wb.rows.map((r) => `${r.name} ${r.values['SP.URB.TOTL.IN.ZS'].toFixed(1)}%`).join(', '), wb.year);
try { await call('kosis_search', { query: '주간인구' }); console.log('KOSIS: 인증키 있음, 검색 성공'); } catch (e) { console.log('KOSIS:', e.message.slice(0, 60)); }
try { await call('make_figures', { confirmed: false, figures: [] }); } catch (e) { console.log('확인 전 막힘:', e.message.slice(4, 30)); }
const r = JSON.parse(await call('make_figures', { confirmed: true, name: 'mcp시험', answerKey: '정답표\n(가)~(라) = ' + spots.slice(0, 4).map((s) => s.name).join(', '), figures: [
  { title: '기출 Cs 지점 기후 그래프', chart: { type: 'climate', stations: cl.rows.map((x, i) => ({ label: '(가)(나)(다)(라)'.match(/\(.\)/g)[i], temp: x.values.temp, precip: x.values.precip })) }, source: cl.citeAll || cl.cite },
  { title: '등고선 지형도', map: { type: 'contour', bbox: [126.50, 33.33, 126.60, 33.40], interval: 50, width: 70 } },
  { title: '해안 모식도', chart: { type: 'landform', preset: 'coast-erosion', labels: { 파식대: 'A', 해식애: 'B' } } },
] }));
console.log('파일:', r.files.map((f) => path.basename(f)).join(', '));
await c.close();
