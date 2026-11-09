// 수능형 그래프 → 장면 도형. 눈금선 최소, 장식 없음, 흑백 구분, 범례는 그래프 위.
import { S, SERIES_FILLS, DEFAULT_STYLE, textWidth } from './scene.js';

export function niceTicks(min, max, n = 5) {
  if (min === max) max = min + 1;
  const span = max - min, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) t.push(+v.toFixed(10));
  return t;
}
const fmt = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(+v.toFixed(2)));

function legend(series, x, y, st, fills = SERIES_FILLS) {
  const items = [];
  let cx = x;
  series.forEach((s, i) => {
    items.push(S.rect(cx, y - 1.4, 2.8, 2.8, { fill: s.fill || fills[i % fills.length], stroke: 0.2, name: `범례 칸 ${s.name}` }));
    items.push(S.text(cx + 3.6, y, s.name, { size: st.small, anchor: 'l', name: `범례 ${s.name}` }));
    cx += 3.6 + textWidth(s.name, st.small) + 3;
  });
  return S.group('범례', items);
}

function yAxis(x, y0, y1, ticks, scale, st, unit, side = 'l') {
  const it = [S.line([[x, y0], [x, y1]], { stroke: st.line, name: '축' })];
  for (const t of ticks) {
    const y = scale(t);
    it.push(S.line(side === 'l' ? [[x - 1, y], [x, y]] : [[x, y], [x + 1, y]], { stroke: st.line, name: '눈금' }));
    it.push(S.text(side === 'l' ? x - 1.5 : x + 1.5, y, fmt(t), { size: st.small, anchor: side === 'l' ? 'r' : 'l', name: '눈금 값' }));
  }
  if (unit) it.push(S.text(x, y1 - 3, unit, { size: st.small, anchor: side === 'l' ? 'r' : 'l', name: '단위' }));
  return S.group(side === 'l' ? '세로축' : '오른쪽 세로축', it);
}

// 막대 / 누적 막대 (세로). spec: { categories, series:[{name, values}], stacked, unit, max, valueLabels: 'none'|'last'|'all', percent }
export function barChart(spec, st = DEFAULT_STYLE) {
  const W = spec.width || st.width, H = spec.height || 52;
  const L = 11, T = spec.series.length > 1 ? 9 : 5, B = 7, R = 2;
  const cats = spec.categories, n = cats.length, ns = spec.series.length;
  const tot = cats.map((_, i) => spec.series.reduce((a, s) => a + (+s.values[i] || 0), 0));
  const vmax = spec.max ?? (spec.stacked ? Math.max(...tot) : Math.max(...spec.series.flatMap((s) => s.values.map(Number))));
  const vmin = Math.min(0, ...spec.series.flatMap((s) => s.values.map(Number)));
  const ticks = niceTicks(vmin, vmax, 5);
  const y0 = T, y1 = H - B, sc = (v) => y1 - ((v - ticks[0]) / (ticks.at(-1) - ticks[0])) * (y1 - y0);
  const items = [yAxis(L, y1, y0, ticks, sc, st, spec.unit)];
  items.push(S.line([[L, sc(0)], [W - R, sc(0)]], { stroke: st.line, name: '가로축' }));
  const band = (W - R - L) / n, bw = spec.stacked ? band * 0.5 : (band * 0.7) / ns;
  cats.forEach((c, i) => {
    const bars = [];
    let acc = 0;
    spec.series.forEach((s, k) => {
      const v = +s.values[i] || 0, fill = s.fill || SERIES_FILLS[k % SERIES_FILLS.length];
      const x = spec.stacked ? L + band * i + (band - bw) / 2 : L + band * i + band * 0.15 + bw * k;
      const a = spec.stacked ? acc : 0, b = a + v;
      acc = b;
      const top = sc(Math.max(a, b)), bot = sc(Math.min(a, b));
      bars.push(S.rect(x, top, bw, bot - top, { fill, stroke: 0.2, name: `${c} ${s.name}` }));
      const show = spec.valueLabels === 'all' || (spec.valueLabels === 'last' && k === ns - 1);
      if (show && v && (!spec.stacked || bot - top >= 3.2)) bars.push(S.text(x + bw / 2, spec.stacked ? (top + bot) / 2 : top - 1.8, fmt(v), { size: st.small - 0.5, box: spec.stacked, name: '값' }));
    });
    bars.push(S.text(L + band * i + band / 2, y1 + 3.2, c, { size: st.small, name: `항목 ${c}` }));
    items.push(S.group(`막대 ${c}`, bars));
  });
  if (ns > 1) items.push(legend(spec.series, L, 2.5, st));
  return items;
}

