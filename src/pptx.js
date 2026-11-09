// 장면 → PPTX. 모든 도형은 PowerPoint 도형(자유형·사각형·타원·글상자)으로 들어가고 묶음(그룹)으로 묶인다.
import { zipSync, strToU8 } from 'fflate';
import { textWidth, DEFAULT_STYLE, bounds } from './scene.js';

const EMU = 36000; // 1mm
const e = (mm) => Math.round(mm * EMU);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (g) => g.replace('#', '').toUpperCase();
const PATT = { slash: 'wdUpDiag', backslash: 'wdDnDiag', cross: 'smGrid', diagcross: 'openDmnd', horz: 'narHorz', vert: 'narVert', dots: 'pct20' };

function fillXml(f) {
  if (!f || f.k === 'none') return '<a:noFill/>';
  if (f.k === 'solid') return `<a:solidFill><a:srgbClr val="${hex(f.gray)}"/></a:solidFill>`;
  return `<a:pattFill prst="${PATT[f.p] || 'wdUpDiag'}"><a:fgClr><a:srgbClr val="000000"/></a:fgClr><a:bgClr><a:srgbClr val="${hex(f.gray || '#FFFFFF')}"/></a:bgClr></a:pattFill>`;
}
function lnXml(w, o = {}) {
  if (!w) return '<a:ln><a:noFill/></a:ln>';
  const dash = o.dash ? `<a:prstDash val="${o.dash === true ? 'dash' : o.dash}"/>` : '';
  const tail = o.arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : '';
  return `<a:ln w="${e(w)}"><a:solidFill><a:srgbClr val="${hex(o.gray || '#000000')}"/></a:solidFill>${dash}<a:round/>${tail}</a:ln>`;
}

export function buildPptx(figs, opts = {}) {
  const style = { ...DEFAULT_STYLE, ...(opts.style || {}) };
  let id = 2;
  const nv = (name) => `<p:cNvPr id="${id++}" name="${esc(name || '도형')}"/>`;

  function path(points, closed) {
    const xs = points.flat().map((p) => p[0]), ys = points.flat().map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(Math.max(...xs) - x0, 0.01), h = Math.max(Math.max(...ys) - y0, 0.01);
    const sub = points.map((ring) => ring.map(([x, y], i) => `<a:${i ? 'lnTo' : 'moveTo'}><a:pt x="${e(x - x0)}" y="${e(y - y0)}"/></a:${i ? 'lnTo' : 'moveTo'}>`).join('') + (closed ? '<a:close/>' : '')).join('');
    return { x0, y0, w, h, geom: `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${e(w)}" h="${e(h)}"${closed ? '' : ' fill="none"'}>${sub}</a:path></a:pathLst></a:custGeom>` };
  }
  const grp = (name, items, kids) => {
    const b = bounds(items), o = `x="${e(b.x)}" y="${e(b.y)}"`, x = `cx="${e(Math.max(b.w, 0.01))}" cy="${e(Math.max(b.h, 0.01))}"`;
    return `<p:grpSp><p:nvGrpSpPr>${nv(name)}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off ${o}/><a:ext ${x}/><a:chOff ${o}/><a:chExt ${x}/></a:xfrm></p:grpSpPr>${kids}</p:grpSp>`;
  };
  const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${e(w)}" cy="${e(h)}"/></a:xfrm>`;

  function shape(it) {
    if (it.t === 'group') {
      if (!it.items.length) return ''; // 빈 묶음은 넣지 않는다(범위가 무한대가 되어 PowerPoint 가 파일을 거부함)
      const kids = it.items.map(shape).join('');
      return grp(it.name || '묶음', it.items, kids);
    }
    if (it.t === 'poly' || it.t === 'line') {
      const closed = it.t === 'poly';
      const p = path(closed ? it.rings : [it.pts], closed);
      return `<p:sp><p:nvSpPr>${nv(it.name || (closed ? '영역' : '선'))}<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(p.x0, p.y0, p.w, p.h)}${p.geom}${closed ? fillXml(it.fill) : '<a:noFill/>'}${lnXml(it.stroke, it)}</p:spPr></p:sp>`;
    }
    if (it.t === 'rect' || it.t === 'ellipse') {
      return `<p:sp><p:nvSpPr>${nv(it.name || it.t)}<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(it.x, it.y, Math.max(it.w, 0.01), Math.max(it.h, 0.01))}<a:prstGeom prst="${it.t}"><a:avLst/></a:prstGeom>${fillXml(it.fill)}${lnXml(it.stroke)}</p:spPr></p:sp>`;
    }
    if (it.t === 'text') {
      const w = textWidth(it.str, it.size) + 1.2, h = it.size * 0.3528 * 1.3;
      const x = it.anchor === 'l' ? it.x - 0.3 : it.anchor === 'r' ? it.x - w + 0.3 : it.x - w / 2;
      const y = it.v === 't' ? it.y : it.v === 'b' ? it.y - h : it.y - h / 2;
      const algn = { l: 'l', c: 'ctr', r: 'r' }[it.anchor];
      const box = it.box ? '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' : '<a:noFill/>';
      return `<p:sp><p:nvSpPr>${nv(it.name || `글자 ${it.str}`)}<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${box}</p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${algn}"/><a:r><a:rPr lang="ko-KR" sz="${Math.round(it.size * 100)}" b="${it.bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${hex(it.color || '#000000')}"/></a:solidFill><a:latin typeface="${esc(style.fontPptx || style.font)}"/><a:ea typeface="${esc(style.fontPptx || style.font)}"/></a:rPr><a:t>${esc(it.str)}</a:t></a:r></a:p></p:txBody></p:sp>`;
    }
    return '';
  }

  const M = 10; // 슬라이드 여백 mm
  const keyW = opts.keyText ? Math.max(...opts.keyText.split('\n').map((l, i) => textWidth(l, i ? 9 : 11) + 3)) : 0;
  const W = Math.max(...figs.map((f) => f.w), keyW) + 2 * M, H = Math.max(...figs.map((f) => f.h)) + 2 * M + 8;
  const slides = figs.map((f) => {
    id = 2;
    const moved = f.items.map((it) => moveIt(it, M, M + 8));
    const items = moved.map(shape).join('');
    const title = shape({ t: 'text', x: M, y: M, str: f.title || '', size: 9, bold: true, anchor: 'l', v: 't', name: '제목(지워도 됨)' });
    return slideXml(title + grp(f.title || '그림', moved, items));
  });
  if (opts.keyText) {
    id = 2;
    const lines = opts.keyText.split('\n');
    const body = lines.map((l, i) => shape({ t: 'text', x: M, y: M + i * 5, str: l, size: i ? 9 : 11, bold: i === 0, anchor: 'l', v: 't', name: '정답표' })).join('');
    slides.push(slideXml(body));
  }
  return zipSync(pptxParts(slides, e(W), e(Math.max(H, (opts.keyText ? opts.keyText.split('\n').length * 5 + 2 * M : 0)))), { level: 6 });
}

