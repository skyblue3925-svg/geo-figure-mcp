// 지도 → 장면 도형. 경계는 통계청 SGIS(한국)·Natural Earth(세계) 자료를 계산해 다각형으로 넣는다.
import fs from 'node:fs';
import { geoMercator, geoEquirectangular, geoPath, geoDistance, geoGraticule } from 'd3-geo';
import { feature, merge } from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { S, CLASS_FILLS, DEFAULT_STYLE, textWidth } from './scene.js';

const DATA = new URL('../data/', import.meta.url);
const cache = {};
const load = (f) => (cache[f] ||= JSON.parse(fs.readFileSync(new URL(f, DATA), 'utf8')));
const KEEP = { high: 0.5, mid: 0.18, low: 0.05 };

function topo(file, detail) {
  const k = `${file}|${detail}`;
  if (cache[k]) return cache[k];
  let t = structuredClone(load(file));
  const keep = KEEP[detail] ?? KEEP.mid;
  if (keep < 1) { t = presimplify(t); t = simplify(t, quantile(t, keep)); }
  return (cache[k] = t);
}

// d3 geoPath 를 고리(ring) 목록으로 받는다 — 화면 밖 자르기·날짜변경선 처리를 d3 에 맡긴다
function rings(path, geo) {
  const out = [];
  let cur = null;
  path.context({
    moveTo(x, y) { cur = [[x, y]]; out.push(cur); },
    lineTo(x, y) { cur.push([x, y]); },
    closePath() {},
    arc() {},
  })(geo);
  return out.filter((r) => r.length > 2);
}
const lines = (path, geo) => { const out = []; let cur; path.context({ moveTo(x, y) { cur = [[x, y]]; out.push(cur); }, lineTo(x, y) { cur.push([x, y]); }, closePath() {}, arc() {} })(geo); return out.filter((r) => r.length > 1); };

