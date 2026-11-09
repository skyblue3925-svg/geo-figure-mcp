// 장면 → HWPX. 그림 한 장 = 한글 '묶음 개체' 하나. 안의 다각형·선·글상자는 묶음을 풀면 하나씩 고칠 수 있다.
// 글꼴은 한글 기본 글꼴(함초롬)을 기본으로 써서 어느 PC 에서도 바뀌지 않게 한다.
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { DEFAULT_STYLE, shift } from './scene.js';
// 한글 글꼴(함초롬) 폭 어림 — 잘리지 않게 넉넉히
const textWidth = (str, size) => [...String(str)].reduce((w, ch) => w + (/[ㄱ-힣一-鿿]/.test(ch) ? 1 : /[ ]/.test(ch) ? 0.4 : 0.62), 0) * size * 0.3528;

const TPL = new URL('../templates/hwpx/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, TPL), 'utf8');
const MM = 283.465;
const u = (mm) => Math.round(mm * MM);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HATCH = { slash: 'SLASH', backslash: 'BACK_SLASH', cross: 'CROSS', diagcross: 'CROSS_DIAGONAL', horz: 'HORIZONTAL', vert: 'VERTICAL' };
const PAGE_W = 59528, PAGE_H = 84186, ML = u(20), MT = u(15);

// 꺾은선 점 줄이기(거의 일직선인 점 제거) — 한글 선 개체 수를 줄인다
function simplifyLine(pts, tol = 0.05) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i], [x1, y1] = pts[a], [x2, y2] = pts[b];
      const d = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / (Math.hypot(x2 - x1, y2 - y1) || 1);
      if (d > md) { md = d; m = i; }
    }
    if (m > 0) { keep[m] = true; st.push([a, m], [m, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const ringArea = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
function inside([x, y], r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }

export function buildHwpx(figs, opts = {}) {
  const style = { ...DEFAULT_STYLE, ...(opts.style || {}) };
  let header = read('Contents/header.xml');
  // ---- 글꼴: 템플릿 0=함초롬돋움, 1=함초롬바탕. 다른 글꼴이면 추가한다
  const fontId = (face) => {
    const m = header.match(/<hh:fontface lang="HANGUL" fontCnt="\d+">([\s\S]*?)<\/hh:fontface>/);
    const found = [...m[1].matchAll(/<hh:font id="(\d+)" face="([^"]+)"/g)].find((x) => x[2] === face);
    if (found) return +found[1];
    let id;
    header = header.replace(/<hh:fontface lang="(\w+)" fontCnt="(\d+)">([\s\S]*?)<\/hh:fontface>/g, (all, lang, cnt, body) => {
      id = +cnt;
      return `<hh:fontface lang="${lang}" fontCnt="${id + 1}">${body}<hh:font id="${id}" face="${esc(face)}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font></hh:fontface>`;
    });
    return id;
  };
  const CH = new Map();
  const charPr = (size, bold, face = style.font) => {
    const k = `${size}|${bold}|${face}`;
    if (CH.has(k)) return CH.get(k);
    const f = fontId(face);
    const m = header.match(/<hh:charProperties itemCnt="(\d+)">/);
    const id = +m[1];
    const a = (v) => `hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"`;
    const xml = `<hh:charPr id="${id}" height="${Math.round(size * 100)}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2"><hh:fontRef ${a(f)}/><hh:ratio ${a(100)}/><hh:spacing ${a(0)}/><hh:relSz ${a(100)}/><hh:offset ${a(0)}/>${bold ? '<hh:bold/>' : ''}<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>`;
    header = header.replace(m[0], `<hh:charProperties itemCnt="${id + 1}">`).replace('</hh:charProperties>', xml + '</hh:charProperties>');
    CH.set(k, id);
    return id;
  };
  const PP = new Map();
  // fixed: 줄 높이를 HWPUNIT 로 고정(그림 자리 비우기)
  const paraPr = (align, line = 100, next = 0, fixed = 0) => {
    const k = `${align}|${line}|${next}|${fixed}`;
    if (PP.has(k)) return PP.get(k);
    const m = header.match(/<hh:paraProperties itemCnt="(\d+)">/);
    const id = +m[1];
    const mg = (s) => `<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="${next * s}" unit="HWPUNIT"/></hh:margin>${fixed ? `<hh:lineSpacing type="FIXED" value="${fixed * s}" unit="HWPUNIT"/>` : `<hh:lineSpacing type="PERCENT" value="${line}" unit="HWPUNIT"/>`}`;
    const xml = `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0" textDir="LTR"><hh:align horizontal="${align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${mg(1)}</hp:case><hp:default>${mg(2)}</hp:default></hp:switch><hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`;
    header = header.replace(m[0], `<hh:paraProperties itemCnt="${id + 1}">`).replace('</hh:paraProperties>', xml + '</hh:paraProperties>');
    PP.set(k, id);
    return id;
  };

  let nid = 1700000000;
  const next = () => ++nid;
  const I = 'e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"';
  const lineShape = (w, o = {}) => `<hp:lineShape color="${o.gray || '#000000'}" width="${w ? Math.max(u(w), 12) : 0}" style="${!w ? 'NONE' : o.dash ? 'DASH' : 'SOLID'}" endCap="FLAT" headStyle="NORMAL" tailStyle="${o.arrow ? 'ARROW' : 'NORMAL'}" headfill="1" tailfill="1" headSz="MEDIUM_MEDIUM" tailSz="MEDIUM_MEDIUM" outlineStyle="NORMAL" alpha="0"/>`;
  const fillBrush = (f) => {
    if (!f || f.k === 'none') return '';
    if (f.k === 'solid') return `<hc:fillBrush><hc:winBrush faceColor="${f.gray}" hatchColor="#000000" alpha="0"/></hc:fillBrush>`;
    return `<hc:fillBrush><hc:winBrush faceColor="${f.gray || '#FFFFFF'}" hatchColor="#000000" hatchStyle="${HATCH[f.p] || 'SLASH'}" alpha="0"/></hc:fillBrush>`;
  };
  const shadow = '<hp:shadow type="NONE" color="#B2B2B2" offsetX="0" offsetY="0" alpha="0"/>';
  // 묶음 안 개체의 공통 머리 — 위치는 '바로 위 묶음' 기준 offset 과 transMatrix 로 준다.
  // ctx: 지금 묶음의 원점(HWPUNIT)과 깊이. ext: 지금 묶음 안 개체들의 실제 범위(절대 좌표)
  // chain: 바깥부터 각 안쪽 묶음의 위치(바로 위 묶음 기준). 한글은 이 값을 단계별 scaMatrix 의 e3·e6 에 따로 적는다
  let ext = null, ctx = { ox: 0, oy: 0, level: 1, chain: [] };
  const mats = (level, chain) => Array.from({ length: level + 1 }, (_, k) => k >= 1 && k < level && chain[k - 1] ? `<hc:scaMatrix e1="1" e2="0" e3="${chain[k - 1][0]}" e4="0" e5="1" e6="${chain[k - 1][1]}"/><hc:rotMatrix ${I}/>` : `<hc:scaMatrix ${I}/><hc:rotMatrix ${I}/>`).join('');
  const grow = (X, Y, W, H) => { ext = ext ? [Math.min(ext[0], X), Math.min(ext[1], Y), Math.max(ext[2], X + W), Math.max(ext[3], Y + H)] : [X, Y, X + W, Y + H]; };
  const headU = (tag, Xa, Ya, W, H, extra = '') => {
    grow(Xa, Ya, W, H);
    const X = Xa - ctx.ox, Y = Ya - ctx.oy;
    return `<hp:${tag} id="0" zOrder="0" numberingType="NONE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="${ctx.level}" instid="${next()}"${extra}><hp:offset x="${X}" y="${Y}"/><hp:orgSz width="${W}" height="${H}"/><hp:curSz width="0" height="0"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(W / 2)}" centerY="${Math.round(H / 2)}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="${X}" e4="0" e5="1" e6="${Y}"/>${mats(ctx.level, ctx.chain)}</hp:renderingInfo>`;
  };
  const head = (tag, x, y, w, h, extra = '') => headU(tag, u(x), u(y), Math.max(u(w), 1), Math.max(u(h), 1), extra);
  const rectPts = (w, h) => `<hc:pt0 x="0" y="0"/><hc:pt1 x="${u(w)}" y="0"/><hc:pt2 x="${u(w)}" y="${u(h)}"/><hc:pt3 x="0" y="${u(h)}"/>`;

  const objs = []; // 평평하게 편 개체 XML
  function polygon(ring, fill, stroke, name) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    if (w < 0.05 && h < 0.05) return '';
    const r0 = simplifyLine(ring, 0.02), r = [...r0, r0[0]];
    if (r0.length < 3) return '';
    return head('polygon', x0, y0, w, h) + lineShape(stroke) + fillBrush(fill) + shadow + r.map(([x, y]) => `<hc:pt x="${u(x - x0)}" y="${u(y - y0)}"/>`).join('') + `</hp:polygon>`;
  }
  function seg(a, b, o) {
    const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
    return head('line', x0, y0, w, h, ' isReverseHV="0"') + lineShape(o.stroke, o) + shadow + `<hc:startPt x="${u(a[0] - x0)}" y="${u(a[1] - y0)}"/><hc:endPt x="${u(b[0] - x0)}" y="${u(b[1] - y0)}"/></hp:line>`;
  }
  function text(it) {
    // 한글은 글상자 밖으로 넘친 글자를 잘라 낸다 → 왼·오른쪽 정렬도 '추정 글자 가운데'에 놓고 가운데 정렬로 넉넉한 상자를 쓴다
    const est = textWidth(it.str, it.size) * 0.92;
    const cx = it.anchor === 'l' ? it.x + est / 2 : it.anchor === 'r' ? it.x - est / 2 : it.x;
    const w = textWidth(it.str, it.size) * 1.3 + 3, h = it.size * 0.3528 * 1.45;
    const x = cx - w / 2;
    const y = it.v === 't' ? it.y : it.v === 'b' ? it.y - h : it.y - h / 2;
    const align = 'CENTER';
    let bx = x, bw = w;
    const body = `<hp:p id="0" paraPrIDRef="${paraPr(align)}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${charPr(it.size, it.bold)}"><hp:t>${esc(it.str)}</hp:t></hp:run></hp:p>`;
    const out = head('rect', bx, y, bw, h, ' ratio="0"') + lineShape(0) + (it.box ? fillBrush({ k: 'solid', gray: '#FFFFFF' }) : '') + shadow + `<hp:drawText lastWidth="${u(bw)}" name="" editable="0"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${body}</hp:subList><hp:textMargin left="0" right="0" top="0" bottom="0"/></hp:drawText>` + rectPts(bw, h) + '</hp:rect>';
    if (it.box) {
      // 흰 바탕 상자는 글자 크기에 맞게 좁힌다
      const tw = textWidth(it.str, it.size) + 1.6, nx = it.anchor === 'l' ? it.x - 0.3 : it.anchor === 'r' ? it.x - tw + 0.3 : it.x - tw / 2;
      return head('rect', nx, y, tw, h, ' ratio="0"') + lineShape(0) + fillBrush({ k: 'solid', gray: '#FFFFFF' }) + shadow + `<hp:drawText lastWidth="${u(tw)}" name="" editable="0"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${body.replace(`paraPrIDRef="${paraPr(align)}"`, `paraPrIDRef="${paraPr('CENTER')}"`)}</hp:subList><hp:textMargin left="0" right="0" top="0" bottom="0"/></hp:drawText>` + rectPts(tw, h) + '</hp:rect>';
    }
    return out;
  }
  // 묶음 → 한글 묶음 개체(최대 3단). 이름 있는 묶음(범례·기호·막대 …)을 그대로 살린다
  const MAX_LEVEL = +(process.env.HWPX_MAX_LEVEL || 3);
  function emitInto(items, sortPolys) {
    const polys = items.filter((c) => c.t === 'poly');
    if (sortPolys && polys.length > 1 && polys.length === items.length) {
      const parts = polys.flatMap((p) => p.rings.filter((r, i) => !p.rings.some((o, j) => j !== i && ringArea(o) > ringArea(r) && inside(r[0], o))).map((r) => ({ r, p })));
      parts.sort((a, b) => ringArea(b.r) - ringArea(a.r)).forEach(({ r, p }) => objs.push(polygon(r, p.fill, p.stroke, p.name)));
    } else items.forEach(emit);
  }
  function emit(it) {
    if (it.t === 'group') {
      const drawable = it.items.filter(Boolean);
      if (ctx.level >= MAX_LEVEL || drawable.length < 2) return emitInto(drawable, true);
      // 1차: 절대 좌표로 범위만 잰다
      const saveObjs = objs.splice(0), saveExt = ext, saveCtx = ctx;
      ext = null; ctx = { ...saveCtx, level: saveCtx.level + 1, chain: [...saveCtx.chain, [0, 0]] };
      emitInto(drawable, true);
      const box = ext;
      objs.length = 0;
      if (!box) { objs.push(...saveObjs); ext = saveExt; ctx = saveCtx; return; }
      // 2차: 묶음 원점 기준으로 다시 만든다
      ext = null; ctx = { ox: box[0], oy: box[1], level: saveCtx.level + 1, chain: [...saveCtx.chain, [box[0] - saveCtx.ox, box[1] - saveCtx.oy]] };
      emitInto(drawable, true);
      const kids = objs.splice(0);
      objs.push(...saveObjs); ext = saveExt; ctx = saveCtx;
      const W = Math.max(box[2] - box[0], 1), H = Math.max(box[3] - box[1], 1);
      objs.push(headU('container', box[0], box[1], W, H).replace(' numberingType="NONE"', ' numberingType="NONE"') + kids.join('') + `<hp:shapeComment>${esc(it.name || '묶음')}</hp:shapeComment></hp:container>`);
      return;
    }
    if (it.t === 'poly') return it.rings.filter((r, i) => !it.rings.some((o, j) => j !== i && ringArea(o) > ringArea(r) && inside(r[0], o))).forEach((r) => objs.push(polygon(r, it.fill, it.stroke, it.name)));
    if (it.t === 'line') {
      const pts = simplifyLine(it.pts);
      for (let i = 1; i < pts.length; i++) objs.push(seg(pts[i - 1], pts[i], { ...it, arrow: it.arrow && i === pts.length - 1 }));
      return;
    }
    if (it.t === 'rect' || it.t === 'ellipse') {
      return objs.push(head('rect', it.x, it.y, it.w, it.h, ` ratio="${it.t === 'ellipse' ? 50 : 0}"`) + lineShape(it.stroke) + fillBrush(it.fill) + shadow + rectPts(it.w, it.h) + '</hp:rect>');
    }
    if (it.t === 'text') objs.push(text(it));
  }

  const P = (inner, pp) => `<hp:p id="0" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p>`;
  const cTitle = charPr(10, true), cBody = charPr(10, false);
  const body = [];
  figs.forEach((f, k) => {
    // 개체가 묶음 밖으로 나가면 한글이 묶음을 줄여 버린다 → 실제 범위를 재고, 음수면 옮겨서 다시 만든다
    // 한글은 '하나짜리 묶음'을 풀지 못한다 → 그림 안이 묶음 하나뿐이면 한 겹 벗긴다
    let items = f.items;
    while (items.length === 1 && items[0].t === 'group') items = items[0].items;
    objs.length = 0; ext = null;
    items.forEach(emit);
    if (ext[0] < 0 || ext[1] < 0) {
      const dx = Math.max(0, -ext[0]) / MM, dy = Math.max(0, -ext[1]) / MM;
      objs.length = 0; ext = null;
      shift(items, dx, dy).forEach(emit);
    }
    const W = Math.max(u(f.w), ext[2]), H = Math.max(u(f.h), ext[3]);
    const cont = `<hp:container id="${next()}" zOrder="${k}" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${next()}"><hp:offset x="0" y="0"/><hp:orgSz width="${W}" height="${H}"/><hp:curSz width="0" height="0"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(W / 2)}" centerY="${Math.round(H / 2)}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix ${I}/><hc:scaMatrix ${I}/><hc:rotMatrix ${I}/></hp:renderingInfo>${objs.join('')}<hp:sz width="${W}" widthRelTo="ABSOLUTE" height="${H}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="${u(4)}"/><hp:shapeComment>${esc(f.title || '그림')}</hp:shapeComment></hp:container>`;
    const first = k === 0 ? secPr() : '';
    body.push(P(`<hp:run charPrIDRef="${cTitle}">${first}<hp:t>${esc(f.title || '')}</hp:t></hp:run>`, paraPr('LEFT', 130, u(2))));
    // 그림은 '글 앞으로' 띄우고, 그림 높이만큼 고정 높이 문단으로 자리를 비운다 → 묶음을 풀어도 조각이 밀리지 않는다
    body.push(P(`<hp:run charPrIDRef="${cBody}">${cont}<hp:t/></hp:run>`, paraPr('LEFT', 100, u(8), H)));
  });
  if (opts.keyText) {
    opts.keyText.split('\n').forEach((l, i) => body.push(`<hp:p id="0" paraPrIDRef="${paraPr('LEFT', 150)}" styleIDRef="0" pageBreak="${i === 0 ? 1 : 0}" columnBreak="0" merged="0"><hp:run charPrIDRef="${i === 0 ? cTitle : cBody}"><hp:t>${esc(l)}</hp:t></hp:run></hp:p>`));
  }

  const NS = header.match(/<hh:head (.*?) version=/)[1];
  const sec = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${NS}>${body.join('')}</hs:sec>`;
  const hpf = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>지리 시험 자료</opf:title><opf:language>ko</opf:language></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
  const files = {
    mimetype: [strToU8('application/hwp+zip'), { level: 0 }],
    'version.xml': strToU8(read('version.xml')),
    'Contents/header.xml': strToU8(header),
    'Contents/section0.xml': strToU8(sec),
    'Contents/content.hpf': strToU8(hpf),
    'settings.xml': strToU8(read('settings.xml')),
    'META-INF/container.xml': strToU8(read('META-INF/container.xml')),
    'META-INF/manifest.xml': strToU8(read('META-INF/manifest.xml')),
    'META-INF/container.rdf': strToU8(read('META-INF/container.rdf')),
    'Preview/PrvText.txt': strToU8(figs.map((f) => f.title).join('\n')),
  };
  return zipSync(files, { level: 6 });
}

function secPr() {
  return '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">'
    + '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>'
    + '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>'
    + '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>'
    + `<hp:pagePr landscape="WIDELY" width="${PAGE_W}" height="${PAGE_H}" gutterType="LEFT_ONLY"><hp:margin header="${u(5)}" footer="${u(7)}" gutter="0" left="${ML}" right="${ML}" top="${MT}" bottom="${MT}"/></hp:pagePr>`
    + '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>'
    + '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>'
    + ['BOTH', 'EVEN', 'ODD'].map((t) => `<hp:pageBorderFill type="${t}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`).join('')
    + '</hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>';
}
