// geo-figure-mcp 도구 정의 — 로컬(stdio)·원격(HTTP) 공용. createServer({ remote, publish }) 로 만든다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SOURCES, findData, transform, round, assignLabels, suggestRegions, examSpots, kosisSearch, kosisItems, setKosisKey, bundleList, withKosisKey } from './data.js';
import { listRegions } from './maps.js';
import { makeFigure, exportFigures, loadStyle, saveStyle } from './build.js';
import { renderPng } from './svg.js';
import { CHARTS } from './charts.js';
import { LANDFORM_PRESETS } from './terrain.js';

const PKG_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// 새 버전 알림: 켜질 때 npm 최신 버전을 한 번 묻는다(3초 안에 답이 없으면 그냥 넘어간다)
let LATEST = null;
if (!process.env.GEO_FIGURE_NO_UPDATE_CHECK) {
  fetch('https://registry.npmjs.org/geo-figure-mcp/latest', { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json()).then((j) => { LATEST = j.version; }).catch(() => {});
}
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
export const updateNotice = () => (LATEST && newer(LATEST, PKG_VERSION) ? `새 버전 ${LATEST} 이 있습니다(지금 ${PKG_VERSION}). MCP 설정의 args 를 ["-y", "geo-figure-mcp@latest"] 로 두고 앱을 다시 켜면 바뀝니다. 교사에게 한 번 알려 주세요.` : null);
export const OUT = process.env.GEO_FIGURE_OUT || path.join(os.homedir(), 'Documents', '지리시험자료');

const GUIDE = `
[작업 순서 — 반드시 지킨다]
1. 교사의 말에서 지도·그래프 종류, 지표, 지역, 연도를 읽는다. 모르면 기본값을 채운다.
2. find_data 로 실제 통계를 찾는다. 한국 시·도·시·군·구 통계는 먼저 list_bundled_data에 query와 summary:true를 보내 후보를 찾고, 없을 때만 KOSIS(키 필요)를 쓴다. 숫자를 지어내지 않는다. 못 찾으면 [확인 필요]로 알리고 교사에게 숫자를 받는다.
3. 만들기 전에 반드시 '계획 요약'을 보여 주고 교사의 "예"를 받는다:
   지표·단위 / 기준 연도 / 지역과 기호(A~E 또는 (가)~(마)) / 가공(지수·비율·편차·반올림) / 기호 순서(무작위·북→남·서→동·지정) / 출력(PPTX·HWPX) / 출처 문구
4. 계획 요약과 함께 preview_figures 로 시안 그림을 보여 준다. 그림마다 기본 시안을 보여 주고, 기호를 비교할 때만 compareLabelStyles:true를 쓴다. 교사가 ‘예’라고 하면 make_figures로 만든다. 로컬에서 명세가 같으면 figures 대신 previewId를 쓴다. 파일 위치와 정답표를 알려 준다.
5. 만든 뒤 고치기(범례·단계·지역·기호·순서): open_figure_spec 으로 설계도를 읽어 그 부분만 바꾸고 make_figures 를 다시 부른다. 통계를 다시 찾지 않는다. 손으로 고칠 땐 그룹 해제(개체 풀기) 한 번이면 모든 도형이 따로 움직인다고 알려 준다.

[품질 규칙 — 교사 기준 + 경기도교육청 지리 문항 제작 자료]
- 흑백 인쇄로 구분돼야 한다: 색 대신 빗금·회색 농도(자동).
- 정답 단서를 드러내지 않는다: 지명·국가명은 기호로 바꾸고, 정답표는 로컬 파일 마지막 장 또는 원격 응답에 둔다.
- 경계는 자료 연도에 맞춘다: 2026년 7월 이후 자료는 2026년 판(16개 시·도, '전남광주'), 그 전 자료는 map.edition:'2025'(17개 시·도). 내장 자료는 mapEdition 과 mapName 을 알려 준다.
- 출처와 기준 연도를 꼭 적는다: 출처는 그림 오른쪽 아래(자동). 지도 출처도 함께.
- 전도(세계·대륙·우리나라 전체)가 아닌 지도에는 축척을 넣는다(자동).
- 그림의 특정 부분은 A, B, C 대문자, 독립 대상은 (가)·(나)·(다).
- 생소한 용어와 자료 조건은 notes(주석)로 보충한다. 풀이에 불필요한 그림은 넣지 않는다.
- 판별용 지역은 suggest_regions 로 서로 잘 갈리는 곳을 고른다.
`;

const INSTRUCTIONS = [
  '지리 시험 자료는 실제 통계와 출처를 쓴다. 한국 자료는 list_bundled_data에 query와 summary:true를 보내 먼저 찾는다.',
  '지표·연도·지역·가공·기호·출력·출처와 시안을 제시하고 교사 확인 후 make_figures를 부른다.',
  '기호를 비교할 때만 4종 시안을 요청한다. 로컬에서 명세가 같으면 previewId를 재사용한다.',
  '행정구역 판은 자료 연도에 맞춘다. 정답표는 로컬 파일 마지막 장 또는 원격 응답에 둔다.',
  '필요할 때 guide의 topic으로 workflow 또는 spec을 선택한다.',
].join('\n');
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PREVIEWS = 8;
const MAX_PREVIEW_SPEC_BYTES = 64 * 1024;
const figureSpecs = z.array(z.object({ title: z.string().optional() }).passthrough());
const figureStyle = z.object({ font: z.string().optional(), fontPptx: z.string().optional(), size: z.number().optional(), small: z.number().optional(), width: z.number().optional() });
const LABEL_NAMES = { halo: '① 흰 테두리(기본)', plain: '② 바탕 없음', box: '③ 네모 흰 바탕', circle: '④ 작은 원 흰 바탕' };
const hasMap = (f) => f.map || f.parts?.some((p) => p.map);
const withLabelStyle = (f, labelStyle) => {
  const apply = (p) => p.map ? { ...p, map: { ...p.map, labelStyle } } : p;
  return f.parts ? { ...f, parts: f.parts.map(apply) } : apply(f);
};

export function createServer({ remote = false, publish = null } = {}) {
const server = new McpServer({ name: 'geo-figure-mcp', version: PKG_VERSION }, { instructions: INSTRUCTIONS });
const previews = new Map();
const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: '오류: ' + (e.message || e) }] });
const wrap = (fn) => async (a) => { try { return ok(await fn(a)); } catch (e) { return fail(e); } };