// 다각형 안에서 가장 넓은 자리(pole of inaccessibility) — 기호를 지역 한가운데에 둔다
function polylabel(rs) {
  const outer = rs.reduce((a, r) => (Math.abs(area(r)) > Math.abs(area(a)) ? r : a), rs[0]);
  const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best = [(x0 + x1) / 2, (y0 + y1) / 2], bd = -Infinity;
  const own = rs.filter((r) => r === outer || inside(r[0], outer));
  const score = (p) => (inside(p, outer) && !own.some((r) => r !== outer && inside(p, r)) ? Math.min(...own.map((r) => segDist(p, r))) : -1);
  let step = Math.max(x1 - x0, y1 - y0) / 12;
  let cx = best[0], cy = best[1], span = Math.max(x1 - x0, y1 - y0) / 2;
  for (let it = 0; it < 4; it++) {
    for (let x = cx - span; x <= cx + span; x += step) for (let y = cy - span; y <= cy + span; y += step) {
      const d = score([x, y]);
      if (d > bd) { bd = d; best = [x, y]; }
    }
    cx = best[0]; cy = best[1]; span = step * 1.5; step /= 4;
  }
  return best;
}
const area = (r) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function inside([x, y], r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
function segDist([px, py], r) {
  let m = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j], [bx, by] = r[i], dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    m = Math.min(m, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return m;
}

// 한국 지역 목록: level 'sido' | 'sigungu'
// edition: '2026'(2026년 7월~, 16개 시·도) | '2025'(17개 시·도, 그 이전 자료용)
function koreaFeatures(level, detail, edition = '2026') {
  const t = topo(`korea-sigungu-${edition === '2025' ? '2025' : '2026'}.json`, detail);
  const obj = t.objects.sigungu;
  if (level === 'sigungu') return feature(t, obj).features.map((f) => ({ name: f.properties.name, sido: f.properties.short, full: `${f.properties.short} ${f.properties.name}`, geo: f }));
  const by = new Map();
  for (const g of obj.geometries) { const k = g.properties.short; if (!by.has(k)) by.set(k, []); by.get(k).push(g); }
  return [...by].map(([k, gs]) => ({ name: k, sido: k, full: k, geo: { type: 'Feature', properties: { name: k }, geometry: merge(t, gs) } }));
}
function worldFeatures(detail, wide) {
  const t = topo(wide ? 'countries-110m.json' : 'countries-50m.json', wide ? 'high' : detail);
  return feature(t, t.objects.countries).features.map((f) => ({ name: f.properties.name, full: f.properties.name, id: f.id, geo: f }));
}

export function listRegions({ region = 'korea', level = 'sido', within, edition = '2026' } = {}) {
  if (region === 'korea') return koreaFeatures(level, 'low', edition).filter((f) => !within || within.includes(f.sido)).map((f) => (level === 'sido' ? f.name : f.full));
  return worldFeatures('low', true).map((f) => f.name).sort();
}

// spec: { region:'korea'|'world', level, within:['경기'], bbox:[lon0,lat0,lon1,lat1], detail,
//         classes:{지역: 단계번호}, legend:[단계 라벨], labels:{지역:'A'}, points:[{label,lon,lat,name?}],
//         flows:[{from,to,value}], graticule: 10, width }
export function makeMap(spec, st = DEFAULT_STYLE) {
  const W = spec.width || st.width;
  const detail = spec.detail || 'mid';
  const isKorea = (spec.region || 'korea') === 'korea';
  let feats, focus;
  if (isKorea) {
    feats = koreaFeatures(spec.level || 'sido', detail, spec.edition);
    focus = spec.within ? feats.filter((f) => spec.within.includes(f.sido)) : feats;
  } else {
    const wide = !spec.bbox || spec.bbox[2] - spec.bbox[0] > 150;
    feats = worldFeatures(detail, wide);
    focus = feats;
  }
  const find = (n) => feats.find((f) => f.full === n || f.name === n || f.id === n) || (() => { throw new Error(`지도에 없는 지역: ${n}. 비슷한 이름: ${feats.map((f) => f.full).filter((x) => [...String(n)].some((c) => x.includes(c))).slice(0, 8).join(', ') || '없음'} (지도 판: ${spec.edition || '2026'}년 — 2026년 판은 전남·광주가 '전남광주', 2025년 판은 따로)`); })();
  const proj = isKorea ? geoMercator() : geoEquirectangular();
  const H0 = spec.height || W * 1.1;
  if (spec.bbox) {
    const [a, b, c, d] = spec.bbox;
    proj.fitExtent([[0, 0], [W, H0]], { type: 'Polygon', coordinates: [[[a, b], [a, d], [c, d], [c, b], [a, b]]] });
  } else proj.fitExtent([[0, 0], [W, H0]], { type: 'FeatureCollection', features: focus.map((f) => f.geo) });
  // 실제 높이: 초점 지역 범위에 맞춰 자른다
  const pth = geoPath(proj);
  const fb = spec.bbox ? [[0, 0], [W, H0]] : pth.bounds({ type: 'FeatureCollection', features: focus.map((f) => f.geo) });
  const H = Math.min(H0, fb[1][1] + 1);
  proj.clipExtent([[0, 0], [W, H]]);
  const path = geoPath(proj);

  const items = [];
  if (!isKorea && spec.graticule !== 0) {
    const step = spec.graticule || 10;
    const gl = lines(path, geoGraticule().step([step, step])());
    items.push(S.group('위·경도선', gl.map((l) => S.line(l, { stroke: 0.12, dash: 'sysDash', gray: '#7F7F7F', name: '위·경도선' }))));
  }
  // 단계 구분에 지도에 없는 이름이 있으면 조용히 빠지지 않게 알린다
  if (spec.classes) {
    const bad = Object.keys(spec.classes).filter((n) => !feats.some((f) => f.full === n || f.name === n || f.id === n));
    if (bad.length) throw new Error(`단계 구분(classes)에 지도에 없는 지역 ${bad.length}곳: ${bad.slice(0, 10).join(', ')}. 내장 자료의 mapName 을 쓰거나 list_regions 로 이름을 확인하세요. (일반구는 시로 합쳐 그린다)`);
  }
  const areas = [], labels = [];
  const inFocus = new Set(focus);
  for (const f of feats) {
    const rs = rings(path, f.geo);
    if (!rs.length) continue;
    const ci = spec.classes?.[f.full] ?? spec.classes?.[f.name];
    const fill = ci != null ? CLASS_FILLS[ci] : { k: 'solid', gray: '#FFFFFF' };
    areas.push(S.poly(rs, { fill, stroke: inFocus.has(f) ? 0.2 : 0.12, name: f.full }));
  }
  items.push(S.group(isKorea ? '행정 구역' : '국가', areas));
  // 경계 굵게: 시·군 지도일 때 시·도 경계를 한 번 더
  if (isKorea && spec.level === 'sigungu') {
    const sidos = koreaFeatures('sido', detail, spec.edition);
    items.push(S.group('시·도 경계', sidos.flatMap((f) => rings(path, f.geo).map((r) => S.line([...r, r[0]], { stroke: 0.4, name: `${f.name} 경계` })))));
  }
  for (const [n, lab] of Object.entries(spec.labels || {})) {
    const f = find(n);
    const rs = rings(path, f.geo);
    if (!rs.length) continue;
    const [x, y] = polylabel(rs);
    labels.push(S.text(x, y, lab, { size: st.size + 1, bold: true, box: !!spec.labelBox, name: `기호 ${lab}` }));
  }
  // 지점 기호: 서로 겹치면 오른쪽 위 → 오른쪽 아래 → 왼쪽 위 → 왼쪽 아래 → 위 → 아래 순으로 비켜 놓는다
  const placed = [];
  const pts = (spec.points || []).map((p) => ({ p, xy: proj([p.lon, p.lat]) })).filter((x) => x.xy);
  const dots = pts.map(({ xy }) => [xy[0] - 1, xy[1] - 1, xy[0] + 1, xy[1] + 1]);
  const hit = (b) => [...placed, ...dots].some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  for (const { p, xy } of pts) {
    const g = [S.dot(xy[0], xy[1], 0.8, { name: '점' })];
    if (p.label) {
      const w = textWidth(p.label, st.size + 1) + 1.2, h = (st.size + 1) * 0.3528 * 1.3;
      const tries = [[1.3, -1.6, 'l'], [1.3, 1.8, 'l'], [-1.3, -1.6, 'r'], [-1.3, 1.8, 'r'], [0, -2.8, 'c'], [0, 3, 'c'], [2.6, -3.2, 'l'], [-2.6, 3.4, 'r']];
      let pick = tries[0];
      for (const t of tries) {
        const x0 = t[2] === 'l' ? xy[0] + t[0] : t[2] === 'r' ? xy[0] + t[0] - w : xy[0] - w / 2, y0 = xy[1] + t[1] - h / 2;
        const box = [x0, y0, x0 + w, y0 + h];
        const ownDot = [xy[0] - 1, xy[1] - 1, xy[0] + 1, xy[1] + 1];
        const others = [...placed, ...dots.filter((d) => d.join() !== ownDot.join())];
        if (!others.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) { pick = t; placed.push(box); break; }
        if (t === tries.at(-1)) placed.push(box);
      }
      g.push(S.text(xy[0] + pick[0], xy[1] + pick[1], p.label, { size: st.size + 1, bold: true, anchor: pick[2], box: !!spec.labelBox, name: `기호 ${p.label}` }));
    }
    labels.push(S.group(`지점 ${p.label || p.name || ''}`, g));
  }
  if (spec.flows?.length) {
    const vmax = Math.max(...spec.flows.map((f) => +f.value));
    const pt = (n) => { const f = find(n); return polylabel(rings(path, f.geo)); };
    const arrows = spec.flows.map((fl) => {
      const [a, b] = [pt(fl.from), pt(fl.to)];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy), k = Math.min(2.5, d * 0.2) / d;
      return S.line([[a[0] + dx * k, a[1] + dy * k], [b[0] - dx * k, b[1] - dy * k]], { stroke: 0.3 + 1.5 * (+fl.value / vmax), arrow: true, name: `흐름 ${fl.from}→${fl.to}` });
    });
    items.push(S.group('흐름 화살표', arrows));
  }
  items.push(S.group('기호', labels));
  // 축척: 전도(세계·대륙·우리나라 전체)가 아니면 넣는다 (교육청 지리 문항 지침)
  const whole = isKorea ? !spec.within : !spec.bbox || spec.bbox[2] - spec.bbox[0] > 60;
  if (spec.scaleBar ?? !whole) items.push(scaleBar(proj, W, H, st));
  if (spec.legend?.length) items.push(spec.within || spec.bbox ? rowLegend(spec.legend, H, st) : classLegend(spec.legend, W, H, st));
  return items;
}

