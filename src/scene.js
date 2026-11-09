// 장면 모델: 모든 그림은 mm 단위 도형 목록으로 만든 뒤 PPTX·HWPX 로 옮긴다.
// 도형: poly(다각형, rings) / line(꺾은선·화살표) / rect / ellipse / text / group
// 채우기: { k:'none' } | { k:'solid', gray:'#RRGGBB' } | { k:'hatch', p:'slash'|'backslash'|'cross'|'diagcross'|'horz'|'vert', gray? }

// 흑백 인쇄에서 구분되는 단계 채우기(밝음 → 어두움). 색에 기대지 않는다.
export const CLASS_FILLS = [
  { k: 'solid', gray: '#FFFFFF' },
  { k: 'hatch', p: 'slash', gray: '#FFFFFF' },
  { k: 'solid', gray: '#C8C8C8' },
  { k: 'hatch', p: 'cross', gray: '#FFFFFF' },
  { k: 'solid', gray: '#8C8C8C' },
  { k: 'solid', gray: '#404040' },
];
// 계열(막대·범례)용 채우기 — 이웃끼리 헷갈리지 않는 순서
export const SERIES_FILLS = [
  { k: 'solid', gray: '#404040' },
  { k: 'solid', gray: '#FFFFFF' },
  { k: 'hatch', p: 'slash', gray: '#FFFFFF' },
  { k: 'solid', gray: '#A6A6A6' },
  { k: 'hatch', p: 'cross', gray: '#FFFFFF' },
  { k: 'hatch', p: 'horz', gray: '#FFFFFF' },
  { k: 'solid', gray: '#D9D9D9' },
];

// font: 한글(HWPX)용(한글 설치 PC면 어디서나 있음), fontPptx: PowerPoint용(모든 한국어 윈도에 있는 맑은 고딕)
export const DEFAULT_STYLE = { font: '함초롬돋움', fontPptx: '맑은 고딕', fontBody: '함초롬바탕', size: 8, small: 7, line: 0.25, width: 82.5 };

export const S = {
  poly: (rings, o = {}) => ({ t: 'poly', rings, fill: o.fill || { k: 'none' }, stroke: o.stroke ?? 0.2, dash: o.dash, name: o.name }),
  line: (pts, o = {}) => ({ t: 'line', pts, stroke: o.stroke ?? 0.25, dash: o.dash, arrow: o.arrow, gray: o.gray || '#000000', name: o.name }),
  rect: (x, y, w, h, o = {}) => ({ t: 'rect', x, y, w, h, fill: o.fill || { k: 'none' }, stroke: o.stroke ?? 0.2, name: o.name }),
  dot: (x, y, r, o = {}) => ({ t: 'ellipse', x: x - r, y: y - r, w: 2 * r, h: 2 * r, fill: o.fill || { k: 'solid', gray: '#000000' }, stroke: o.stroke ?? 0, name: o.name }),
  ellipse: (x, y, w, h, o = {}) => ({ t: 'ellipse', x, y, w, h, fill: o.fill || { k: 'none' }, stroke: o.stroke ?? 0.2, name: o.name }),
  // anchor: 'l' | 'c' | 'r' ; v: 't' | 'm' | 'b' — (x,y) 는 기준점
  text: (x, y, str, o = {}) => ({ t: 'text', x, y, str: String(str), size: o.size || 8, bold: !!o.bold, anchor: o.anchor || 'c', v: o.v || 'm', box: !!o.box, color: o.color, name: o.name }),
  group: (name, items, o = {}) => ({ t: 'group', name, items: items.filter(Boolean), keep: !!o.keep }),
};

// 글자 폭 추정(mm). 한글은 정사각에 가깝고 영문·숫자는 약 0.55
export function textWidth(str, size) {
  const pt2mm = 0.3528;
  let w = 0;
  for (const ch of String(str)) w += /[ㄱ-힣一-鿿㉠-㉿①-⑳○●◎◇◆□■△▲▽▼]/.test(ch) ? 1 : /[ .,:;|il1]/.test(ch) ? 0.32 : 0.56;
  return w * size * pt2mm;
}