// 산점도·버블. spec: { points:[{label,x,y,size?}], xLabel, yLabel, xTicks?, yTicks?, sizeLabel }
export function scatterChart(spec, st = DEFAULT_STYLE) {
  const W = spec.width || st.width, H = spec.height || 62;
  const L = 11, T = 6, B = 10, R = 4;
  const xs = spec.points.map((p) => +p.x), ys = spec.points.map((p) => +p.y);
  const pad = (a, b) => [a - (b - a) * 0.08, b + (b - a) * 0.08];
  const xt = spec.xTicks || niceTicks(...pad(Math.min(...xs), Math.max(...xs)), 5);
  const yt = spec.yTicks || niceTicks(...pad(Math.min(...ys), Math.max(...ys)), 5);
  const sx = (v) => L + ((v - xt[0]) / (xt.at(-1) - xt[0])) * (W - R - L);
  const sy = (v) => H - B - ((v - yt[0]) / (yt.at(-1) - yt[0])) * (H - B - T);
  const items = [yAxis(L, H - B, T, yt, sy, st, spec.yLabel)];
  const xa = [S.line([[L, H - B], [W - R, H - B]], { stroke: st.line, name: '축' })];
  for (const t of xt) { xa.push(S.line([[sx(t), H - B], [sx(t), H - B + 1]], { stroke: st.line, name: '눈금' })); xa.push(S.text(sx(t), H - B + 3, fmt(t), { size: st.small, name: '눈금 값' })); }
  if (spec.xLabel) xa.push(S.text(W - R, H - B + 6.8, spec.xLabel, { size: st.small, anchor: 'r', name: '가로축 이름' }));
  items.push(S.group('가로축', xa));
  const smax = Math.max(...spec.points.map((p) => +p.size || 0));
  spec.points.forEach((p) => {
    const r = p.size ? 1 + 4 * Math.sqrt(+p.size / smax) : 0.9;
    const cx = sx(+p.x), cy = sy(+p.y);
    const g = [p.size ? S.ellipse(cx - r, cy - r, 2 * r, 2 * r, { fill: { k: 'solid', gray: '#D9D9D9' }, stroke: 0.25, name: '원' }) : S.dot(cx, cy, r, { name: '점' })];
    g.push(S.text(cx + r + 0.8, cy - r * 0.3 - 0.6, p.label, { size: st.size, bold: true, anchor: 'l', name: `기호 ${p.label}` }));
    items.push(S.group(`점 ${p.label}`, g));
  });
  if (spec.sizeLabel) items.push(S.text(W - R, T - 3, `* 원의 크기는 ${spec.sizeLabel}`, { size: st.small - 0.5, anchor: 'r', name: '원 크기 설명' }));
  return items;
}

// 기후 그래프(월 강수 막대 + 기온 꺾은선), 지점 여러 개는 2열로 나란히.
// spec: { stations:[{label, temp[12], precip[12]}], tRange:[min,max], pRange:[0,max] }
export function climateChart(spec, st = DEFAULT_STYLE) {
  const cols = spec.cols || (spec.stations.length > 1 ? 2 : 1);
  const cw = (spec.width || st.width) / cols, ch = spec.cellHeight || 38;
  const allT = spec.stations.flatMap((s) => s.temp), allP = spec.stations.flatMap((s) => s.precip);
  const tt = niceTicks(Math.min(spec.tRange?.[0] ?? 0, ...allT), Math.max(spec.tRange?.[1] ?? -99, ...allT), 4);
  const pt = niceTicks(0, Math.max(spec.pRange?.[1] ?? 0, ...allP), tt.length - 1);
  const items = [];
  spec.stations.forEach((s, i) => {
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
    const L = ox + 9, R = ox + cw - 9, T = oy + 7, B = oy + ch - 6;
    const sy = (v) => B - ((v - tt[0]) / (tt.at(-1) - tt[0])) * (B - T);
    const sp = (v) => B - (v / pt.at(-1)) * (B - T);
    const g = [S.text((L + R) / 2, oy + 2.5, s.label, { size: st.size, bold: true, name: `지점 ${s.label}` })];
    g.push(yAxis(L, B, T, tt, sy, st, i === 0 ? '(℃)' : ''));
    g.push(yAxis(R, B, T, pt, sp, st, i === cols - 1 ? '(mm)' : '', 'r'));
    g.push(S.line([[L, B], [R, B]], { stroke: st.line, name: '가로축' }));
    const bw = (R - L) / 12;
    const bars = s.precip.map((p, m) => S.rect(L + bw * m + bw * 0.15, sp(p), bw * 0.7, B - sp(p), { fill: { k: 'solid', gray: '#BFBFBF' }, stroke: 0.15, name: `${m + 1}월 강수` }));
    g.push(S.group('강수량 막대', bars));
    g.push(S.line(s.temp.map((t, m) => [L + bw * m + bw / 2, sy(t)]), { stroke: 0.45, name: '기온 선' }));
    [1, 4, 7, 10, 12].forEach((m) => g.push(S.text(L + bw * (m - 1) + bw / 2, B + 2.4, String(m), { size: st.small - 1, name: '월' })));
    items.push(S.group(`기후 그래프 ${s.label}`, g));
  });
  items.push(S.group('범례', [
    S.line([[1, -2.2], [5, -2.2]], { stroke: 0.45, name: '범례 선' }), S.text(5.8, -2.2, '기온', { size: st.small, anchor: 'l' }),
    S.rect(14, -3.6, 2.8, 2.8, { fill: { k: 'solid', gray: '#BFBFBF' }, stroke: 0.15 }), S.text(17.6, -2.2, '강수량', { size: st.small, anchor: 'l' }),
  ]));
  return items;
}

