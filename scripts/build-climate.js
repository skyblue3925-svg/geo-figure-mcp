// WMO 1991~2020 기후평년값(NOAA NCEI 배포, 퍼블릭 도메인) 합본 → data/wmo-normals-1991-2020.json
// + 평가원 기출 기후 지점 목록(교사의 geo-lab/koppen-climate 프로젝트) → data/exam-climate-spots.json
// node scripts/build-climate.js <TAVG.csv> <PRCP.csv> <geo-lab exam-climate-spots.json> <exam-climate-spot-coordinates.mjs>
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [tavg, prcp, spotsJson, coordMjs] = process.argv.slice(2);
let dup = 0;
const parse = (f) => {
  const rows = fs.readFileSync(f, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(',').map((s) => s.trim()));
  const m = new Map();
  for (const r of rows) {
    const vals = r.slice(9, 21).map(Number);
    if (vals.some((v) => !Number.isFinite(v) || v <= -99)) continue; // -99.9 = 결측
    const key = `${r[1]}|${r[2]}|${r[4]}|${r[5]}`;
    if (m.has(key)) { dup++; continue; }
    m.set(key, { id: r[2], lat: +r[4], lon: +r[5], elev: +r[6], country: r[7], name: r[8], vals });
  }
  return m;
};
const T = parse(tavg), P = parse(prcp);
const st = [];
let mism = 0;
for (const [id, t] of T) { const p = P.get(id); if (!p) continue; if (Math.abs(p.lat - t.lat) > 0.01 || Math.abs(p.lon - t.lon) > 0.01) { mism++; continue; } st.push([t.id, t.name, t.country, t.lat, t.lon, t.elev, t.vals, p.vals]); }
fs.writeFileSync('data/wmo-normals-1991-2020.json', JSON.stringify({
  title: 'WMO 기후평년값 1991~2020 (월평균 기온 ℃, 월 강수량 mm)',
  source: 'World Meteorological Organization Climate Normals 1991-2020, NOAA NCEI 배포본 (accession 0253808) 합본 TAVG·PRCP',
  sourceUrl: 'https://www.nodc.noaa.gov/archive/arc0216/0253808/1.1/data/0-data/data-composite-primary-parameters/',
  license: '미국 정부 공개 자료(퍼블릭 도메인)·WMO 공개 자료. 화면에 출처를 표시한다.',
  retrieved: new Date().toISOString().slice(0, 10),
  columns: ['id', 'name', 'country', 'lat', 'lon', 'elev', 'temp', 'precip'],
  stations: st,
}));
console.log('관측소', st.length, '같은 WIGOS 중복', dup, '좌표 불일치 제외', mism);
const spots = JSON.parse(fs.readFileSync(spotsJson, 'utf8').replace(/^﻿/, '')).records;
const C = { ...(await import(pathToFileURL(coordMjs).href)).EXAM_CLIMATE_COORDINATES };
// 이름 표기가 다른 것·좌표가 빠진 것 보충(도시 중심 좌표). 티베트고원은 특정 지점이 아니라 비워 둔다.
C['브뤼셀'] ||= C['브리쉘'];
C['밴쿠버'] ||= { latitude: 49.2827, longitude: -123.1207, confidence: 'high', note: '도시 중심 좌표로 보충' };
const out = spots.map((s) => ({ name: s.displayName, code: s.examCode, exams: s.examDates, lat: C[s.displayName]?.latitude ?? null, lon: C[s.displayName]?.longitude ?? null, confidence: C[s.displayName]?.confidence ?? null, note: C[s.displayName]?.note }));
fs.writeFileSync('data/exam-climate-spots.json', JSON.stringify({ title: '평가원 기후 기출 지점 (2022~2026학년도)', source: '교사 정리 자료(skyblue3925-svg/geo-lab, koppen-climate)', spots: out }, null, 1));
console.log('기출 지점', out.length, '좌표 없음', out.filter((s) => s.lat == null).map((s) => s.name));

