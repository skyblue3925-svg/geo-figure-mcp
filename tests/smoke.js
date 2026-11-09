// 자동 검사: 네트워크 없이 모든 그림 종류를 만들어 PPTX·HWPX·미리보기가 깨지지 않는지 본다.
// node tests/smoke.js   (깃허브에서 push·태그마다 실행)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { makeFigure, exportFigures } from '../src/build.js';
import { renderPng } from '../src/svg.js';
import { LANDFORM_PRESETS } from '../src/terrain.js';
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
const b = await findData({ source: 'bundle', bundle: { key: 'daytime-population', items: ['주간 인구 지수'] } });
ok(b.rows.length > 200, `내장 KOSIS 자료(${b.rows.length}행)`);

fs.rmSync(out, { recursive: true, force: true });
console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
