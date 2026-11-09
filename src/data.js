// 실제 통계 찾기 + 출제용 가공. 숫자를 지어내지 않는다 — 못 찾으면 오류로 알린다.
import fs from 'node:fs';

const DATA = new URL('../data/', import.meta.url);
const load = (f) => JSON.parse(fs.readFileSync(new URL(f, DATA), 'utf8'));
const UA = { 'User-Agent': 'geo-figure-mcp/0.1 (teacher exam figure tool)' };

export const SOURCES = {
  worldbank: { name: '세계은행 WDI', cite: 'World Bank', license: 'CC BY 4.0', key: false, note: '지표 코드 예: SP.POP.TOTL(총인구), SP.URB.TOTL.IN.ZS(도시화율), SP.DYN.TFRT.IN(합계 출산율), SP.POP.65UP.TO.ZS(65세 이상 비율), NY.GDP.PCAP.CD(1인당 GDP)' },
  'owid-energy': { name: 'Our World in Data 에너지', cite: 'Our World in Data(Energy Institute 등)', license: 'CC BY 4.0', key: false, note: '열 예: coal_share_elec, nuclear_share_elec, gas_share_elec, solar_share_elec, energy_per_capita' },
  'owid-co2': { name: 'Our World in Data CO2', cite: 'Our World in Data(Global Carbon Project)', license: 'CC BY 4.0', key: false, note: '열 예: co2, co2_per_capita, cumulative_co2' },
  climate: { name: 'WMO 기후평년값 1991~2020 (내장, 관측소 4,655곳)', cite: 'WMO 기후평년값(1991~2020)', license: '이용 제한 없음(출처 표시, NCEI doi:10.25921/800j-vn07)', key: false, note: '지점: 평가원 기출 기후 지점 한글 이름(66곳, list_exam_climate_spots) · 관측소 영문 이름 · "위도,경도". 가장 가까운 관측소 값을 쓰고 거리를 알려 준다.' },
  'seoul-daytime': { name: '서울 자치구 주간 인구 2020 (내장)', cite: '통계청, 「2020 인구주택총조사」', license: '공공누리 제1유형', key: false, note: '열: 상주인구, 유입인구, 유출인구, 주간인구, 주간인구지수' },
  bundle: { name: '내장 KOSIS 통계 묶음(인증키 불필요)', cite: '국가데이터처 등(KOSIS)', license: '공공누리 제1유형', key: false, note: 'list_bundled_data 로 목록을 보고 find_data(source:"bundle", bundle:{ key, items, period, where }) 로 꺼낸다. 인구 구조·피라미드·주간 인구·외국인 주민·출산율·인구 이동·도시화·GRDP·제조업·사업체·에너지·신재생·농가·작물 재배 면적.' },
  kosis: { name: 'KOSIS 국가통계포털 (시·도·시·군·구 통계)', cite: '통계청 KOSIS', license: '공공누리 제1유형', key: true, note: 'kosis_search 로 통계표(orgId·tblId)를 찾고 kosis_items 로 항목·분류를 본 뒤 find_data(source:"kosis", kosis:{orgId,tblId,itmId,objL1,…,prdSe,year}) 로 받는다. 인증키: 환경 변수 KOSIS_API_KEY 또는 set_kosis_key.' },
};

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`자료를 받지 못함 ${r.status}: ${url}`);
  return r.json();
}
function csvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
const owidCache = {};
const koName = new Intl.DisplayNames(['ko'], { type: 'region' });

