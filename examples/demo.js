// 시연: AI가 MCP 도구를 실제로 부르는 순서 그대로 실행하고, 대화처럼 기록을 남긴다.
// node examples/demo.js [출력 폴더]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, 'demo'));
fs.mkdirSync(out, { recursive: true });
const c = new Client({ name: 'demo', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'src', 'server.js')], env: { ...process.env, GEO_FIGURE_OUT: out } }));
const log = [];
const call = async (name, args) => {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content[0].text;
  log.push(`   🔧 ${name}(${JSON.stringify(args).slice(0, 110)}${JSON.stringify(args).length > 110 ? '…' : ''})`);
  if (r.isError) throw new Error(text);
  return JSON.parse(text);
};
const say = (who, t) => log.push(`${who === 'T' ? '👩‍🏫 교사' : '🤖 AI'}: ${t}`);

// ── 시연 1 ──
say('T', '"우리 동네 주제로, 경기도 시·군 주간 인구 지수 지도 만들어 줘. 화성시는 꼭 넣고 나머지 3곳은 판별 잘 되게. 이름은 숨겨서."');
const d = await call('find_data', { source: 'bundle', bundle: { key: 'daytime-population', items: ['주간 인구 지수'] } });
const gg = d.rows.filter((r) => r.mapName?.startsWith('경기 '));
const others = await call('suggest_regions', { rows: gg.filter((r) => r.mapName !== '경기 화성시').map((r) => ({ name: r.mapName, values: { 지수: r.values['주간 인구 지수'] } })), indicators: ['지수'], k: 3 });
const picks = ['경기 화성시', ...others.picks];
const L = await call('assign_labels', { names: picks, order: 'random', seed: 9 });
const v = (n) => gg.find((r) => r.mapName === n).values['주간 인구 지수'];
say('A', `계획 요약 — 지표: 주간 인구 지수 / 연도: ${d.year}(인구주택총조사) / 지역: 경기 시·군 ${gg.length}곳, 기호 A~D = ${Object.entries(L).map(([n, l]) => `${l}:${n.replace('경기 ', '')}(${v(n)})`).join(', ')} / 단계 4개(90·100·110 경계) / 지도 판 ${d.mapEdition} / 출처: ${d.cite}. 이대로 만들까요?`);
say('T', '"응"');
const cls = (x) => (x < 90 ? 0 : x < 100 ? 1 : x < 110 ? 2 : 3);
const r1 = await call('make_figures', { confirmed: true, name: '시연1_경기_주간인구', answerKey: `정답표\n${Object.entries(L).map(([n, l]) => `${l} = ${n.replace('경기 ', '')} (주간 인구 지수 ${v(n)})`).join('\n')}`, figures: [{
  title: '경기도 시·군의 주간 인구 지수',
  map: { region: 'korea', level: 'sigungu', within: ['경기'], edition: d.mapEdition, width: 82, classes: Object.fromEntries(gg.map((r) => [r.mapName, cls(r.values['주간 인구 지수'])])), labels: L, legend: ['90 미만', '90~100', '100~110', '110 이상'] },
  notes: ['* 주간 인구 지수 = (주간 인구 ÷ 상주인구) × 100'], source: `${d.cite}, ${d.year}`,
}] });
say('A', `만들었어요 → ${r1.files.map((f) => path.basename(f)).join(', ')}`);