server.tool('guide', '필요할 때 제작 순서(workflow) 또는 그림 명세(spec)를 조회한다. 인자 없이 호출하면 둘 다 반환한다.', {
  topic: z.enum(['workflow', 'spec']).optional(),
}, wrap(({ topic }) => [
  updateNotice(),
  'geo-figure-mcp ' + PKG_VERSION,
  topic !== 'spec' && GUIDE,
  topic !== 'workflow' && SPEC_HELP,
].filter(Boolean).join('\n')));

server.tool('list_sources', '쓸 수 있는 통계 자료원과 지표 예시를 보여 준다.', {}, wrap(() => SOURCES));

server.tool('find_data', '실제 통계를 찾는다. 결과에 출처(cite)와 연도가 붙는다. 숫자를 지어내지 말고 이 결과만 쓴다.', {
  source: z.enum(remote ? Object.keys(SOURCES).filter((k) => k !== 'kosis') : Object.keys(SOURCES)).describe(remote ? '자료원 (원격 서버에서는 KOSIS 직접 조회를 쓰지 않는다 — 내장 자료 bundle 을 쓴다)' : '자료원'),
  indicators: z.array(z.string()).default([]).describe('지표 코드 또는 열 이름'),
  regions: z.array(z.string()).default([]).describe('나라 ISO3(KOR, JPN…, 세계=WLD) / 기후: 기출 지점 한글 이름·관측소 영문 이름·"위도,경도" / 서울 자치구 이름'),
  kosis: z.object({ orgId: z.string().optional(), tblId: z.string().optional(), itmId: z.string().optional(), objL1: z.string().optional(), objL2: z.string().optional(), year: z.number().optional() }).passthrough().optional().describe('source 가 kosis 일 때: { orgId, tblId, itmId, objL1:"ALL", objL2, year }'),
  bundle: z.object({ key: z.string(), items: z.array(z.string()).optional(), period: z.coerce.string().optional(), where: z.object({}).passthrough().optional() }).passthrough().optional().describe('source 가 bundle 일 때: { key, items:[항목], period, where:{ C1:"총인구" } }'),
  year: z.number().optional().describe('특정 연도. 비우면 가장 최근'),
  years: z.boolean().optional().describe('true 면 연도별 전체(시계열)'),
}, wrap((a) => { if (remote && a.source === 'kosis') throw new Error('원격 서버에서는 KOSIS 직접 조회를 하지 않습니다(인증키를 대화창에 넣지 않도록). list_bundled_data 의 내장 자료를 쓰거나, 내 컴퓨터에 설치해 쓰세요.'); return findData(a); }));