// 결과 모양: { title, unit, cite, year, rows:[{ id, name, values:{ 열: 값 }, year }] }
export async function findData({ source, indicators = [], regions = [], year, years }) {
  if (source === 'worldbank') {
    const meta = (await getJson('https://api.worldbank.org/v2/country?format=json&per_page=400'))[1];
    const iso2 = Object.fromEntries(meta.map((c) => [c.id, c.iso2Code]));
    const rows = {};
    const range = years || (year ? `${year}` : '2000:2025');
    for (const ind of indicators) {
      const j = await getJson(`https://api.worldbank.org/v2/country/${regions.join(';')}/indicator/${ind}?format=json&date=${range}&per_page=20000`);
      if (!Array.isArray(j) || !j[1]) throw new Error(`세계은행에 없는 지표이거나 값이 없음: ${ind}`);
      for (const r of j[1]) {
        if (r.value == null) continue;
        const id = r.countryiso3code || r.country.id;
        const row = (rows[id] ||= { id, name: safeKo(iso2[id], r.country.value), byYear: {} });
        (row.byYear[r.date] ||= {})[ind] = r.value;
      }
    }
    return pack(rows, indicators, year, '세계은행', SOURCES.worldbank.cite);
  }
  if (source === 'owid-energy' || source === 'owid-co2') {
    const url = source === 'owid-energy' ? 'https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv' : 'https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv';
    const text = owidCache[url] ||= await (await fetch(url, { headers: UA })).text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const head = csvLine(lines[0]);
    const ix = (c) => { const i = head.indexOf(c); if (i < 0) throw new Error(`OWID 자료에 '${c}' 열이 없음`); return i; };
    const iI = ix('iso_code'), iY = ix('year'), iC = ix('country');
    const cols = indicators.map(ix);
    const want = new Set(regions.map((r) => (r === 'WLD' ? 'OWID_WRL' : r)));
    const rows = {};
    for (const l of lines.slice(1)) {
      const r = csvLine(l);
      const iso = r[iI] || (r[iC] === 'World' ? 'OWID_WRL' : '');
      if (!want.has(iso)) continue;
      const id = iso === 'OWID_WRL' ? 'WLD' : iso;
      const row = (rows[id] ||= { id, name: id === 'WLD' ? '세계' : r[iC], byYear: {} });
      indicators.forEach((c, k) => { if (r[cols[k]] !== '') (row.byYear[r[iY]] ||= {})[c] = +r[cols[k]]; });
    }
    return pack(rows, indicators, year, source, SOURCES[source].cite, years);
  }
  if (source === 'climate') {
    // 지점 이름(평가원 기출 지점 한글 이름) · 관측소 영문 이름 · "위도,경도" → 가장 가까운 WMO 관측소의 1991~2020 평년값
    if (!regions.length) throw new Error('지점을 주세요. 예: ["샌프란시스코","이르쿠츠크"] 또는 ["37.57,126.98"]. 기출 지점 목록은 list_exam_climate_spots');
    return { title: 'WMO 기후평년값 1991~2020', unit: '℃, mm', cite: SOURCES.climate.cite, year: '1991~2020', rows: regions.map(climateRow), get citeAll() { return [...new Set(this.rows.map((r) => r.cite || SOURCES.climate.cite))].join('; '); } };
  }
  if (source === 'seoul-daytime') {
    const d = load('seoul-daytime-2020.json');
    const pick = regions.length ? regions : Object.keys(d.rows).filter((k) => k !== '서울특별시');
    return { title: '서울 자치구 상주·주간 인구', unit: '명, 지수', cite: SOURCES['seoul-daytime'].cite, year: '2020', rows: pick.map((n) => {
      const v = d.rows[n];
      if (!v) throw new Error(`없는 자치구: ${n}`);
      return { id: n, name: n, values: Object.fromEntries(d.columns.map((c, i) => [c, v[i]])) };
    }) };
  }
  if (source === 'kosis') return kosisData(arguments[0].kosis || {});
  if (source === 'bundle') return bundleData(arguments[0].bundle || {});
  throw new Error(`모르는 자료원: ${source}. 쓸 수 있는 것: ${Object.keys(SOURCES).join(', ')}`);
}
function safeKo(iso2, fb) { try { const n = iso2 && /^[A-Z]{2}$/.test(iso2) ? koName.of(iso2) : null; return n && n !== iso2 ? n : fb; } catch { return fb; } }
function dms(s) {
  const p = String(s).split(/[| ]/).filter(Boolean);
  let v = +p[0] + (+p[1] || 0) / 60 + (+p[2] && p.length > 3 ? +p[2] / 3600 : 0);
  if (/[SW]/.test(p.at(-1))) v = -v;
  return +v.toFixed(3);
}
// year 를 주면 그해 값, 없으면 지표가 모두 있는 가장 최근 해
function pack(rows, indicators, year, title, cite, years) {
  const out = [];
  for (const r of Object.values(rows)) {
    if (years) { out.push({ id: r.id, name: r.name, byYear: r.byYear }); continue; }
    const ys = Object.keys(r.byYear).filter((y) => indicators.every((i) => r.byYear[y][i] != null)).sort();
    const y = year ? String(year) : ys.at(-1);
    if (!y || !r.byYear[y]) continue;
    out.push({ id: r.id, name: r.name, year: y, values: r.byYear[y] });
  }
  const yrs = [...new Set(out.map((r) => r.year).filter(Boolean))];
  return { title, unit: '[지표마다 다름]', cite, year: yrs.length === 1 ? yrs[0] : yrs.join('·'), rows: out };
}