// ── 시연 2 ──
say('T', '"통합사회 세계 인구 단원용으로, 나라 4곳 인구 피라미드랑 합계 출산율 막대그래프. 선진국·개도국 섞어서, 나라 이름은 (가)~(라)."');
const iso = ['KOR', 'NGA', 'IND', 'DEU'];
const ind = ['SP.DYN.TFRT.IN', 'SP.POP.0014.TO.ZS', 'SP.POP.65UP.TO.ZS'];
const wb = await call('find_data', { source: 'worldbank', indicators: ind, regions: iso });
const G = await call('assign_labels', { names: wb.rows.map((r) => r.name), style: 'ga', seed: 5 });
const ord = Object.entries(G).sort((a, b) => a[1].localeCompare(b[1]));
const row = (n) => wb.rows.find((r) => r.name === n);
say('A', `계획 요약 — 지표: 합계 출산율, 유소년(0~14세)·노년(65세 이상) 인구 비율 / 연도: ${wb.year} / 나라: ${ord.map(([n, l]) => `${l}:${n}`).join(', ')} / 그래프 2개(막대·누적 막대) / 출처: 세계은행 WDI. 피라미드는 5세 단위 자료 대신 연령 3구분 누적 막대로 만들까요?`);
say('T', '"좋아"');
const r2 = await call('make_figures', { confirmed: true, name: '시연2_세계_인구', answerKey: `정답표\n${ord.map(([n, l]) => `${l} = ${n}`).join('\n')}`, figures: [{
  title: '네 나라의 인구 구조와 합계 출산율', layout: 'row',
  parts: [
    { caption: '(가) 합계 출산율', chart: { type: 'bar', categories: ord.map(([, l]) => l), series: [{ name: '합계 출산율', values: ord.map(([n]) => +row(n).values['SP.DYN.TFRT.IN'].toFixed(2)) }], unit: '(명)', valueLabels: 'all', width: 62, height: 50 } },
    { caption: '(나) 연령층별 인구 비율', chart: { type: 'stacked', categories: ord.map(([, l]) => l), series: [
      { name: '0~14세', values: ord.map(([n]) => Math.round(row(n).values['SP.POP.0014.TO.ZS'])) },
      { name: '15~64세', values: ord.map(([n]) => 100 - Math.round(row(n).values['SP.POP.0014.TO.ZS']) - Math.round(row(n).values['SP.POP.65UP.TO.ZS'])) },
      { name: '65세 이상', values: ord.map(([n]) => Math.round(row(n).values['SP.POP.65UP.TO.ZS'])) }], unit: '(%)', valueLabels: 'all', width: 70, height: 50 } },
  ], source: `World Bank WDI, ${wb.year}`,
}] });
say('A', `만들었어요 → ${r2.files.map((f) => path.basename(f)).join(', ')}`);

// ── 시연 3 ──
say('T', '"세계지리 기후 단원. 평가원 기출 지점 중에 지중해성 기후 2곳, 서안 해양성 1곳, 건조 1곳 골라서 세계 지도랑 기후 그래프 짝짓기 문제 자료."');
const cs = await call('list_exam_climate_spots', { code: 'Cs' }), cfb = await call('list_exam_climate_spots', { code: 'Cfb' }), bw = await call('list_exam_climate_spots', { code: 'BW' });
const names = [cs[0].name, cs.find((s) => s.lat < 0)?.name || cs[1].name, cfb[0].name, bw.find((s) => s.lat != null).name];
const cl = await call('find_data', { source: 'climate', regions: names });
const M = await call('assign_labels', { names, order: 'west-east', coords: Object.fromEntries(cl.rows.map((r) => [r.name, [r.lon, r.lat]])) });
const K = await call('assign_labels', { names, style: 'ga', seed: 11 });
say('A', `계획 요약 — 지점: ${cl.rows.map((r) => `${r.name}(${r.exam?.code}, ${r.station} 관측소 ${r.distanceKm}km)`).join(', ')} / 지도 A~D는 서→동, 그래프 (가)~(라)는 무작위 / 자료: ${cl.citeAll}. 남반구 지점이 하나 들어가 계절 반전 함정을 만들 수 있어요. 만들까요?`);
say('T', '"그래"');
const kord = Object.entries(K).sort((a, b) => a[1].localeCompare(b[1]));
const r3 = await call('make_figures', { confirmed: true, name: '시연3_기후_짝짓기', answerKey: `정답표\n${names.map((n) => `${M[n]} = ${K[n]} = ${n}`).join('\n')}`, figures: [{
  title: '기후 지점과 기후 그래프', layout: 'column',
  parts: [
    { map: { region: 'world', bbox: [-180, -50, 180, 72], graticule: 30, width: 82, height: 50, points: cl.rows.map((r) => ({ lon: r.lon, lat: r.lat, label: M[r.name] })) } },
    { chart: { type: 'climate', stations: kord.map(([n, l]) => { const r = cl.rows.find((x) => x.name === n); return { label: l, temp: r.values.temp, precip: r.values.precip }; }), width: 82 } },
  ], source: `지도: Natural Earth; ${cl.citeAll}`,
}] });
say('A', `만들었어요 → ${r3.files.map((f) => path.basename(f)).join(', ')}`);

fs.writeFileSync(path.join(out, '시연_대화기록.txt'), log.join('\n') + '\n');
console.log(log.join('\n'));
await c.close();