function moveIt(it, dx, dy) {
  if (it.t === 'group') return { ...it, items: it.items.map((c) => moveIt(c, dx, dy)) };
  if (it.t === 'poly') return { ...it, rings: it.rings.map((r) => r.map(([x, y]) => [x + dx, y + dy])) };
  if (it.t === 'line') return { ...it, pts: it.pts.map(([x, y]) => [x + dx, y + dy]) };
  return { ...it, x: it.x + dx, y: it.y + dy };
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const slideXml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

function pptxParts(slides, cx, cy) {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const f = {};
  f['[Content_Types].xml'] = `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  f['_rels/.rels'] = `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  f['docProps/app.xml'] = `${X}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>geo-figure-mcp</Application><Slides>${slides.length}</Slides></Properties>`;
  f['docProps/core.xml'] = `${X}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>지리 시험 자료</dc:title><dc:creator>geo-figure-mcp</dc:creator></cp:coreProperties>`;
  f['ppt/presentation.xml'] = `${X}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="ko-KR"/></a:defPPr></p:defaultTextStyle></p:presentation>`;
  f['ppt/_rels/presentation.xml.rels'] = `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${R}/theme" Target="theme/theme1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 3}" Type="${R}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`;
  const tree = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
  f['ppt/slideMasters/slideMaster1.xml'] = `${X}<p:sldMaster ${NS}>${tree}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
  f['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${R}/theme" Target="../theme/theme1.xml"/></Relationships>`;
  f['ppt/slideLayouts/slideLayout1.xml'] = `${X}<p:sldLayout ${NS} type="blank" preserve="1">${tree}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  f['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
  const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const fontSet = '<a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface=""/>';
  f['ppt/theme/theme1.xml'] = `${X}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="geo"><a:themeElements><a:clrScheme name="geo"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${clr('dk2', '44546A')}${clr('lt2', 'E7E6E6')}${clr('accent1', '4472C4')}${clr('accent2', 'ED7D31')}${clr('accent3', 'A5A5A5')}${clr('accent4', 'FFC000')}${clr('accent5', '5B9BD5')}${clr('accent6', '70AD47')}${clr('hlink', '0563C1')}${clr('folHlink', '954F72')}</a:clrScheme><a:fontScheme name="geo"><a:majorFont>${fontSet}</a:majorFont><a:minorFont>${fontSet}</a:minorFont></a:fontScheme><a:fmtScheme name="geo"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  slides.forEach((s, i) => {
    f[`ppt/slides/slide${i + 1}.xml`] = s;
    f[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
  });
  const out = {};
  for (const [k, v] of Object.entries(f)) out[k] = strToU8(v);
  return out;
}
