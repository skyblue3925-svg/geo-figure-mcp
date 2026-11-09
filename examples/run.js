// 시제품 예시 3개: 실제 통계로 만든다. node examples/run.js [출력 폴더]
import path from 'node:path';
import { findData, suggestRegions, assignLabels, round } from '../src/data.js';
import { makeFigure, exportFigures, loadStyle } from '../src/build.js';

const out = path.resolve(process.argv[2] || 'examples/out');
const st = loadStyle();
const MAP = '지도: 통계청 SGIS(vuski/admdongkor 가공)';

// ---- 1. 한국 시·도 + 우리나라 발전원별 발전량 비중 ----
{
  const cols = ['coal_share_elec', 'nuclear_share_elec', 'gas_share_elec', 'renewables_share_elec'];
  const d = await findData({ source: 'owid-energy', indicators: cols, regions: ['KOR'], years: true });
  const by = d.rows[0].byYear;
  const yrs = ['2000', '2010', Object.keys(by).filter((y) => cols.every((c) => by[y][c] != null)).sort().at(-1)];
  const names = ['석탄', '원자력', '천연가스', '신재생'];
  const series = cols.map((c, i) => ({ name: names[i], values: yrs.map((y) => round(by[y][c], 0)) }));
  series.push({ name: '기타', values: yrs.map((y, k) => round(100 - series.reduce((a, s) => a + s.values[k], 0), 0)) });
  const sidos = ['경북', '충남', '인천', '강원', '전남광주'];
  const labels = assignLabels(sidos, { order: 'random', seed: 11 });
  const fig = await makeFigure({
    title: '예시 1. 시·도 지도와 발전원별 발전량 비중',
    layout: 'row',
    parts: [
      { caption: '(가) 원자력 발전소가 있는 시·도', map: { region: 'korea', level: 'sido', detail: 'mid', width: 70, classes: { 부산: 1, 울산: 1, 경북: 1, 전남광주: 1 }, labels } },
      { caption: '(나) 우리나라 발전원별 발전량 비중', chart: { type: 'stacked', categories: yrs.map((y) => `${y}년`), series, unit: '(%)', valueLabels: 'all', width: 80, height: 60 } },
    ],
    notes: ['* 신재생은 수력 포함. 기타 = 100 − 나머지 합(석유 등).', '* 2026년 7월 행정 구역(전남광주통합특별시) 기준.'],
    source: `${MAP}; ${d.cite}`,
  }, st);
  const key = ['예시 1 정답표', ...Object.entries(labels).map(([n, l]) => `${l} = ${n}`), `(나) 자료 연도: ${yrs.join(', ')} (OWID energy-data, KOR)`].join('\n');
  console.log(exportFigures([fig], { outDir: out, name: '예시1_시도_발전', answerKey: key, style: st }));
}

// ---- 2. 서울 자치구 주간 인구 지수 ----
{
  const d = await findData({ source: 'seoul-daytime' });
  const cls = (v) => (v < 90 ? 0 : v < 110 ? 1 : v < 150 ? 2 : 3);
  const classes = Object.fromEntries(d.rows.map((r) => [`서울 ${r.name}`, cls(r.values.주간인구지수)]));
  const sg = suggestRegions(d.rows, ['상주인구', '주간인구지수'], 5);
  const labels = assignLabels(sg.picks, { order: 'random', seed: 5 });
  const pts = d.rows.filter((r) => labels[r.name]).map((r) => ({ label: labels[r.name], x: round(r.values.상주인구 / 10000, 1), y: r.values.주간인구지수 }));
  const fig = await makeFigure({
    title: '예시 2. 서울 자치구 주간 인구 지수',
    layout: 'row',
    parts: [
      { caption: '(가) 자치구별 주간 인구 지수', map: { region: 'korea', level: 'sigungu', within: ['서울'], detail: 'high', width: 78, classes, legend: ['90 미만', '90~110', '110~150', '150 이상'], labels: Object.fromEntries(Object.entries(labels).map(([n, l]) => [`서울 ${n}`, l])) } },
      { caption: '(나) A~E 구의 상주인구와 주간 인구 지수', chart: { type: 'scatter', points: pts, xLabel: '상주인구(만 명)', yLabel: '(지수)', width: 72, height: 58 } },
    ],
    notes: ['* 주간 인구 지수 = (주간 인구 ÷ 상주인구) × 100'],
    source: `${MAP}; ${d.cite}`,
  }, st);
  const key = ['예시 2 정답표', ...Object.entries(labels).map(([n, l]) => `${l} = ${n}`), `지역 추천: 판별 거리 최솟값 ${sg.minGap} (0.15 이상이면 판별 쉬움)`].join('\n');
  console.log(exportFigures([fig], { outDir: out, name: '예시2_서울_주간인구', answerKey: key, style: st }));
}

