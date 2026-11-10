// 자동 검사: 네트워크 없이 모든 그림 종류를 만들어 PPTX·HWPX·미리보기가 깨지지 않는지 본다.
// node tests/smoke.js   (깃허브에서 push·태그마다 실행)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/tools.js';
import { unzipSync, strFromU8 } from 'fflate';
import { makeFigure, exportFigures } from '../src/build.js';
import { renderPng } from '../src/svg.js';
import { LANDFORM_PRESETS } from '../src/terrain.js';
import { listRegions } from '../src/maps.js';
import { findData, examSpots } from '../src/data.js';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '통과' : '실패'}  ${msg}`); if (!cond) fail++; };
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-smoke-'));

const specs = [
  { title: '시도 단계구분', map: { region: 'korea', level: 'sido', classes: { 서울: 3, 경기: 2, 강원: 0 }, labels: { 경기: 'A', 강원: 'B' }, legend: ['낮음', '', '', '높음'] } },
  { title: '시군구 바탕 없음', map: { region: 'korea', level: 'sigungu', within: ['경기'], labels: { '경기 화성시': 'A' }, labelStyle: 'plain' } },
  { title: '세계 점', map: { region: 'world', bbox: [-180, -50, 180, 72], points: [{ lon: 12.5, lat: 41.9, label: 'A' }], labelStyle: 'circle' } },
  { title: '막대', chart: { type: 'bar', categories: ['가', '나'], series: [{ name: 'x', values: [1, 2] }] } },
  { title: '누적', chart: { type: 'stacked', categories: ['가', '나'], series: [{ name: 'x', values: [1, 2] }, { name: 'y', values: [2, 1] }] } },
  { title: '산점도', chart: { type: 'scatter', points: [{ label: 'A', x: 1, y: 2 }, { label: 'B', x: 3, y: 1 }], xLabel: 'x', yLabel: 'y' } },
  { title: '삼각', chart: { type: 'triangle', names: ['1차', '2차', '3차'], points: [{ label: 'A', a: 10, b: 30, c: 60 }] } },
  { title: '모식도', chart: { type: 'landform', preset: Object.keys(LANDFORM_PRESETS)[0] } },
];
const figs = [];
for (const s of specs) {
  try { figs.push(await makeFigure(s)); ok(true, `그림 만들기: ${s.title}`); } catch (e) { ok(false, `그림 만들기: ${s.title} — ${e.message}`); }
}

// 묶음은 한 겹: 그림 안에 남는 묶음은 기호(글자+테두리)뿐
const deepGroups = figs.flatMap((f) => f.items.filter((it) => it.t === 'group' && !it.keep).map(() => f.title));
ok(!deepGroups.length, `묶음 한 겹(남은 묶음: ${deepGroups.join(', ') || '없음'})`);

// 삼각 다이어그램 눈금 숫자
const tri = figs.find((f) => f.title === '삼각');
ok(tri && tri.items.some((it) => it.t === 'text' && /^눈금/.test(it.name || '') && it.str === '100'), '삼각 다이어그램 0~100 눈금');

// 지도 출처 자동 표시
ok(figs[0].items.some((it) => it.t === 'text' && /SGIS/.test(it.str)), '한국 지도 출처(SGIS) 자동 표시');

// 파일
const files = exportFigures(figs, { outDir: out, name: '검사', answerKey: '정답표\nA = 가' });
for (const f of files) {
  const z = unzipSync(fs.readFileSync(f));
  const xml = Object.entries(z).filter(([n]) => n.endsWith('.xml')).map(([, b]) => strFromU8(b)).join('');
  ok(Object.keys(z).length > 3 && !/NaN|Infinity|undefined/.test(xml), `${path.basename(f)}: 열 수 있는 구조(NaN·Infinity 없음)`);
  ok(xml.includes('정답표'), `${path.basename(f)}: 정답표 마지막 장`);
}
const hx = strFromU8(unzipSync(fs.readFileSync(files.find((f) => f.endsWith('.hwpx'))))['Contents/section0.xml']);
ok(/pageBreak="1"/.test(hx), 'HWPX: 넘치는 그림은 다음 쪽으로');

// 미리보기 PNG
const png = renderPng(figs[0], { width: 400 });
ok(png.length > 2000 && png[1] === 0x50, `미리보기 PNG(${png.length} bytes)`);

// 내장 자료
const cl = await findData({ source: 'climate', regions: ['칭다오', '티베트고원'] });
ok(cl.rows.length === 2 && cl.rows.every((r) => r.values.temp.length === 12), '기후 자료: 칭다오·티베트고원');
ok(examSpots().find((s) => s.name === '칭다오').code === 'Cw', '칭다오 기호 Cw');
const temperature = await findData({ source: 'climate', regions: ['칭다오', '티베트고원'], indicators: ['temp'] });
ok(temperature.unit === '℃' && temperature.citeAll === cl.citeAll && temperature.rows.every((row, i) =>
  Object.keys(row.values).length === 1 && JSON.stringify(row.values.temp) === JSON.stringify(cl.rows[i].values.temp)),
'기후: 기온만 선택해도 월별 값과 출처 일치');
const b = await findData({ source: 'bundle', bundle: { key: 'daytime-population', items: ['주간 인구 지수'] } });
ok(b.rows.length > 200, `내장 KOSIS 자료(${b.rows.length}행)`);

const query = { key: 'daytime-population', period: '2020', items: ['주간 인구 지수'] };
const gyeonggi = await findData({ source: 'bundle', bundle: { ...query, within: ['경기'] } });
const names = new Set(listRegions({ level: 'sigungu', within: ['경기'], edition: gyeonggi.mapEdition }));
const expected = b.rows.filter((row) => names.has(row.mapName));
ok(gyeonggi.rows.length === 31 && JSON.stringify(gyeonggi.rows) === JSON.stringify(expected), '내장 KOSIS: 경기도 31개 시·군의 값과 지도 이름 일치');
const central = await findData({ source: 'bundle', bundle: { ...query, regions: ['서울 중구', '부산 중구'] } });
ok(central.rows.length === 2 && central.rows.some((r) => r.mapName === '서울 중구') && central.rows.some((r) => r.mapName === '부산 중구'), '내장 KOSIS: 같은 이름의 지역을 시·도별로 선택');

// 실제 MCP 호출에서 시안 ID는 확인 절차를 거쳐 같은 HWPX를 내보낸다.
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer();
const client = new Client({ name: 'smoke', version: '1' });
await server.connect(serverTransport);
await client.connect(clientTransport);
const call = (name, args) => client.callTool({ name, arguments: args });
try {
  const climateSpots = JSON.parse((await call('list_exam_climate_spots', { code: 'Cs', summary: true })).content[0].text);
  ok(climateSpots.length > 0 && climateSpots.every((spot) => spot.code.startsWith('Cs') && Object.keys(spot).length === 2), 'MCP: 기후 후보 지점 요약');
  const regions = JSON.parse((await call('list_regions', { edition: '2025', query: '광주' })).content[0].text);
  ok(JSON.stringify(regions) === JSON.stringify(['광주']), 'MCP: 과거 지도 판에서 광주 이름 검색');
  const figures = [specs[1]];
  const style = { size: 10 };
  const args = { outDir: out, formats: ['hwpx'], confirmed: true };
  const preview = await call('preview_figures', { figures, style });
  const previewId = preview.content.at(-1).text.match(/previewId: ([a-f0-9]{16})/)?.[1];
  ok(previewId && preview.content.filter((item) => item.type === 'image').length === 1, 'MCP: 시안 1장과 재사용 ID');
  ok((await call('make_figures', { ...args, previewId, confirmed: false })).isError, 'MCP: 시안 ID도 교사 확인 필요');
  ok((await call('make_figures', { ...args, previewId: 'missing' })).isError, 'MCP: 없는 시안 ID 거절');
  const byId = await call('make_figures', { ...args, previewId, name: '시안ID' });
  const bySpec = await call('make_figures', { ...args, figures, style, name: '전체명세' });
  const section = (result) => {
    const [file] = JSON.parse(result.content[0].text).files;
    return strFromU8(unzipSync(fs.readFileSync(file))['Contents/section0.xml']);
  };
  ok(!byId.isError && !bySpec.isError && section(byId) === section(bySpec), 'MCP: 시안 ID와 전체 명세의 HWPX 내용 일치');
  ok(section(bySpec).includes('<hp:pagePr landscape="WIDELY"'), 'MCP: a single map fits on portrait A4');
  const wideFigure = {
    title: 'Map and bar chart', layout: 'row',
    parts: [{ map: { ...specs[1].map, width: 100, height: 78 } },
      { chart: { ...specs[3].chart, width: 110, height: 78 } }],
  };
  const wide = await call('make_figures', { ...args, figures: [wideFigure, wideFigure], name: 'landscape' });
  const wideSection = wide.isError ? '' : section(wide);
  ok(wideSection.includes('<hp:pagePr landscape="NARROWLY" width="59528" height="84186"'),
    'MCP: a side-by-side map and chart switch to landscape A4');
  ok((wideSection.match(/pageBreak="1"/g) || []).length === 1, 'MCP: landscape uses its shorter page height for pagination');
  const savedPath = JSON.parse(bySpec.content[0].text).specFile;
  const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
  saved.answerKey = '정답표\n별도 보관';
  fs.writeFileSync(savedPath, JSON.stringify(saved));
  const original = fs.readFileSync(savedPath, 'utf8');
  const edited = await call('preview_figures', { saved: { path: savedPath, labelStyle: 'circle', labels: { '경기 화성시': 'B' } } });
  const editedId = edited.content.at(-1).text.match(/previewId: ([a-f0-9]{16})/)?.[1];
  ok(editedId && !JSON.stringify(edited.content.filter((item) => item.type === 'text')).includes('별도 보관'), 'MCP: 저장한 설계도에서 기호만 수정하고 정답표는 반환하지 않음');
  const output = await call('make_figures', { ...args, previewId: editedId, name: '부분수정' });
  const newSpec = JSON.parse(fs.readFileSync(JSON.parse(output.content[0].text).specFile, 'utf8'));
  ok(newSpec.figures[0].map.labelStyle === 'circle' && newSpec.figures[0].map.labels['경기 화성시'] === 'B' &&
    !Object.hasOwn(newSpec, 'answerKey') && fs.readFileSync(savedPath, 'utf8') === original, 'MCP: 원본을 보존하고 부분 수정본에 정답표를 자동으로 넣지 않음');

} finally {
  await client.close();
  await server.close();
}

fs.rmSync(out, { recursive: true, force: true });
console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