// 편차 그래프: 기준값과의 차이 막대 (0선 강조). spec: { categories, series:[{name, values}], base, unit }
export function deviationChart(spec, st = DEFAULT_STYLE) {
  const items = barChart({ ...spec, stacked: false }, st);
  items.push(S.text(spec.width || st.width, 2.5, `* 0 = ${spec.base}`, { size: st.small - 0.5, anchor: 'r', name: '기준 설명' }));
  return items;
}

// 인구 피라미드. spec: { groups:[연령 라벨(아래→위)], male[], female[], unit:'%' }
export function pyramidChart(spec, st = DEFAULT_STYLE) {
  const W = spec.width || 60, H = spec.height || 50, mid = W / 2, gap = 7, B = 7, T = 5;
  const n = spec.groups.length, bh = (H - B - T) / n;
  const vmax = spec.max || Math.max(...spec.male, ...spec.female);
  const ticks = niceTicks(0, vmax, 3);
  const sw = (v) => (v / ticks.at(-1)) * (mid - gap / 2 - 2);
  const items = [];
  spec.groups.forEach((g, i) => {
    const y = H - B - bh * (i + 1);
    items.push(S.rect(mid - gap / 2 - sw(spec.male[i]), y, sw(spec.male[i]), bh, { fill: { k: 'solid', gray: '#A6A6A6' }, stroke: 0.15, name: `남 ${g}` }));
    items.push(S.rect(mid + gap / 2, y, sw(spec.female[i]), bh, { fill: { k: 'solid', gray: '#FFFFFF' }, stroke: 0.15, name: `여 ${g}` }));
    if (i % (spec.labelEvery || 2) === 0) items.push(S.text(mid, y + bh / 2, g, { size: st.small - 1, name: '연령' }));
  });
  const ax = [S.line([[2, H - B], [W - 2, H - B]], { stroke: st.line, name: '축' })];
  ticks.forEach((t) => { [mid - gap / 2 - sw(t), mid + gap / 2 + sw(t)].forEach((x) => { ax.push(S.line([[x, H - B], [x, H - B + 1]], { stroke: st.line })); ax.push(S.text(x, H - B + 3, fmt(t), { size: st.small - 1 })); }); });
  items.push(S.group('가로축', ax));
  items.push(S.text(mid - gap, 2, '남', { size: st.small, anchor: 'r' }), S.text(mid + gap, 2, '여', { size: st.small, anchor: 'l' }));
  if (spec.unit) items.push(S.text(W - 2, H - 1.5, `(${spec.unit})`, { size: st.small - 1, anchor: 'r' }));
  return items;
}

// 삼각 그래프. spec: { points:[{label,a,b,c}], names:[a,b,c] } — a 아래왼쪽, b 위, c 아래오른쪽 꼭짓점 (합 100)
export function triangleChart(spec, st = DEFAULT_STYLE) {
  const s = spec.side || 55, h = (s * Math.sqrt(3)) / 2, ox = 8, oy = 6;
  const P = (a, b, c) => { const t = a + b + c; return [ox + s * (c / t) + s * 0.5 * (b / t), oy + h - h * (b / t)]; };
  const items = [S.poly([[P(100, 0, 0), P(0, 100, 0), P(0, 0, 100)]], { stroke: st.line, name: '삼각형' })];
  const grid = [];
  for (let k = 20; k < 100; k += 20) {
    grid.push(S.line([P(k, 100 - k, 0), P(k, 0, 100 - k)], { stroke: 0.1, gray: '#808080', name: '눈금선' }));
    grid.push(S.line([P(100 - k, k, 0), P(0, k, 100 - k)], { stroke: 0.1, gray: '#808080', name: '눈금선' }));
    grid.push(S.line([P(100 - k, 0, k), P(0, 100 - k, k)], { stroke: 0.1, gray: '#808080', name: '눈금선' }));
  }
  items.push(S.group('눈금선', grid));
  const [na, nb, nc] = spec.names;
  items.push(S.text(P(100, 0, 0)[0] - 1, P(100, 0, 0)[1] + 3, na, { size: st.small, anchor: 'r' }), S.text(P(0, 100, 0)[0], oy - 3, nb, { size: st.small }), S.text(P(0, 0, 100)[0] + 1, P(0, 0, 100)[1] + 3, nc, { size: st.small, anchor: 'l' }));
  spec.points.forEach((p) => { const [x, y] = P(+p.a, +p.b, +p.c); items.push(S.group(`점 ${p.label}`, [S.dot(x, y, 0.9), S.text(x + 1.6, y - 1.6, p.label, { size: st.size, bold: true, anchor: 'l' })])); });
  if (spec.unit) items.push(S.text(ox + s, oy + h + 7, `(단위: ${spec.unit})`, { size: st.small - 1, anchor: 'r' }));
  return items;
}

export const CHARTS = { bar: barChart, stacked: (s, st) => barChart({ ...s, stacked: true }, st), scatter: scatterChart, bubble: scatterChart, climate: climateChart, deviation: deviationChart, pyramid: pyramidChart, triangle: triangleChart };