// ---- 출제용 가공 ----
// mode: 'max100'(최댓값=100) | 'share'(합에 대한 %) | 'deviation'(기준값과의 차이) | 'national'(기준 대비 %)
export function transform(values, mode, base) {
  const v = values.map(Number);
  if (mode === 'max100') { const m = Math.max(...v); return v.map((x) => (x / m) * 100); }
  if (mode === 'share') { const s = v.reduce((a, b) => a + b, 0); return v.map((x) => (x / s) * 100); }
  if (mode === 'deviation') return v.map((x) => x - base);
  if (mode === 'national') return v.map((x) => (x / base) * 100);
  return v;
}
export const round = (v, d = 1) => +(+v).toFixed(d);

// 기호 붙이기: order 'random' | 'north-south' | 'west-east' | 'given'
export function assignLabels(names, { order = 'random', style = 'AE', coords = {}, seed = 7 } = {}) {
  const L = style === 'ga' ? ['(가)', '(나)', '(다)', '(라)', '(마)', '(바)'] : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  let list = [...names];
  if (order === 'north-south') list.sort((a, b) => (coords[b]?.[1] ?? 0) - (coords[a]?.[1] ?? 0));
  else if (order === 'west-east') list.sort((a, b) => (coords[a]?.[0] ?? 0) - (coords[b]?.[0] ?? 0));
  else if (order === 'random') { let s = seed; list = list.map((n) => [n, (s = (s * 9301 + 49297) % 233280) / 233280]).sort((a, b) => a[1] - b[1]).map((x) => x[0]); }
  return Object.fromEntries(list.map((n, i) => [n, L[i]]));
}

// 판별이 잘 되는 지역 고르기: 지표들을 0~1 로 맞춘 뒤, 서로 가장 멀리 떨어진 k 곳(최소 거리 최대화)
export function suggestRegions(rows, indicators, k = 5) {
  const vals = rows.map((r) => indicators.map((i) => +r.values[i]));
  const mins = indicators.map((_, j) => Math.min(...vals.map((v) => v[j]))), maxs = indicators.map((_, j) => Math.max(...vals.map((v) => v[j])));
  const nv = vals.map((v) => v.map((x, j) => (x - mins[j]) / (maxs[j] - mins[j] || 1)));
  const d = (a, b) => Math.hypot(...nv[a].map((x, j) => x - nv[b][j]));
  // 시작: 첫 지표 최대인 곳
  const chosen = [nv.reduce((m, v, i) => (v[0] > nv[m][0] ? i : m), 0)];
  while (chosen.length < Math.min(k, rows.length)) {
    let best = -1, bd = -1;
    nv.forEach((_, i) => { if (chosen.includes(i)) return; const md = Math.min(...chosen.map((c) => d(i, c))); if (md > bd) { bd = md; best = i; } });
    chosen.push(best);
  }
  const minGap = Math.min(...chosen.flatMap((a, x) => chosen.slice(x + 1).map((b) => d(a, b))));
  return { picks: chosen.map((i) => rows[i].name), minGap: +minGap.toFixed(2), note: '0~1로 맞춘 지표 공간에서 서로 가장 멀리 떨어진 곳을 골랐다. minGap 이 0.15보다 작으면 판별이 어렵다.' };
}