// ---- 3. 세계 기후 4지점 ----
{
  const d = await findData({ source: 'climate', regions: ['샌프란시스코', '이르쿠츠크', '리마', '싱가포르'] });
  const mapL = assignLabels(d.rows.map((r) => r.name), { order: 'west-east', coords: Object.fromEntries(d.rows.map((r) => [r.name, [r.lon, r.lat]])) });
  const grL = assignLabels(d.rows.map((r) => r.name), { order: 'random', style: 'ga', seed: 3 });
  const stations = Object.entries(grL).sort((a, b) => a[1].localeCompare(b[1])).map(([n, l]) => { const r = d.rows.find((x) => x.name === n); return { label: l, temp: r.values.temp, precip: r.values.precip }; });
  const fig = await makeFigure({
    title: '예시 3. 세계 기후 지점과 기후 그래프',
    layout: 'column',
    parts: [
      { map: { region: 'world', bbox: [-180, -50, 180, 75], graticule: 30, width: 82, height: 60, points: d.rows.map((r) => ({ lon: r.lon, lat: r.lat, label: mapL[r.name] })) } },
      { chart: { type: 'climate', stations, width: 82, tRange: [0, 35], pRange: [0, 300] } },
    ],
    source: `지도: Natural Earth; ${d.citeAll}`,
  }, st);
  const key = ['예시 3 정답표', ...d.rows.map((r) => `${mapL[r.name]} = ${grL[r.name]} = ${r.name} — ${r.station} 관측소(${r.distanceKm}km)${r.exam ? `, 평가원 기출 ${r.exam.code}` : ''}`)].join('\n');
  console.log(exportFigures([fig], { outDir: out, name: '예시3_세계_기후', answerKey: key, style: st }));
}

// ---- 4. 실제 표고: 울릉도 등고선 지형도 + 단면 ----
{
  const line = [[37.545, 130.80], [37.47, 130.92]];
  const fig = await makeFigure({
    title: '예시 4. 등고선 지형도와 지형 단면 (울릉도)',
    layout: 'row',
    parts: [
      { caption: '(가) 등고선 지형도', map: { type: 'contour', bbox: [130.78, 37.44, 130.94, 37.56], interval: 100, index: 5, width: 78, line, lineLabels: ['가', '나'], resolution: 80 } },
      { caption: '(나) 가-나 단면', chart: { type: 'profile', from: line[0], to: line[1], width: 80, height: 40, vex: 3 } },
    ],
  }, st);
  console.log(exportFigures([fig], { outDir: out, name: '예시4_울릉도_지형', answerKey: '예시 4 정답표\n가-나 단면: 북서 → 남동 (위도·경도 37.545,130.80 → 37.47,130.92)', style: st }));
}

// ---- 5. 지형 모식도 틀 ----
{
  const a = await makeFigure({ title: '예시 5-1. 해안 지형 모식도', chart: { type: 'landform', preset: 'coast-deposition', labels: { 사빈: 'A', 해안사구: 'B', 석호: 'C', 사주: 'D' } } }, st);
  const b = await makeFigure({ title: '예시 5-2. 카르스트 지형 모식도', chart: { type: 'landform', preset: 'karst', labels: { 돌리네: 'A', 우발라: 'B', 석회동굴: 'C' } } }, st);
  const c = await makeFigure({ title: '예시 5-3. 식생의 수직 분포', chart: { type: 'landform', preset: 'vegetation-vertical', labels: { 고산식물대: 'A', 아고산대: 'B', 산지대: 'C', 구릉대: 'D' } } }, st);
  console.log(exportFigures([a, b, c], { outDir: out, name: '예시5_지형_모식도', answerKey: '예시 5 정답표\n5-1 A 사빈, B 해안사구, C 석호, D 사주\n5-2 A 돌리네, B 우발라, C 석회동굴\n5-3 A 고산식물대, B 아고산대, C 산지대, D 구릉대', style: st }));
}
