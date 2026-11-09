// 시·도별 발전원별 발전량 묶음 → data/kosis/generation-by-source.json (내장 통계와 같은 형식)
// 원자료(공공데이터포털, 이용 허락 범위 '제한 없음'):
//   - 한국전력거래소_일별 화력발전량(2018~2022.6, 시도×석탄·LNG·유류, 전력거래량)
//   - 한국수력원자력_원자력발전소 호기별 발전량 및 이용률(2014~, 호기→발전소 소재 시도)
//   - 한국전력거래소_지역별 시간별 태양광 및 풍력 발전량(2025, 태양광 시도별, 풍력 육지·제주)
// node scripts/build-energy.js <화력.csv> <원자력.csv> <태양광풍력.csv>
import fs from 'node:fs';
const [thermalF, nuclearF, solarF] = process.argv.slice(2);
const read = (f) => { const b = fs.readFileSync(f); try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, ''); } catch { return new TextDecoder('euc-kr').decode(b); } };
const csv = (f) => read(f).split(/\r?\n/).filter(Boolean).map((l) => l.split(',').map((s) => s.trim()));
const SIDO = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원도: '강원', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주', 제주도: '제주', 서울시: '서울', 부산시: '부산', 대구시: '대구', 인천시: '인천', 광주시: '광주', 대전시: '대전', 울산시: '울산', 세종시: '세종' };
const unknown = new Set();
const FULL = { 서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원도', 충북: '충청북도', 충남: '충청남도', 전북: '전라북도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도' };
const CODE = { 서울: '11', 부산: '21', 대구: '22', 인천: '23', 광주: '24', 대전: '25', 울산: '26', 세종: '29', 경기: '31', 강원: '32', 충북: '33', 충남: '34', 전북: '35', 전남: '36', 경북: '37', 경남: '38', 제주: '39' };
// 원자력 발전소 소재지(발전소 이름 → 시도)
const PLANT = { 고리: '부산', 신고리: '부산', 새울: '울산', 월성: '경북', 신월성: '경북', 한울: '경북', 신한울: '경북', 한빛: '전남' };

const acc = {}; // [연도][시도][발전원] = MWh
const add = (y, s, k, v) => { ((acc[y] ||= {})[s] ||= {})[k] = (acc[y][s][k] || 0) + v; };
// 화력: 일별 → 연간(2022 은 6월까지라 넣지 않는다)
const th = csv(thermalF);
for (const r of th.slice(1)) {
  const y = r[0].slice(0, 4), s = SIDO[r[1]];
  if (!s) { unknown.add(r[1]); continue; }
  if (y === '2022') continue;
  const k = { LNG: 'LNG', 석탄: '석탄', 유류: '유류' }[r[2]] || r[2];
  add(y, s, `화력-${k}`, +r[3]);
}
// 원자력: 호기별 연간
for (const r of csv(nuclearF).slice(1)) {
  const plant = r[0].replace(/\d+호기$/, ''), s = PLANT[plant];
  if (!s) throw new Error(`소재지를 모르는 원자력 발전소: ${r[0]}`);
  add(r[1], s, '원자력', +r[2]);
}
// 태양광: 시간별 → 연간 (풍력은 육지·제주 구분뿐이라 시도별로 넣지 않는다)
for (const r of csv(solarF).slice(1)) {
  if (r[3] !== '태양광') continue;
  const s = SIDO[r[2]];
  if (s) add(r[0].slice(0, 4), s, '태양광', +r[4]); else unknown.add(r[2]);
}
if (unknown.size) throw new Error(`모르는 지역 이름: ${[...unknown].join(', ')}`);
const rows = [];
for (const [y, bySido] of Object.entries(acc)) for (const [s, byK] of Object.entries(bySido)) for (const [k, v] of Object.entries(byK)) rows.push([y, [CODE[s]], [FULL[s]], k, Math.round(v)]);
const out = {
  key: 'generation-by-source', topic: '시·도별 발전원별 발전량(원자력·석탄·LNG·유류·태양광) — 연도마다 들어 있는 발전원이 다르다',
  title: '시도별 발전원별 발전량(전력거래량 기준)',
  cite: '한국전력거래소「일별 화력발전량」·「지역별 시간별 태양광 발전량」, 한국수력원자력「원자력발전소 호기별 발전량」(공공데이터포털)',
  sourceUrl: 'https://www.data.go.kr/data/15069345/fileData.do ; https://www.data.go.kr/data/15002302/fileData.do ; https://www.data.go.kr/data/15065269/fileData.do',
  license: '공공데이터포털 이용 허락 범위: 제한 없음(출처 표시)',
  retrieved: new Date().toISOString().slice(0, 10), prdSe: 'Y',
  periods: Object.keys(acc).sort(),
  coverage: { '화력-석탄·LNG·유류': '2018~2021 (전력시장 참여 발전기, 한전 직접 거래·자가용 제외)', 원자력: '2014~2025 (호기별 합, 발전소 소재 시도)', 태양광: '2025 (전력시장 참여 설비)' },
  units: { '화력-석탄': 'MWh', '화력-LNG': 'MWh', '화력-유류': 'MWh', 원자력: 'MWh', 태양광: 'MWh' },
  dims: { C1: '시도별' },
  rows,
};
fs.writeFileSync(new URL('../data/kosis/generation-by-source.json', import.meta.url), JSON.stringify(out));
for (const y of ['2021', '2025']) {
  const t = acc[y] || {};
  console.log(y, Object.entries(t).map(([s, k]) => `${s} ${Object.entries(k).map(([a, b]) => `${a}:${Math.round(b / 1000)}GWh`).join(',')}`).join(' | '));
}