// ---- 기후 관측소 찾기 ----
let WMO, SPOTS;
const wmo = () => (WMO ||= load('wmo-normals-1991-2020.json'));
export const examSpots = () => (SPOTS ||= load('exam-climate-spots.json')).spots;
const hav = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
export function nearestStations(lat, lon, n = 3) {
  return wmo().stations.map((s) => ({ s, d: hav(lat, lon, s[3], s[4]) })).sort((a, b) => a.d - b.d).slice(0, n);
}
function climateRow(q) {
  const W = wmo();
  const spot = examSpots().find((x) => x.name === q);
  let lat, lon, label = q, exam = null;
  if (spot) {
    if (spot.lat == null) throw new Error(`'${q}'는 특정 지점이 아니라 좌표가 없습니다. 쓸 관측소 이름이나 "위도,경도"를 주세요.`);
    ({ lat, lon } = spot); exam = { code: spot.code, exams: spot.exams };
    if (spot.climate) {
      // WMO 관측소가 먼 기출 지점: 미리 계산해 둔 값(GHCN-Daily 관측소 또는 Beck 0.1° 격자)
      const c = spot.climate;
      const isGrid = c.source === 'Beck-0.1';
      const warn = isGrid ? '관측소 자료가 부족해 0.1°(약 11km) 격자 추정값(Beck 외 2023, CC BY 4.0)을 씀 — 관측값이 아님' : c.tier === 2 ? `기록이 짧은 관측소(${c.years}년, ${c.distanceKm}km) — 값이 불안정할 수 있음 [확인 필요]` : c.distanceKm > 50 ? `관측소가 ${c.distanceKm}km 떨어짐 [확인 필요]` : null;
      return { id: q, name: q, station: c.station, country: '', distanceKm: c.distanceKm, lat, lon, height: c.elev, exam, warn, cite: isGrid ? 'Beck et al.(2023) 0.1° 기후 자료(1991~2020)' : `NOAA GHCN-Daily ${c.station}(1991~2020 중 ${c.years}년)`, values: { temp: c.temp, precip: c.precip } };
    }
  } else if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q)) {
    [lat, lon] = q.split(',').map(Number);
  } else {
    const st = W.stations.find((s) => s[1].toLowerCase() === q.toLowerCase().replace(/\s+/g, ''));
    if (!st) {
      const near = W.stations.filter((s) => s[1].toLowerCase().includes(q.toLowerCase().slice(0, 4))).slice(0, 8).map((s) => `${s[1]}(${s[2].trim()})`);
      throw new Error(`'${q}' 지점을 찾지 못함. 평가원 기출 지점 한글 이름, 관측소 영문 이름, 또는 "위도,경도"를 주세요.${near.length ? ' 비슷한 관측소: ' + near.join(', ') : ''}`);
    }
    [lat, lon] = [st[3], st[4]];
  }
  const [{ s, d }] = nearestStations(lat, lon, 1);
  const warn = d > 50 ? `가장 가까운 관측소가 ${Math.round(d)}km 떨어져 있음 — 값이 실제 지점과 다를 수 있음 [확인 필요]` : null;
  return { id: label, name: label, station: s[1], country: s[2].trim(), distanceKm: Math.round(d), lat: s[3], lon: s[4], height: s[5], exam, warn, values: { temp: s[6], precip: s[7] } };
}