function scaleBar(proj, W, H, st) {
  const y = H - 3, x0 = 3;
  const a = proj.invert([x0, y]), b = proj.invert([x0 + 10, y]);
  const kmPer10 = (geoDistance(a, b) * 6371);
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find((v) => (v / kmPer10) * 10 >= 8) || 1000;
  const len = (nice / kmPer10) * 10;
  return S.group('축척', [
    S.line([[x0, y - 1], [x0, y], [x0 + len, y], [x0 + len, y - 1]], { stroke: 0.3, name: '축척 막대' }),
    S.text(x0, y - 2.2, '0', { size: st.small - 1 }), S.text(x0 + len, y - 2.2, `${nice}km`, { size: st.small - 1 }),
  ]);
}
function rowLegend(labels, H, st) {
  const items = [];
  let x = 0;
  labels.forEach((l, i) => {
    items.push(S.rect(x, H + 2, 3.2, 2.8, { fill: CLASS_FILLS[i], stroke: 0.2, name: `범례 칸 ${l}` }));
    items.push(S.text(x + 4, H + 3.4, l, { size: st.small, anchor: 'l', name: `범례 ${l}` }));
    x += 4 + textWidth(l, st.small) + 3;
  });
  return S.group('범례', items);
}
function classLegend(labels, W, H, st) {
  const items = [];
  const lw = Math.max(...labels.map((l) => textWidth(l, st.small))) + 6;
  labels.forEach((l, i) => {
    const y = H - 4 - (labels.length - 1 - i) * 4;
    items.push(S.rect(W - lw - 1, y - 1.4, 3.2, 2.8, { fill: CLASS_FILLS[i], stroke: 0.2, name: `범례 칸 ${l}` }));
    items.push(S.text(W - lw + 3, y, l, { size: st.small, anchor: 'l', name: `범례 ${l}` }));
  });
  return S.group('범례', items);
}