// ---- WMO 관측소가 50km 넘게 먼 지점은 NOAA GHCN 월별 요약(GSOM, 퍼블릭 도메인)으로 1991~2020 평균을 직접 계산 ----
const ghcnList = process.argv[6];
if (ghcnList) {
  const hav = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  const gh = fs.readFileSync(ghcnList, 'utf8').split('\n').filter(Boolean).map((l) => ({ id: l.slice(0, 11), lat: +l.slice(12, 20), lon: +l.slice(21, 30), elev: +l.slice(31, 37), name: l.slice(41, 71).trim() }));
  const csvLine = (line) => { const o = []; let c = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') q = false; else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };
  // 내려받기: 3번까지 다시 시도, 받은 파일은 캐시(GHCN_CACHE 폴더)에 둔다
  const cache = process.env.GHCN_CACHE;
  async function getDaily(id) {
    const f = cache && `${cache}/${id}.csv`;
    if (f && fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    for (let k = 0; k < 3; k++) {
      try {
        const r = await fetch(`https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/${id}.csv`);
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(r.status);
        const t = await r.text();
        if (f) { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(f, t); }
        return t;
      } catch (e) { await new Promise((ok) => setTimeout(ok, 2000 * (k + 1))); }
    }
    return null;
  }
  // GHCN-Daily 일별 기록으로 1991~2020 월평균: 그달 기록이 20일 이상인 해만 쓰고, 그런 해가 10년 이상이어야 인정
  async function normals(id, minDays = 20, minYrs = 10) {
    const r = await fetch(`https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/${id}.csv`);
    if (!r.ok) return null;
    const lines = (await r.text()).split(/\r?\n/).filter(Boolean);
    const h = csvLine(lines[0]), ix = (k) => h.indexOf(k), iD = ix('DATE');
    const acc = {}; // 'y-m' -> {t:[], p:[]}
    for (const l of lines.slice(1)) {
      const c = csvLine(l), y = +c[iD].slice(0, 4);
      if (y < 1991 || y > 2020) continue;
      const k = c[iD].slice(0, 7), a = (acc[k] ||= { t: [], p: [] });
      const tv = ix('TAVG') >= 0 && c[ix('TAVG')] !== '' ? +c[ix('TAVG')] : ix('TMAX') >= 0 && ix('TMIN') >= 0 && c[ix('TMAX')] !== '' && c[ix('TMIN')] !== '' ? (+c[ix('TMAX')] + +c[ix('TMIN')]) / 2 : null;
      if (tv != null) a.t.push(tv / 10);
      if (ix('PRCP') >= 0 && c[ix('PRCP')] !== '') a.p.push(+c[ix('PRCP')] / 10);
    }
    const T = [...Array(12)].map(() => []), P = [...Array(12)].map(() => []);
    for (const [k, a] of Object.entries(acc)) {
      const m = +k.slice(5, 7) - 1, days = new Date(+k.slice(0, 4), m + 1, 0).getDate();
      if (a.t.length >= minDays) T[m].push(a.t.reduce((x, y) => x + y, 0) / a.t.length);
      if (a.p.length >= minDays) P[m].push((a.p.reduce((x, y) => x + y, 0) / a.p.length) * days);
    }
    const yrs = Math.min(...T.map((a) => a.length), ...P.map((a) => a.length));
    if (yrs < minYrs) return { yrs };
    const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    return { yrs, temp: T.map(avg), precip: P.map(avg) };
  }
  const W = JSON.parse(fs.readFileSync('data/wmo-normals-1991-2020.json', 'utf8'));
  for (const s of out) {
    if (s.lat == null) continue;
    const dW = Math.min(...W.stations.map((w) => hav(s.lat, s.lon, w[3], w[4])));
    if (dW <= 50) continue;
    // 1단계: 100km 안, 그달 20일·10년 이상 / 2단계: 150km 안, 그달 15일·5년 이상(결과에 '약한 자료' 표시)
    let got = null;
    for (const [maxD, minDays, minYrs, tier] of [[100, 20, 10, 1], [150, 15, 5, 2]]) {
      const cands = gh.map((g) => ({ g, d: hav(s.lat, s.lon, g.lat, g.lon) })).filter((x) => x.d <= maxD).sort((a, b) => a.d - b.d).slice(0, 12);
      for (const { g, d } of cands) {
        const n = await normals(g.id, minDays, minYrs);
        if (n?.temp) { got = { source: 'GHCN-Daily', tier, id: g.id, station: g.name, distanceKm: Math.round(d), elev: g.elev, years: n.yrs, temp: n.temp, precip: n.precip }; break; }
      }
      if (got) break;
    }
    s.climate = got;
    console.log(s.name, got ? `${got.station} ${got.distanceKm}km ${got.years}년 연강수 ${got.precip.reduce((a, b) => a + b, 0).toFixed(0)}mm 최한 ${Math.min(...got.temp)} 최난 ${Math.max(...got.temp)}` : '없음 [확인 필요]');
  }
  fs.writeFileSync('data/exam-climate-spots.json', JSON.stringify({ title: '평가원 기후 기출 지점 (2022~2026학년도)', source: '교사 정리 자료(skyblue3925-svg/geo-lab, koppen-climate)', climateNote: 'climate 가 있는 지점은 NOAA GHCN-Daily 일별 기록으로 1991~2020 월평균을 계산한 값(그달 20일 이상 기록된 해 10년 이상), 없는 지점은 WMO 1991~2020 평년값 관측소 중 가장 가까운 곳을 쓴다.', spots: out }, null, 1));
}