// ---- KOSIS 공유서비스(OpenAPI) ----
import os from 'node:os';
import path from 'node:path';
const KEY_FILE = path.join(os.homedir(), '.geo-figure-mcp', 'kosis-key.txt');
export function setKosisKey(k) { fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true }); fs.writeFileSync(KEY_FILE, k.trim()); return '저장했습니다(이 컴퓨터의 사용자 폴더에만 보관).'; }
// 원격 서버: 요청마다 사용자 키를 받아 그 요청 안에서만 쓴다(저장하지 않음)
import { AsyncLocalStorage } from 'node:async_hooks';
const keyStore = new AsyncLocalStorage();
export const withKosisKey = (key, fn) => { if (!key) throw new Error('KOSIS 인증키(kosisKey)가 필요합니다. 먼저 list_bundled_data 의 내장 자료로 되는지 보세요. 키는 kosis.kr/openapi 에서 무료 발급.'); return keyStore.run(key, fn); };
function kosisKey() {
  const k = keyStore.getStore() || process.env.KOSIS_API_KEY || (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '');
  if (!k) throw new Error('KOSIS 인증키가 없습니다. kosis.kr/openapi 에서 무료로 발급받아 set_kosis_key 로 저장하거나 환경 변수 KOSIS_API_KEY 에 넣어 주세요.');
  return k;
}
async function kosisGet(url) {
  const r = await fetch(url, { headers: UA });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(`KOSIS 응답을 읽지 못함: ${t.slice(0, 200)}`); }
  if (j && !Array.isArray(j) && (j.err || j.errMsg)) throw new Error(`KOSIS 오류 ${j.err || ''}: ${j.errMsg || ''}`);
  return j;
}
export async function kosisSearch(q, n = 15) {
  const j = await kosisGet(`https://kosis.kr/openapi/statisticsSearch.do?method=getList&apiKey=${encodeURIComponent(kosisKey())}&searchNm=${encodeURIComponent(q)}&format=json&jsonVD=Y&resultCount=${n}`);
  return (j || []).map((x) => ({ orgId: x.ORG_ID, tblId: x.TBL_ID, title: x.TBL_NM, org: x.ORG_NM, period: `${x.STRT_PRD_DE || ''}~${x.END_PRD_DE || ''}`, url: x.LINK_URL }));
}
export async function kosisItems({ orgId, tblId }) {
  const k = encodeURIComponent(kosisKey());
  const itm = await kosisGet(`https://kosis.kr/openapi/statisticsData.do?method=getMeta&type=ITM&apiKey=${k}&orgId=${orgId}&tblId=${tblId}&format=json&jsonVD=Y`);
  const prd = await kosisGet(`https://kosis.kr/openapi/statisticsData.do?method=getMeta&type=PRD&apiKey=${k}&orgId=${orgId}&tblId=${tblId}&format=json&jsonVD=Y`).catch(() => []);
  const items = [], cls = {};
  for (const x of itm || []) {
    if (x.OBJ_ID === 'ITEM' || x.OBJ_ID_SN === undefined && x.ITM_ID?.startsWith('T')) items.push({ itmId: x.ITM_ID, name: x.ITM_NM, unit: x.UNIT_NM });
    else (cls[`objL${x.OBJ_ID_SN || '?'} (${x.OBJ_NM})`] ||= []).push({ id: x.ITM_ID, name: x.ITM_NM });
  }
  for (const k2 of Object.keys(cls)) if (cls[k2].length > 40) cls[k2] = [...cls[k2].slice(0, 40), { id: '…', name: `외 ${cls[k2].length - 40}개 (ALL 로 모두 받기)` }];
  return { items, classifications: cls, periods: (prd || []).map((p) => ({ cycle: p.PRD_SE, prdSe: PRD_CODE[p.PRD_SE] || p.PRD_SE, from: p.STRT_PRD_DE, to: p.END_PRD_DE })) };
}
// 수록 주기 한글 → API 코드
const PRD_CODE = { 년: 'Y', 반기: 'H', 분기: 'Q', 월: 'M', 일: 'D', 부정기: 'IR', '2년': 'F', '3년': 'F', '4년': 'F', '5년': 'F', '10년': 'F' };
// kosis: { orgId, tblId, itmId:'T1' 또는 'T1+T2', objL1:'ALL', objL2, …, prdSe:'Y', year:2020 (또는 start,end) }
async function kosisData(q) {
  if (!q.orgId || !q.tblId || !q.itmId) throw new Error('kosis 에 orgId·tblId·itmId 가 필요합니다 (kosis_search → kosis_items 로 확인).');
  let prdSe = q.prdSe;
  if (!prdSe) { // 수록 주기를 통계표 정보에서 알아낸다(인구주택총조사는 5년 = F)
    const meta = await kosisGet(`https://kosis.kr/openapi/statisticsData.do?method=getMeta&type=PRD&apiKey=${encodeURIComponent(kosisKey())}&orgId=${q.orgId}&tblId=${q.tblId}&format=json&jsonVD=Y`).catch(() => []);
    prdSe = PRD_CODE[meta?.[0]?.PRD_SE] || 'Y';
  }
  const p = new URLSearchParams({ method: 'getList', apiKey: kosisKey(), orgId: q.orgId, tblId: q.tblId, itmId: q.itmId, format: 'json', jsonVD: 'Y', prdSe });
  for (let i = 1; i <= 8; i++) p.set(`objL${i}`, q[`objL${i}`] ?? (i === 1 ? 'ALL' : ''));
  if (q.year) { p.set('startPrdDe', String(q.year)); p.set('endPrdDe', String(q.year)); } else if (q.start) { p.set('startPrdDe', String(q.start)); p.set('endPrdDe', String(q.end || q.start)); } else p.set('newEstPrdCnt', '1');
  const j = await kosisGet(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${p}`);
  const rows = {};
  let title = '', unit = '';
  const list = j || [];
  // 하나로 고정한 분류(성별 '계' 등)는 이름에서 뺀다. 행정구역 코드로 겹치는 이름(중구 등)에 시·도를 붙인다
  const varies = (k) => new Set(list.map((x) => x[k])).size > 1;
  const sidoName = {};
  for (const x of list) if (/^\d{2}$/.test(x.C1 || '')) sidoName[x.C1] = x.C1_NM;
  const dupNames = new Set(); const seen = {};
  for (const x of list) { if (seen[x.C1_NM] && seen[x.C1_NM] !== x.C1) dupNames.add(x.C1_NM); seen[x.C1_NM] = x.C1; }
  for (const x of list) {
    title = x.TBL_NM; unit = x.UNIT_NM;
    let n1 = x.C1_NM;
    if (/^\d{5}$/.test(x.C1 || '') && dupNames.has(n1) && sidoName[x.C1.slice(0, 2)]) n1 = `${sidoName[x.C1.slice(0, 2)]} ${n1}`;
    const name = [n1, varies('C2') ? x.C2_NM : '', varies('C3') ? x.C3_NM : ''].filter(Boolean).join(' ');
    const r = (rows[name] ||= { id: [x.C1, x.C2, x.C3].filter(Boolean).join('_'), code: x.C1, name, values: {}, year: x.PRD_DE });
    r.values[x.ITM_NM] = x.DT === '-' || x.DT === '' ? null : +x.DT;
    r.year = x.PRD_DE;
  }
  const yrs = [...new Set(Object.values(rows).map((r) => r.year))];
  return { title, unit, cite: `${q.orgId === "101" ? "국가데이터처(통계청)" : "KOSIS"}, 「${title}」`, year: yrs.join('·'), rows: Object.values(rows) };
}

// ---- 내장 KOSIS 통계 묶음(data/kosis): 인증키 없이 쓴다 ----
export function bundleList() {
  try { return JSON.parse(fs.readFileSync(new URL('kosis/index.json', DATA), 'utf8')); } catch { return []; }
}
const DEFAULT_PICK = ['계', '합계', '총인구', '전체', '소계', '총계', '전국'];
// q: { key, items:[항목 이름], period, where:{ C1:'총인구' }, regionDim:'C2' }
export function bundleData(q) {
  let o;
  try { o = JSON.parse(fs.readFileSync(new URL(`kosis/${q.key}.json`, DATA), 'utf8')); } catch { throw new Error(`내장 통계에 없는 이름: ${q.key}. list_bundled_data 로 목록을 보세요.`); }
  const period = String(q.period || o.periods.at(-1));
  if (!o.periods.includes(period)) throw new Error(`${q.key} 에 ${period} 자료가 없음. 있는 기간: ${o.periods.join(', ')}`);
  const dims = Object.keys(o.dims);
  const regionDim = q.regionDim || dims.find((d) => /행정|시도|시군구|지역|전출지|구역/.test(o.dims[d])) || dims[0];
  const ri = dims.indexOf(regionDim);
  const SIDO_SHORT = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주', '전국'];
  const clean = (n) => { const t = String(n).replace(/\s+/g, ''); return t.length <= 4 && (SIDO_SHORT.includes(t) || /^(전국)$/.test(t)) ? t : String(n).trim(); };
  let rows = o.rows.filter((r) => r[0] === period && (!q.items?.length || q.items.includes(r[3]))).map((r) => [r[0], r[1], r[2].map((v, i) => (i === Object.keys(o.dims).indexOf(q.regionDim || Object.keys(o.dims).find((d) => /행정|시도|시군구|지역|전출지|구역/.test(o.dims[d])) || 'C1') ? clean(v) : v)), r[3], r[4]]);
  const fixed = {};
  for (const [di, d] of dims.entries()) {
    if (di === ri) continue;
    const vals = [...new Set(rows.map((r) => r[2][di]))];
    const want = q.where?.[d] ?? (vals.length > 1 ? vals.find((v) => DEFAULT_PICK.includes(String(v).trim())) : vals[0]);
    if (want != null) { rows = rows.filter((r) => r[2][di] === want); fixed[o.dims[d]] = want; }
  }
  // 이름이 겹치는 시군구(중구 등)에 시·도 이름을 붙인다
  const nc = (c) => { const m = String(c || '').match(/[A-Z]+(\d+)$/); return m ? m[1] : String(c || ''); };
  const sidoRe = /(특별시|광역시|특별자치시|특별자치도|통합특별시|[^시군구]도|^서울|^부산|^대구|^인천|^광주|^대전|^울산|^세종|^경기|^강원|^충북|^충남|^전북|^전남|^경북|^경남|^제주)$/;
  const sido = {};
  for (const r of o.rows) if (/^\d{2}$/.test(nc(r[1][ri]))) sido[nc(r[1][ri])] = r[2][ri];
  // 순번 코드 표: 바로 앞 시·도 행을 소속으로
  const parent = new Map(); let curS = null;
  for (const r of rows) { const n = r[2][ri]; if (sidoRe.test(String(n).trim())) curS = n; else parent.set(r[1][ri], curS); }
  const byName = {};
  for (const r of rows) { const n = r[2][ri]; (byName[n] ||= new Set()).add(r[1][ri]); }
  const out = {};
  for (const r of rows) {
    const code = r[1][ri];
    let name = r[2][ri];
    const ps = sido[nc(code).slice(0, 2)] || parent.get(code);
    if (byName[name].size > 1 && ps && ps !== name) name = `${ps} ${name}`;
    // 고정하지 않은 분류(예: 인구현황별)는 값 이름으로 펼친다 → 한 지역 = 한 행
    const other = dims.map((d, di) => (di !== ri && !(o.dims[d] in fixed) ? r[2][di] : null)).filter(Boolean).join(' · ');
    (out[name] ||= { id: code, code, name, values: {} }).values[other ? `${other} · ${r[3]}` : r[3]] = r[4];
  }
  // 지도 이름(mapName) 붙이기: 자료 연도에 맞는 지도 판(2026년 7월 이전 자료 → 2025년 판)과 같은 형식('경기 화성시').
  // 일반구(수원시 장안구 등)·지도에 없는 곳은 null. 행안부식 코드(11101HJG11010)는 앞부분을 떼고 맞춘다.
  const res = Object.values(out);
  const mapEdition = q.mapEdition || (+String(period).slice(0, 4) >= 2026 && String(period) >= '202607' ? '2026' : +String(period).slice(0, 4) >= 2027 ? '2026' : '2025');
  const norm = nc;
  const sidoN = {};
  for (const r of o.rows) { const c = norm(r[1][ri]); if (/^\d{2}$/.test(c)) sidoN[c] = r[2][ri]; }
  try {
    const mapList = [...listRegions({ level: 'sido', edition: mapEdition }), ...listRegions({ level: 'sigungu', edition: mapEdition })];
    const mapNames = new Set(mapList);
    const SH = [['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'], ['대전', '대전'], ['울산', '울산'], ['세종', '세종'], ['경기', '경기'], ['강원', '강원'], ['충청북', '충북'], ['충북', '충북'], ['충청남', '충남'], ['충남', '충남'], ['전북', '전북'], ['전라북', '전북'], ['전남광주', '전남광주'], ['전라남', '전남'], ['전남', '전남'], ['경상북', '경북'], ['경북', '경북'], ['경상남', '경남'], ['경남', '경남'], ['제주', '제주']];
    const shortOf = (nm) => (SH.find(([k]) => String(nm).startsWith(k)) || [])[1] || null;
    const fix26 = (sn) => (mapEdition === '2026' && (sn === '전남' || sn === '광주') ? '전남광주' : sn);
    const isSido = (nm) => /(특별시|광역시|특별자치시|특별자치도|통합특별시|[^시군구]도)$/.test(String(nm).trim()) || SIDO_SHORT.includes(String(nm).trim());
    let cur = null; // 코드가 행정 코드가 아닌 표(순번 코드)는 바로 앞 시·도 행으로 소속을 판단한다
    for (const r of res) {
      const code = norm(r.code), base = String(r.name).replace(/^\S+(특별시|광역시|특별자치시|도|특별자치도|통합특별시) /, '');
      if (/^\d{2}$/.test(code) || isSido(r.name)) { cur = r.name; const sn = fix26(shortOf(r.name)); r.mapName = mapNames.has(sn) ? sn : null; continue; }
      const sn = fix26(shortOf(sidoN[code.slice(0, 2)] || cur || ''));
      let m = sn && mapNames.has(`${sn} ${base}`) ? `${sn} ${base}` : null;
      if (!m) { const same = mapList.filter((x) => x.endsWith(` ${base}`)); if (same.length === 1) m = same[0]; } // 소속이 바뀐 곳(군위군 등)
      r.mapName = m;
    }
  } catch {}
  return { title: o.title, unit: o.units, cite: o.cite, year: period, fixed, rows: res, mapEdition, note: `내장 KOSIS 자료(받은 날 ${o.retrieved}). 고정한 분류: ${JSON.stringify(fixed)}. 지도에는 mapName 과 map.edition='${mapEdition}' 을 쓴다(일반구는 null — 시 합계 행을 쓴다)` };
}

// 지도 지역 이름(시·도 짧은 이름, '시도 시군구') — 내장 자료와 이름 맞추기용
import { listRegions } from './maps.js';
