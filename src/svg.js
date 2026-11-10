// 미리보기(시안): 장면 → SVG → PNG. 파일을 만들기 전에 교사에게 그림을 바로 보여 주려고 쓴다.
import { Resvg } from '@resvg/resvg-js';
import { DEFAULT_STYLE } from './scene.js';

const PT = 0.3528; // 1pt = 0.3528mm
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PATTERNS = {
  slash: '<path d="M0,2 L2,0" stroke="#000" stroke-width="0.18"/>',
  backslash: '<path d="M0,0 L2,2" stroke="#000" stroke-width="0.18"/>',
  cross: '<path d="M1,0 V2 M0,1 H2" stroke="#000" stroke-width="0.15"/>',
  diagcross: '<path d="M0,2 L2,0 M0,0 L2,2" stroke="#000" stroke-width="0.15"/>',
  horz: '<path d="M0,1 H2" stroke="#000" stroke-width="0.18"/>',
  vert: '<path d="M1,0 V2" stroke="#000" stroke-width="0.18"/>',
  dots: '<circle cx="1" cy="1" r="0.25" fill="#000"/>',
};
const FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans CJK KR','Noto Sans KR',sans-serif";

export function buildSvg(fig, style = DEFAULT_STYLE) {
  const defs = new Map();
  const fill = (f) => {
    if (!f || f.k === 'none') return 'none';
    if (f.k === 'solid') return f.gray || '#000';
    const id = `p_${f.p}_${(f.gray || '#FFFFFF').slice(1)}`;
    if (!defs.has(id)) defs.set(id, `<pattern id="${id}" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${f.gray || '#FFF'}"/>${PATTERNS[f.p] || PATTERNS.slash}</pattern>`);
    return `url(#${id})`;
  };
  const sw = (w) => (w ? `stroke="#000" stroke-width="${w * PT}"` : 'stroke="none"');
  const out = [];
  const emit = (it) => {
    if (it.t === 'group') return it.items.forEach(emit);
    if (it.t === 'poly') return out.push(`<path d="${it.rings.map((r) => 'M' + r.map((p) => p.map((v) => v.toFixed(2)).join(',')).join('L') + 'Z').join('')}" fill="${fill(it.fill)}" fill-rule="evenodd" ${sw(it.stroke)}${it.dash ? ' stroke-dasharray="1,0.6"' : ''}/>`);
    if (it.t === 'line') return out.push(`<polyline points="${it.pts.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ')}" fill="none" stroke="${it.gray || '#000'}" stroke-width="${(it.stroke || 0.25) * PT}"${it.dash ? ' stroke-dasharray="1,0.6"' : ''}${it.arrow ? ' marker-end="url(#arrow)"' : ''}/>`);
    if (it.t === 'rect') return out.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${fill(it.fill)}" ${sw(it.stroke)}/>`);
    if (it.t === 'ellipse') return out.push(`<ellipse cx="${it.x + it.w / 2}" cy="${it.y + it.h / 2}" rx="${it.w / 2}" ry="${it.h / 2}" fill="${fill(it.fill)}" ${sw(it.stroke)}/>`);
    if (it.t === 'text') {
      const size = it.size * PT;
      const anchor = it.anchor === 'l' ? 'start' : it.anchor === 'r' ? 'end' : 'middle';
      const dy = it.v === 't' ? size * 0.8 : it.v === 'b' ? 0 : size * 0.35;
      if (it.box) { const w = it.str.length * size * 0.75 + 0.6, x0 = it.anchor === 'l' ? it.x - 0.3 : it.anchor === 'r' ? it.x - w + 0.3 : it.x - w / 2; out.push(`<rect x="${x0}" y="${it.y + dy - size * 0.95}" width="${w}" height="${size * 1.25}" fill="#FFF"/>`); }
      return out.push(`<text x="${it.x}" y="${it.y + dy}" font-size="${size}" font-family="${FONT}" font-weight="${it.bold ? 700 : 400}" text-anchor="${anchor}" fill="${it.color || '#000'}">${esc(it.str)}</text>`);
    }
  };
  fig.items.forEach(emit);
  const W = fig.w, H = fig.h;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><defs>${[...defs.values()].join('')}<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs><rect width="${W}" height="${H}" fill="#FFF"/>${out.join('')}</svg>`;
}

// PNG(가로 px). 글꼴은 이 컴퓨터에 깔린 한글 글꼴을 쓴다.
export function renderPng(fig, { width = 900, style } = {}) {
  const r = new Resvg(buildSvg(fig, style), { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true, defaultFontFamily: process.platform === 'linux' ? 'Noto Sans CJK KR' : 'Malgun Gothic' }, background: '#FFFFFF' });
  return r.render().asPng();
}