// 장면 전체의 경계 상자
export function bounds(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const walk = (it) => {
    if (it.t === 'group') return it.items.forEach(walk);
    if (it.t === 'poly') return it.rings.forEach((r) => r.forEach(([x, y]) => add(x, y)));
    if (it.t === 'line') return it.pts.forEach(([x, y]) => add(x, y));
    if (it.t === 'text') {
      const w = textWidth(it.str, it.size), h = it.size * 0.3528 * 1.25;
      const x = it.anchor === 'l' ? it.x : it.anchor === 'r' ? it.x - w : it.x - w / 2;
      const y = it.v === 't' ? it.y : it.v === 'b' ? it.y - h : it.y - h / 2;
      add(x, y); add(x + w, y + h); return;
    }
    add(it.x, it.y); add(it.x + it.w, it.y + it.h);
  };
  items.forEach(walk);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// 장면을 (0,0) 기준으로 옮긴다
export function shift(items, dx, dy) {
  const mv = (it) => {
    if (it.t === 'group') return { ...it, items: it.items.map(mv) };
    if (it.t === 'poly') return { ...it, rings: it.rings.map((r) => r.map(([x, y]) => [x + dx, y + dy])) };
    if (it.t === 'line') return { ...it, pts: it.pts.map(([x, y]) => [x + dx, y + dy]) };
    return { ...it, x: it.x + dx, y: it.y + dy };
  };
  return items.map(mv);
}

// 그림 한 장 = { title, items, w, h, source, notes, key }
export function figure({ title, items, source, notes = [], key = null, pad = 1 }) {
  const b = bounds(items);
  return { title, items: shift(items, pad - b.x, pad - b.y), w: b.w + 2 * pad, h: b.h + 2 * pad, source, notes, key };
}

// 출처·주석을 그림 아래(오른쪽 정렬)에 붙인다 — 교육청 지침: 출처는 자료 오른쪽 아래
export function withFooter(fig, style = DEFAULT_STYLE) {
  const items = [...fig.items];
  let y = fig.h + 1.2;
  for (const n of fig.notes || []) { items.push(S.text(0.5, y, n, { size: style.small, anchor: 'l', v: 't', name: '주석' })); y += style.small * 0.3528 * 1.35; }
  if (fig.source) {
    // 출처가 그림보다 길면 '; ' 단위로 여러 줄로 나눈다(그림이 옆으로 밀리지 않게)
    const lines = [];
    for (const part of String(fig.source).split(/;\s*|,\s+(?=\S)/)) {
      const last = lines.at(-1);
      if (last && textWidth(`${last}, ${part}`, style.small) <= fig.w - 1) lines[lines.length - 1] = `${last}, ${part}`;
      else lines.push(part);
    }
    lines.forEach((l, i) => items.push(S.text(fig.w - 0.5, y + i * style.small * 0.3528 * 1.35, l, { size: style.small, anchor: 'r', v: 't', name: '출처' })));
  }
  return figure({ ...fig, items, pad: 0.5 });
}

// 지도 기호 글자. style: 'halo'(글자 둘레 흰 테두리, 기본) | 'plain'(바탕 없음) | 'box'(네모 흰 바탕) | 'circle'(작은 원 흰 바탕)
// halo·circle 은 글자와 바탕이 함께 움직이도록 작은 묶음 하나로 둔다(그림 묶음을 풀어도 기호마다 한 덩어리)
export const LABEL_STYLES = ['halo', 'plain', 'box', 'circle'];
export function labelShape(x, y, str, o = {}, style = 'halo') {
  const name = o.name || `기호 ${str}`;
  if (style === 'plain') return S.text(x, y, str, { ...o, name });
  if (style === 'box') return S.text(x, y, str, { ...o, box: true, name });
  const anchorDx = o.anchor === 'l' ? textWidth(str, o.size || 8) / 2 : o.anchor === 'r' ? -textWidth(str, o.size || 8) / 2 : 0;
  if (style === 'circle') {
    const r = Math.max(textWidth(str, o.size || 8), (o.size || 8) * 0.3528) / 2 + 0.5;
    return S.group(name, [S.ellipse(x + anchorDx - r, y - r, 2 * r, 2 * r, { fill: { k: 'solid', gray: '#FFFFFF' }, stroke: 0, name: `${name} 바탕` }), S.text(x, y, str, { ...o, name })], { keep: true });
  }
  const d = 0.28, k = [];
  for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d * 0.7, d * 0.7], [-d * 0.7, d * 0.7], [d * 0.7, -d * 0.7], [-d * 0.7, -d * 0.7]]) k.push(S.text(x + dx, y + dy, str, { ...o, color: '#FFFFFF', name: `${name} 테두리` }));
  return S.group(name, [...k, S.text(x, y, str, { ...o, name })], { keep: true });
}
