// 수업 단골 KOSIS 통계를 미리 받아 data/kosis/ 에 넣는다(공공누리 제1유형, 출처 표시).
// 교사 한 명의 인증키로 한 번 받아 두면, 다른 선생님은 키 없이 이 자료를 쓴다(키는 넣지 않는다).
// node scripts/build-kosis.js [이름…]   (이름을 주면 그것만 다시 받는다)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY = process.env.KOSIS_API_KEY || fs.readFileSync(path.join(os.homedir(), '.geo-figure-mcp', 'kosis-key.txt'), 'utf8').trim();
const OUT = new URL('../data/kosis/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

// key: 파일 이름 / topic: 수업 주제 / years: 받을 최근 기간 수(시계열이면 2 이상)
export const TABLES = [
  { key: 'population-indicators', orgId: '101', tblId: 'DT_1IN2030', topic: '인구 구조: 부양비·노령화 지수·중위 연령·성비 (시군구)' },
  { key: 'population-age5', orgId: '101', tblId: 'DT_1B040M5_1', topic: '인구 피라미드: 성·5세 연령별 주민등록연앙인구 (시군구)' },
  { key: 'census-population', orgId: '101', tblId: 'DT_1IN1502', topic: '인구주택총조사 인구·가구·주택 (시군구)', keep: (r) => r.C1.length <= 5 },
  { key: 'daytime-population', orgId: '101', tblId: 'DT_1PA2020', topic: '상주·주간 인구, 주간 인구 지수, 통근·통학 (시군구, 2020)', fix: { 2: '0', 3: '000' } },
  { key: 'foreign-residents', orgId: '110', tblId: 'TX_11025_A001_A', topic: '외국인 주민 유형(근로자·결혼 이민자·유학생 등) (시군구)' },
  { key: 'fertility', orgId: '101', tblId: 'DT_1B81A17', topic: '합계 출산율 (시군구)', years: 10 },
  { key: 'migration-sido', orgId: '101', tblId: 'DT_1B26003_A01', topic: '시·도 간 인구 이동(전출지→전입지, 연간) — 유선도', prdSe: 'Y' },
  { key: 'urban-population', orgId: '460', tblId: 'TX_315_2009_H1001', topic: '도시 지역 인구 비율 (시군구)' },
  { key: 'grdp', orgId: '101', tblId: 'DT_1C91', topic: '경제 활동별 지역 내 총생산(GRDP) (시도)' },
  { key: 'manufacturing', orgId: '101', tblId: 'DT_1FS1101', topic: '광업·제조업 업종별(중분류) 출하액·종사자 (시도·시군구)', keep: (r) => r.C2.length <= 3 },
  { key: 'business-sido', orgId: '101', tblId: 'DT_1K52F01', topic: '산업별 사업체 수·종사자 수 (시도, 대분류)', fix: { 3: '0' }, keep: (r) => r.C2.length <= 1 },
  { key: 'energy-consumption', orgId: '101', tblId: 'DT_1YL20391', topic: '최종 에너지 소비량 (시도)', years: 5 },
  { key: 'generation-capacity', orgId: '388', tblId: 'DT_38803_A028', topic: '시·도별 발전원별 발전 설비 용량(원자력·유연탄·LNG·양수·신재생 등)', years: 5 },
  { key: 'renewable-energy', orgId: '101', tblId: 'DT_1YL202113E', topic: '신재생 에너지원별 생산량 (시도)' },
  { key: 'farm-population', orgId: '101', tblId: 'INH_1EA1011_01', topic: '농가 인구 (시군구)' },
  { key: 'vegetable-area', orgId: '101', tblId: 'DT_1ET0013', topic: '노지 채소 재배 면적 (시도)' },
  { key: 'greenhouse-area', orgId: '101', tblId: 'DT_1ET0017', topic: '시설 작물 재배 면적 (시도)' },
  { key: 'crop-area', orgId: '114', tblId: 'DT_1E5212', topic: '작물별 재배 면적 (시도)' },
];
const PRD_CODE = { 년: 'Y', 반기: 'H', 분기: 'Q', 월: 'M', 일: 'D', 부정기: 'IR', '2년': 'F', '3년': 'F', '4년': 'F', '5년': 'F', '10년': 'F' };
const get = async (url) => {
  for (let k = 0; k < 4; k++) {
    try {
      const t = await (await fetch(url)).text();
      const j = JSON.parse(t);
      if (j && !Array.isArray(j) && (j.err || j.errMsg)) throw Object.assign(new Error(`KOSIS ${j.err}: ${j.errMsg}`), { kosis: j.err });
      return j;
    } catch (e) { if (e.kosis) throw e; await new Promise((ok) => setTimeout(ok, 1500 * (k + 1))); }
  }
  throw new Error('KOSIS 응답 없음');
};
const meta = (type, t) => get(`https://kosis.kr/openapi/statisticsData.do?method=getMeta&type=${type}&apiKey=${encodeURIComponent(KEY)}&orgId=${t.orgId}&tblId=${t.tblId}&format=json&jsonVD=Y`);

async function fetchTable(t) {
  const [itm, prd, tbl] = await Promise.all([meta('ITM', t), meta('PRD', t).catch(() => []), meta('TBL', t).catch(() => [])]);
  const cycles = (prd || []).map((p) => PRD_CODE[p.PRD_SE] || p.PRD_SE);
  const prdSe = t.prdSe || (cycles.includes('Y') ? 'Y' : cycles[0] || 'Y');
  const items = itm.filter((x) => x.OBJ_ID === 'ITEM').map((x) => x.ITM_ID);
  const levels = [...new Set(itm.filter((x) => x.OBJ_ID !== 'ITEM').map((x) => +x.OBJ_ID_SN))].sort((a, b) => a - b);
  const base = { method: 'getList', apiKey: KEY, orgId: t.orgId, tblId: t.tblId, format: 'json', jsonVD: 'Y', prdSe, newEstPrdCnt: String(t.years || 1) };
  const call = async (itmId, objL1) => {
    const p = new URLSearchParams({ ...base, itmId });
    for (let i = 1; i <= 8; i++) p.set(`objL${i}`, levels.includes(i) ? (i === 1 && objL1 ? objL1 : t.fix?.[i] ?? 'ALL') : '');
    return get(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${p}`);
  };
  // 한 번에 4만 칸까지만 준다 → 너무 크면 항목별로, 그래도 크면 1단계 분류(지역)별로 나눠 받는다
  let rows = [];
  try { rows = await call('ALL'); }
  catch (e) {
    if (!/31|초과/.test(String(e.message))) throw e;
    const l1 = itm.filter((x) => +x.OBJ_ID_SN === levels[0]).map((x) => x.ITM_ID);
    for (const it of items) {
      try { rows.push(...await call(it)); }
      catch (e2) {
        if (!/31|초과/.test(String(e2.message))) throw e2;
        for (let i = 0; i < l1.length; i += 5) {
          try { rows.push(...await call(it, l1.slice(i, i + 5).join('+'))); }
          catch { for (const one of l1.slice(i, i + 5)) rows.push(...await call(it, one).catch(() => [])); }
        }
      }
    }
  }
  if (t.keep) rows = rows.filter((r) => t.keep({ C1: r.C1 || '', C2: r.C2 || '', C3: r.C3 || '' }));
  const unitOf = {};
  for (const x of itm.filter((y) => y.OBJ_ID === 'ITEM')) unitOf[x.ITM_NM] = x.UNIT_NM || '';
  const out = {
    key: t.key, topic: t.topic, orgId: t.orgId, tblId: t.tblId,
    title: rows[0]?.TBL_NM || tbl?.[0]?.TBL_NM, org: rows[0]?.ORG_NM || (t.orgId === '101' ? '국가데이터처' : ''),
    cite: `${t.orgId === '101' ? '국가데이터처(통계청)' : rows[0]?.ORG_NM || 'KOSIS'}, 「${rows[0]?.TBL_NM || ''}」`,
    sourceUrl: `https://kosis.kr/statHtml/statHtml.do?orgId=${t.orgId}&tblId=${t.tblId}`,
    license: '공공누리 제1유형(출처 표시) — KOSIS 국가통계포털',
    retrieved: new Date().toISOString().slice(0, 10), prdSe,
    periods: [...new Set(rows.map((r) => r.PRD_DE))].sort(),
    units: unitOf,
    dims: Object.fromEntries(levels.map((l) => [`C${l}`, itm.find((x) => +x.OBJ_ID_SN === l)?.OBJ_NM])),
    // 행: [기간, [분류 코드…], [분류 이름…], 항목 이름, 값]
    rows: rows.map((r) => [r.PRD_DE, levels.map((l) => r[`C${l}`]), levels.map((l) => r[`C${l}_NM`]), r.ITM_NM, r.DT === '-' || r.DT === '' || r.DT == null ? null : +r.DT]),
  };
  fs.writeFileSync(new URL(`${t.key}.json`, OUT), JSON.stringify(out));
  return out;
}

const only = process.argv.slice(2);
const index = [];
for (const t of TABLES.filter((x) => !only.length || only.includes(x.key))) {
  try {
    const o = await fetchTable(t);
    console.log(`✔ ${t.key.padEnd(22)} ${o.rows.length.toString().padStart(7)}칸  ${o.periods.join(',')}  ${o.title}`);
  } catch (e) { console.log(`✘ ${t.key.padEnd(22)} ${e.message}`); }
}
// 목록 파일
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
  const o = JSON.parse(fs.readFileSync(new URL(f, OUT), 'utf8'));
  index.push({ key: o.key, topic: o.topic, title: o.title, cite: o.cite, periods: o.periods, items: Object.keys(o.units), dims: o.dims, cells: o.rows.length });
}
fs.writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 1));