server.tool('list_exam_climate_spots', '평가원 기후 기출 지점(2022~2026학년도) 목록: 이름, 기후 기호, 출제 시험(연월일), 좌표.', {
  code: z.string().optional().describe("기후 기호로 거르기. 예: 'Cs', 'BW', 'Df'"),
}, wrap((a) => examSpots().filter((s) => !a.code || (s.code || '').startsWith(a.code)).map((s) => ({ name: s.name, code: s.code, exams: s.exams, lat: s.lat, lon: s.lon, data: s.climate ? s.climate.source : (s.lat == null ? '좌표 없음' : 'WMO') }))));

server.tool('list_bundled_data', '내장 KOSIS 통계 목록. query로 찾고 summary:true로 키와 주제만 본다. 선택한 키로 다시 조회하면 항목과 기간을 볼 수 있다.', {
  query: z.string().optional().describe('표 키 또는 검색어'),
  summary: z.boolean().optional().describe('키와 주제만 반환'),
}, wrap(({ query, summary }) => {
  const terms = query?.toLowerCase().trim().split(/\s+/).filter(Boolean) || [];
  const tables = bundleList().filter(({ key, topic, title, items }) => {
    const text = [key, topic, title, ...items].join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  return summary ? tables.map(({ key, topic }) => ({ key, topic })) : tables;
}));

if (!remote) {
server.tool('kosis_search', 'KOSIS 국가통계포털에서 통계표를 찾는다(시·도·시·군·구 통계). 인증키 필요 — 먼저 list_bundled_data 를 본다.', {
  query: z.string().describe('찾을 말. 예: 주간인구, 발전량 시도, 외국인 주민'),
}, wrap((a) => kosisSearch(a.query)));

server.tool('kosis_items', 'KOSIS 통계표의 항목(itmId)·분류(objL1…)·기간을 본다.', {
  orgId: z.string(), tblId: z.string(),
}, wrap((a) => kosisItems(a)));
}

if (!remote) server.tool('set_kosis_key', 'KOSIS 인증키를 이 컴퓨터 사용자 폴더에 저장한다(kosis.kr/openapi 에서 무료 발급).', { key: z.string() }, wrap((a) => setKosisKey(a.key)));

server.tool('list_regions', '지도에 쓸 수 있는 지역 이름 목록(한국 시·도, 시·군·구, 세계 국가 영문명).', {
  region: z.enum(['korea', 'world']).default('korea'),
  level: z.enum(['sido', 'sigungu']).default('sido'),
  within: z.array(z.string()).optional().describe("시·군·구 목록을 이 시·도 안으로 좁힌다. 예: ['경기']"),
}, wrap((a) => listRegions(a)));

server.tool('suggest_regions', '지표 값이 서로 뚜렷하게 갈리는 지역 k곳을 추천한다(판별이 잘 되는 조합).', {
  rows: z.array(z.object({ name: z.string(), values: z.object({}).catchall(z.number()) })).describe('find_data 결과의 rows'),
  indicators: z.array(z.string()),
  k: z.number().default(5),
}, wrap((a) => suggestRegions(a.rows, a.indicators, a.k)));

server.tool('prepare_values', '출제용 가공: 최댓값=100 지수, 합에 대한 비율, 기준값과의 차이(편차), 기준 대비 %, 반올림.', {
  values: z.array(z.number()),
  mode: z.enum(['none', 'max100', 'share', 'deviation', 'national']).default('none'),
  base: z.number().optional().describe('deviation·national 의 기준값'),
  digits: z.number().default(1),
}, wrap((a) => transform(a.values, a.mode, a.base).map((v) => round(v, a.digits))));

server.tool('assign_labels', '지역 이름을 A~E 또는 (가)~(마) 기호로 바꾼다. 순서: random(기본) / north-south / west-east / given.', {
  names: z.array(z.string()),
  order: z.enum(['random', 'north-south', 'west-east', 'given']).default('random'),
  style: z.enum(['AE', 'ga']).default('AE'),
  coords: z.object({}).catchall(z.array(z.number())).optional().describe('north-south·west-east 일 때 {이름:[경도,위도]}'),
  seed: z.number().optional(),
}, wrap((a) => assignLabels(a.names, a)));

server.tool('make_figures', '그림 명세로 PPTX·HWPX 파일을 만든다. 만들기 전에 교사에게 계획 요약을 보여 주고 확인을 받았는지 먼저 확인한다. 명세 작성법은 guide.', {
  figures: (remote ? figureSpecs : figureSpecs.optional()).describe('그림 명세 목록. guide의 spec 참고'),
  ...(remote ? {} : {
    previewId: z.string().optional().describe('명세가 같으면 figures 대신 로컬 시안 ID'),
    labelStyle: z.enum(['halo', 'plain', 'box', 'circle']).optional().describe('기호 비교 시안에서 교사가 선택한 스타일'),
  }),
  name: z.string().default('지리자료').describe('파일 이름(확장자 제외)'),
  formats: z.array(z.enum(['pptx', 'hwpx'])).default(['pptx', 'hwpx']),
  answerKey: z.string().optional().describe(remote ? '정답표 — 원격 서버에서는 파일에 넣지 않고 대화창에만 돌려준다(시험 보안)' : '정답표 — 파일 마지막 장에 들어간다. 첫 줄은 제목'),
  ...(remote ? {} : { outDir: z.string().optional().describe(`저장 폴더(기본 ${OUT})`) }),
  style: figureStyle.optional().describe('이번 파일에만 쓸 글꼴·크기(학교 양식)'),
  confirmed: z.boolean().describe('교사가 계획 요약을 보고 "예"라고 했으면 true'),
}, wrap(async (a) => {
  if (!a.confirmed) throw new Error('먼저 계획 요약(지표·연도·지역·가공·기호 순서·출력·출처)을 교사에게 보여 주고 확인을 받으세요.');
  let { figures, style } = a;
  let st;
  if (a.previewId !== undefined) {
    if (figures !== undefined || style !== undefined) throw new Error('previewId는 figures 또는 style과 함께 쓸 수 없습니다. 명세를 바꾸려면 새 시안을 만드세요.');
    const preview = previews.get(a.previewId);
    if (!preview || preview.expires <= Date.now()) {
      previews.delete(a.previewId);
      throw new Error('시안 ID가 만료되었거나 없습니다. 다시 시안을 만들거나 원래 figures를 보내세요.');
    }
    if (a.labelStyle && preview.compareIndex < 0) throw new Error('labelStyle은 기호 비교 시안 ID와 함께 쓸 수 있습니다.');
    if (preview.compareIndex >= 0 && !a.labelStyle) throw new Error('기호 비교 시안에서는 교사가 선택한 labelStyle을 지정하세요.');
    ({ figures, style, st } = preview);
    if (a.labelStyle) figures = figures.map((f, i) => i === preview.compareIndex ? withLabelStyle(f, a.labelStyle) : f);
  } else if (!figures || a.labelStyle !== undefined) {
    throw new Error('figures 또는 로컬 previewId를 보내세요. labelStyle은 지도 명세 안에 지정할 수 있습니다.');
  }
  if (remote && figures.length > 12) throw new Error('한 번에 그림은 12장까지 만들 수 있습니다.');
  st ??= { ...loadStyle(), ...style };
  const figs = [];
  for (const f of figures) figs.push(await makeFigure(f, st));
  const safe = String(a.name || '지리자료').replace(/[\/:*?"<>|]/g, '_').slice(0, 60);
  const dir = remote ? publish.newDir() : (a.outDir || OUT);
  const paths = exportFigures(figs, { outDir: dir, name: safe, formats: a.formats, answerKey: remote ? undefined : a.answerKey, style: st });
  const files = remote ? paths.map((p) => publish.url(p)) : paths;
  // 고치기용 설계도: 같은 폴더에 <이름>.geo-figure.json — 나중에 open_figure_spec 으로 읽어 일부만 바꿔 다시 만든다
  let specFile = null;
  if (!remote) { specFile = path.join(dir, `${safe}.geo-figure.json`); fs.writeFileSync(specFile, JSON.stringify({ name: safe, formats: a.formats, style, answerKey: a.answerKey, figures }, null, 1)); }
  return { files, ...(updateNotice() ? { update: updateNotice() } : {}), ...(remote ? { expires: `내려받기 주소는 ${publish.keepText} 동안, 한 번만 열립니다(받으면 서버에서 바로 지움). 꼭 내려받아 저장하세요.`, ...(a.answerKey ? { answerKey: a.answerKey, answerKeyNote: '시험 보안을 위해 정답표는 파일에 넣지 않았습니다. 이 내용을 교사에게 그대로 보여 주세요.' } : {}) } : {}), sizes_mm: figs.map((f) => ({ title: f.title, w: round(f.w), h: round(f.h) })), ...(specFile ? { specFile } : {}), note: '그림마다 묶음 하나 — PPTX는 그룹 해제, HWPX는 개체 풀기를 한 번만 하면 시군구·기호·선·범례가 모두 따로 움직인다(도형 이름이 지역 이름). 범례 칸과 지역은 같은 무늬라 서식 복사로 단계를 바꿀 수 있다. 범례·지역·기호를 크게 바꾸려면 open_figure_spec 으로 설계도를 읽어 고친 뒤 make_figures 를 다시 부른다.' };
}));

server.tool('preview_figures', '파일을 만들기 전 PNG 시안을 보여 준다. 기호 비교가 필요하면 compareLabelStyles:true를 쓴다. 로컬 previewId는 make_figures에서 재사용할 수 있다.', {
  figures: figureSpecs.describe('make_figures와 같은 그림 명세'),
  compareLabelStyles: z.boolean().optional().describe('true면 첫 지도에 기호 스타일 4개를 비교'),
  style: figureStyle.optional(),
}, async (a) => {
  try {
    const st = { ...loadStyle(), ...(a.style || {}) };
    const content = [];
    const compareIndex = a.compareLabelStyles && a.figures.length ? Math.max(0, a.figures.findIndex(hasMap)) : -1;
    const list = compareIndex >= 0
      ? Object.entries(LABEL_NAMES).map(([label, cap]) => ({ cap, spec: withLabelStyle(a.figures[compareIndex], label) }))
      : a.figures.slice(0, 6).map((f, i) => ({ cap: '시안 ' + (i + 1) + ': ' + (f.title || ''), spec: f }));
    for (const { cap, spec } of list) {
      const fig = await makeFigure(spec, st);
      content.push({ type: 'text', text: cap }, { type: 'image', mimeType: 'image/png', data: Buffer.from(renderPng(fig, { width: 800 })).toString('base64') });
    }
    let how = compareIndex >= 0 ? '기호 ①~④ 중 하나를 고르세요(halo·plain·box·circle).' : '교사 확인 후 파일을 만드세요.';
    const allFiguresShown = compareIndex >= 0 ? a.figures.length === 1 : list.length === a.figures.length;
    if (!remote && list.length && allFiguresShown && Buffer.byteLength(JSON.stringify(a)) <= MAX_PREVIEW_SPEC_BYTES) {
      const id = randomBytes(8).toString('hex');
      if (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value);
      previews.set(id, { figures: a.figures, style: a.style, st, compareIndex, expires: Date.now() + PREVIEW_TTL_MS });
      how += '\npreviewId: ' + id + '\nmake_figures에 figures 대신 이 ID를 보내세요.';
      if (compareIndex >= 0) how += ' 선택한 labelStyle도 보내세요.';
    } else {
      how += ' make_figures에 figures를 보내세요.';
    }
    content.push({ type: 'text', text: how });
    return { content };
  } catch (e) { return { isError: true, content: [{ type: 'text', text: `오류: ${e.message || e}` }] }; }
});

if (!remote) server.tool('open_figure_spec', '이미 만든 그림의 설계도(make_figures 가 저장한 <이름>.geo-figure.json)를 읽는다. "범례 바꿔 줘", "이 지역 빼 줘", "기호 순서 바꿔 줘" 같은 수정 요청은 이것을 읽어 필요한 부분만 고친 뒤 make_figures 를 다시 부른다(통계를 다시 찾지 않는다).', {
  path: z.string().optional().describe('설계도 파일 경로. 비우면 저장 폴더에서 가장 최근 것'),
  name: z.string().optional().describe('파일 이름(확장자 제외)으로 찾기'),
}, wrap((a) => {
  let f = a.path;
  if (!f) {
    const list = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((n) => n.endsWith('.geo-figure.json') && (!a.name || n.startsWith(a.name))) : [];
    if (!list.length) throw new Error(`설계도가 없습니다(${OUT}). path 로 직접 알려 주세요.`);
    list.sort((x, y) => fs.statSync(path.join(OUT, y)).mtimeMs - fs.statSync(path.join(OUT, x)).mtimeMs);
    f = path.join(OUT, list[0]);
  }
  return { file: f, spec: JSON.parse(fs.readFileSync(f, 'utf8')), how: '이 spec 에서 바꿀 부분만 고쳐 make_figures(confirmed:true, 같은 name 또는 새 name)에 넘긴다.' };
}));

server.tool('set_style', '학교 양식에 맞춘 글꼴·크기·그림 폭을 저장한다(다음부터 기본값).', {
  font: z.string().optional().describe('한글(HWPX) 그림 글꼴(기본 함초롬돋움)'),
  fontPptx: z.string().optional().describe('PowerPoint 그림 글꼴(기본 맑은 고딕)'),
  size: z.number().optional().describe('기본 글자 크기 pt(기본 8)'),
  small: z.number().optional().describe('작은 글자 pt(기본 7)'),
  width: z.number().optional().describe('그림 기본 폭 mm(기본 82.5 = 2단 시험지 한 단)'),
}, wrap((a) => (remote ? '원격 서버에서는 설정을 저장하지 않습니다. 학교 양식은 make_figures 의 style 로 매번 넘기세요.' : saveStyle(Object.fromEntries(Object.entries(a).filter(([, v]) => v != null))))));

const SPEC_HELP = `
[그림 명세(spec)]
{ title, layout:'row'|'column', source:'출처 문구', notes:['* 주석'], parts:[ { caption:'(가)', map:{…} } , { caption:'(나)', chart:{…} } ] }
- 한 부분만이면 parts 없이 { title, map } 또는 { title, chart } 도 된다.

map:
{ region:'korea'|'world', level:'sido'|'sigungu', within:['서울'], bbox:[서경,남위,동경,북위], detail:'high'|'mid'|'low', width:mm,
  classes:{ '경북':1, '서울 종로구':3 }   // 단계 번호 0~5 (흰색→빗금→연회색→격자→회색→진회색)
  legend:['90 미만','90~110', …],        // classes 단계 순서대로
  labels:{ '경북':'A' },                  // 지역 한가운데에 기호
  labelStyle: 'halo',                     // 기호 글자: halo(흰 테두리, 기본) | plain(바탕 없음) | box(네모 흰 바탕) | circle(작은 원 흰 바탕)
  points:[{ lon, lat, label:'A' }],       // 점 + 기호 (도시·기후 지점)
  flows:[{ from:'경기', to:'서울', value:120 }], // 흐름 화살표(굵기 = 값)
  graticule:20, scaleBar:true|false, edition:'2026'|'2025' }
- 시·군·구 이름은 '서울 종로구'처럼 '시·도 짧은이름 + 이름'. list_regions 로 확인.

chart: type = ${Object.keys(CHARTS).join(' | ')} | profile | landform
- bar/stacked: { categories:[…], series:[{name, values:[…]}], unit:'(%)', valueLabels:'none'|'last'|'all', width, height }
- scatter/bubble: { points:[{label:'A', x, y, size?}], xLabel, yLabel, sizeLabel }
- climate: { stations:[{label:'(가)', temp:[12], precip:[12]}], tRange:[-10,30], pRange:[0,300] }
- deviation: { categories, series:[{name, values}], base:'기준 이름', unit }
- pyramid: { groups:['0~4',…], male:[%], female:[%], unit:'%' }
- triangle: { points:[{label, a, b, c}], names:['1차','2차','3차'], unit:'%' }
- profile(지형 단면, 실제 표고): { from:[위도,경도], to:[위도,경도], labels:[{km, label:'A'}], vex } — 또는 points:[[km,m]…]
- landform(교과서식 모식도): { preset, labels:{ 부분이름:'A' } } — preset 과 부분: ${Object.entries(LANDFORM_PRESETS).map(([k, v]) => `${k}(${v.title}: ${v.parts.join('·')})`).join(' / ')}

map type 'contour'(등고선 지형도, 실제 표고): { type:'contour', bbox:[서경,남위,동경,북위], interval:m, index:5, points:[{lon,lat,label}], line:[[위도,경도],[위도,경도]](단면선), resolution:70 }
- 좁은 범위(가로 0.05~0.5°)가 알맞다. 표고는 Terrain Tiles(약 30m, 원자료 SRTM 등)라 아주 작은 지형(사구 등)은 안 보인다.
`;

return server;
}
