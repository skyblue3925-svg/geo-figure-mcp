// 지형: 실제 표고(AWS Terrain Tiles, 원자료 SRTM 등)로 등고선 지형도·지형 단면을 그리고,
// 교과서식 지형 모식도(해안·하천·카르스트·화산·빙하·식생 수직 분포)는 매개변수 틀로 그린다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contours } from 'd3-contour';
import pngjs from 'pngjs';
const { PNG } = pngjs;
import { S, DEFAULT_STYLE } from './scene.js';
import { niceTicks } from './charts.js';

const UA = { 'User-Agent': 'geo-figure-mcp/0.1 (teacher exam figure tool)' };
export const DEM_CITE = '표고: Terrain Tiles(AWS 공개 데이터, 원자료 SRTM·GMTED·ETOPO1 등)';

// 표고: AWS 공개 데이터 Terrain Tiles(Terrarium PNG, 인증키·사용 한도 없음)를 받아 읽는다.
// 받은 타일은 사용자 폴더(~/.geo-figure-mcp/tiles)에 저장해 다시 쓴다.
const TILE_DIR = path.join(os.homedir(), '.geo-figure-mcp', 'tiles');
const tileMem = new Map();
async function tile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (tileMem.has(k)) return tileMem.get(k);
  const f = path.join(TILE_DIR, `${z}-${x}-${y}.png`);
  let buf = fs.existsSync(f) ? fs.readFileSync(f) : null;
  for (let t = 0; !buf && t < 5; t++) {
    try {
      const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${k}.png`, { headers: UA });
      if (r.ok) { buf = Buffer.from(await r.arrayBuffer()); fs.mkdirSync(TILE_DIR, { recursive: true }); fs.writeFileSync(f, buf); }
      else await new Promise((ok) => setTimeout(ok, 1000 * (t + 1)));
    } catch { await new Promise((ok) => setTimeout(ok, 1000 * (t + 1))); }
  }
  if (!buf) throw new Error(`표고 타일을 받지 못했습니다(${k}). 인터넷 연결을 확인하세요.`);
  const png = PNG.sync.read(buf);
  const z16 = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) z16[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  tileMem.set(k, z16);
  return z16;
}
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z * 256;
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * 256; };
async function elev(lats, lons) {
  // 타일이 36장 넘지 않는 가장 자세한 확대 단계(최대 12 ≈ 30m)
  const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
  let z = 12;
  while (z > 4 && (Math.floor(lon2x(lo1, z) / 256) - Math.floor(lon2x(lo0, z) / 256) + 1) * (Math.floor(lat2y(la0, z) / 256) - Math.floor(lat2y(la1, z) / 256) + 1) > 36) z--;
  const need = new Set();
  for (let i = 0; i < lats.length; i++) need.add(`${Math.floor(lon2x(lons[i], z) / 256)}/${Math.floor(lat2y(lats[i], z) / 256)}`);
  const list = [...need];
  for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map((k) => { const [x, y] = k.split('/').map(Number); return tile(z, x, y); }));
  const at = (px, py) => { const tx = Math.floor(px / 256), ty = Math.floor(py / 256); const t = tileMem.get(`${z}/${tx}/${ty}`); if (!t) return 0; const ix = Math.min(255, Math.max(0, Math.floor(px - tx * 256))), iy = Math.min(255, Math.max(0, Math.floor(py - ty * 256))); return t[iy * 256 + ix]; };
  // 경계 근처는 이웃 타일이 없을 수 있어 가장 가까운 픽셀 값을 쓴다(쌍선형 보간은 같은 타일 안에서만)
  return lats.map((lat, i) => {
    const px = lon2x(lons[i], z) - 0.5, py = lat2y(lat, z) - 0.5, x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    if (Math.floor(x0 / 256) !== Math.floor((x0 + 1) / 256) || Math.floor(y0 / 256) !== Math.floor((y0 + 1) / 256)) return Math.round(at(px + 0.5, py + 0.5));
    const v = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
    return Math.round(v);
  });
}

const hav = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };

// 두 점 사이 단면: from/to = [위도, 경도]
export async function fetchProfile(from, to, n = 120) {
  const lats = [], lons = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1); lats.push(from[0] + (to[0] - from[0]) * t); lons.push(from[1] + (to[1] - from[1]) * t); }
  const z = await elev(lats, lons);
  const L = hav(from[0], from[1], to[0], to[1]);
  return z.map((v, i) => [+(L * i / (n - 1)).toFixed(3), v]);
}
export async function fetchGrid(bbox, nx = 60) {
  const [w, s, e, n] = bbox;
  const aspect = ((n - s) / ((e - w) * Math.cos(((s + n) / 2) * Math.PI / 180)));
  const ny = Math.max(10, Math.round(nx * aspect));
  const lats = [], lons = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { lats.push(n - (n - s) * j / (ny - 1)); lons.push(w + (e - w) * i / (nx - 1)); }
  return { nx, ny, z: await elev(lats, lons), bbox };
}

// 등고선 지형도. spec: { bbox:[서,남,동,북], interval:m, index:5, width, points:[{lon,lat,label}], grid(미리 받은 표고) }
export function contourMap(spec, st = DEFAULT_STYLE) {
  const g = spec.grid;
  const [w, s, e, n] = g.bbox;
  const W = spec.width || st.width;
  const kx = Math.cos(((s + n) / 2) * Math.PI / 180);
  const H = W * (n - s) / ((e - w) * kx);
  const X = (i) => (i / (g.nx - 1)) * W, Y = (j) => (j / (g.ny - 1)) * H;
  const zmax = Math.max(...g.z), step = spec.interval || niceTicks(0, zmax, 8)[1];
  const th = []; for (let v = step; v < zmax; v += step) th.push(v);
  const cs = contours().size([g.nx, g.ny]).thresholds(th)(g.z.map((v) => Math.max(v, 0)));
  const items = [S.rect(0, 0, W, H, { stroke: 0.3, name: '지도 테두리' })];
  const idx = spec.index || 5;
  const lines = [], labs = [];
  for (const c of cs) {
    const bold = Math.round(c.value / step) % idx === 0;
    for (const poly of c.coordinates) for (const ring of poly) {
      const pts = ring.map(([i, j]) => [X(Math.min(Math.max(i - 0.5, 0), g.nx - 1)), Y(Math.min(Math.max(j - 0.5, 0), g.ny - 1))]);
      if (pts.length < 4) continue;
      lines.push(S.line(pts, { stroke: bold ? 0.35 : 0.15, name: `등고선 ${c.value}m` }));
      if (bold && pts.length > 20) { const p = pts[Math.floor(pts.length / 3)]; labs.push(S.text(p[0], p[1], String(c.value), { size: st.small - 1.5, box: true, name: '등고선 값' })); }
    }
  }
  // 해안선(0m)
  const sea = contours().size([g.nx, g.ny]).thresholds([0.5])(g.z);
  for (const poly of sea[0].coordinates) for (const ring of poly) lines.push(S.line(ring.map(([i, j]) => [X(Math.min(Math.max(i - 0.5, 0), g.nx - 1)), Y(Math.min(Math.max(j - 0.5, 0), g.ny - 1))]), { stroke: 0.4, name: '해안선' }));
  items.push(S.group('등고선', lines), S.group('등고선 값', labs.slice(0, 12)));
  const P = (lon, lat) => [((lon - w) / (e - w)) * W, ((n - lat) / (n - s)) * H];
  for (const p of spec.points || []) { const [x, y] = P(p.lon, p.lat); items.push(S.group(`지점 ${p.label}`, [S.dot(x, y, 0.7), S.text(x + 1.3, y - 1.5, p.label, { size: st.size + 1, bold: true, anchor: 'l', box: true })])); }
  if (spec.line) { const a = P(spec.line[0][1], spec.line[0][0]), b = P(spec.line[1][1], spec.line[1][0]); items.push(S.group('단면선', [S.line([a, b], { stroke: 0.4, dash: true }), S.text(a[0], a[1] - 2, spec.lineLabels?.[0] || '가', { size: st.small, box: true }), S.text(b[0], b[1] - 2, spec.lineLabels?.[1] || '나', { size: st.small, box: true })])); }
  // 축척
  const km = hav(s, w, s, e), per = km / W, nice = [0.5, 1, 2, 5, 10, 20, 50].find((v) => v / per >= 10) || 50, len = nice / per;
  items.push(S.group('축척', [S.line([[2, H - 2.5], [2, H - 1.5], [2 + len, H - 1.5], [2 + len, H - 2.5]], { stroke: 0.3 }), S.text(2 + len / 2, H - 4, `${nice}km`, { size: st.small - 1, box: true })]));
  const gridM = Math.round((hav(s, w, s, e) * 1000) / (g.nx - 1) / 10) * 10;
  items.push(S.text(W, H + 3, `등고선 간격 ${step}m (굵은 선 ${step * idx}m마다) · 표고 격자 약 ${gridM}m`, { size: st.small - 1, anchor: 'r', name: '등고선 설명' }));
  return items;
}

// 지형 단면. spec: { points:[[km, m]…], labels:[{km, label}], vex(세로 과장), height, width, seaLevel:true }
export function profileChart(spec, st = DEFAULT_STYLE) {
  const W = spec.width || st.width, H = spec.height || 34, L = 11, B = 7, T = 4;
  const pts = spec.points, xmax = pts.at(-1)[0];
  const zmin = Math.min(0, ...pts.map((p) => p[1])), zmax = Math.max(...pts.map((p) => p[1]));
  const yt = niceTicks(zmin, zmax, 4);
  const sx = (v) => L + (v / xmax) * (W - L - 2), sy = (v) => H - B - ((v - yt[0]) / (yt.at(-1) - yt[0])) * (H - B - T);
  const ground = [[sx(0), sy(yt[0])], ...pts.map(([d, z]) => [sx(d), sy(z)]), [sx(xmax), sy(yt[0])]];
  const items = [];
  if (zmin < 0 || spec.seaLevel) items.push(S.rect(sx(0), sy(0), W - L - 2, sy(yt[0]) - sy(0), { fill: { k: 'hatch', p: 'horz', gray: '#FFFFFF' }, stroke: 0, name: '바다' }));
  items.push(S.poly([ground], { fill: { k: 'solid', gray: '#D9D9D9' }, stroke: 0.3, name: '지면' }));
  const ax = [S.line([[L, H - B], [L, T]], { stroke: 0.25 }), S.line([[L, H - B], [W - 2, H - B]], { stroke: 0.25 })];
  for (const t of yt) { ax.push(S.line([[L - 1, sy(t)], [L, sy(t)]], { stroke: 0.25 })); ax.push(S.text(L - 1.5, sy(t), String(t), { size: st.small - 1, anchor: 'r' })); }
  for (const t of niceTicks(0, xmax, 5).filter((v) => v <= xmax)) ax.push(S.text(sx(t), H - B + 2.6, String(t), { size: st.small - 1 }));
  ax.push(S.text(L, T - 2, '(m)', { size: st.small - 1, anchor: 'r' }), S.text(W - 2, H - 1, '(km)', { size: st.small - 1, anchor: 'r' }));
  items.push(S.group('축', ax));
  const zAt = (km) => { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= km) { const [a, b] = [pts[i - 1], pts[i]]; return a[1] + (b[1] - a[1]) * ((km - a[0]) / (b[0] - a[0] || 1)); } return pts.at(-1)[1]; };
  for (const l of spec.labels || []) { const x = sx(l.km), y = sy(zAt(l.km)); items.push(S.group(`기호 ${l.label}`, [S.line([[x, y - 0.8], [x, y - 5]], { stroke: 0.2 }), S.text(x, y - 6.8, l.label, { size: st.size, bold: true, box: true })])); }
  if (spec.vex) items.push(S.text(W - 2, T - 2, `* 세로 과장 약 ${spec.vex}배`, { size: st.small - 1.5, anchor: 'r' }));
  return items;
}

// ---- 지형 모식도 틀 (실제 장소가 아닌 교과서식 단면) ----
// spec: { preset, labels:{ 부분이름: 'A' }, width }
const PRESETS = {
  'coast-erosion': { title: '암석 해안', parts: { 파식대: 18, 해식애: 34, 해식동굴: 33, 해안단구: 62, 시스택: 8 },
    ground: [[0, -6], [6, -6], [7, 2], [9, 2], [10, -3], [14, -3], [30, -2], [33, -1.5], [34, 12], [55, 13], [58, 13], [61, 22], [100, 23], [100, -10], [0, -10]], sea: 0, seaTo: 33.5 },
  'coast-deposition': { title: '모래 해안(석호)', parts: { 사빈: 30, 해안사구: 42, 사주: 38, 석호: 62, 배후습지: 82 },
    ground: [[0, -4], [16, -2.2], [24, -0.6], [28, 0], [34, 0.8], [38, 1.6], [42, 2.6], [46, 2.2], [50, 1], [54, 0.2], [56, -1.5], [68, -1.5], [70, 0.2], [76, 0.5], [92, 0.8], [100, 2.5], [100, -6], [0, -6]], sea: 0, seaTo: 28, water: [[54, 0], [70, 0]], zRange: [-6, 6] },
  'river-terrace': { title: '하천 단면(하안 단구)', parts: { 하천: 50, 범람원: 38, 하안단구: 22, 산지: 5, 자연제방: 44 },
    ground: [[0, 40], [10, 28], [16, 20], [26, 19], [30, 10], [40, 7], [44, 8.5], [47, 6], [53, 6], [56, 9], [70, 10], [80, 26], [100, 42], [100, -6], [0, -6]], water: [[47, 7.5], [53, 7.5]] },
  karst: { title: '카르스트 지형', parts: { 돌리네: 28, 우발라: 62, 석회동굴: 45, 석회암: 85 },
    ground: [[0, 20], [20, 20], [24, 17], [28, 15], [32, 17], [36, 20], [52, 20], [56, 16], [62, 14], [68, 16], [72, 20], [100, 20], [100, -6], [0, -6]], cave: [45, 8, 14, 5], rock: true },
  volcano: { title: '화산 지형', parts: { 순상화산: 22, 종상화산: 58, 칼데라: 84, 용암대지: 98 },
    ground: [[0, 0], [10, 6], [22, 10], [34, 6], [44, 2], [52, 6], [58, 18], [64, 6], [72, 4], [78, 14], [81, 16], [82, 10], [86, 10], [87, 16], [90, 14], [94, 6], [96, 5], [100, 5], [100, -6], [0, -6]], water: [[82, 12], [86, 12]] },
  glacier: { title: '빙하 지형', parts: { U자곡: 30, 호른: 62, 권곡: 74, V자곡: 92 },
    ground: [[0, 40], [10, 32], [16, 16], [22, 10], [38, 10], [44, 16], [50, 32], [58, 46], [62, 54], [66, 44], [70, 34], [74, 30], [78, 34], [84, 30], [92, 10], [100, 30], [100, -6], [0, -6]] },
  'vegetation-vertical': { title: '식생의 수직 분포', parts: { 고산식물대: 50, 아고산대: 50, 산지대: 50, 구릉대: 50 },
    ground: [[0, 0], [20, 8], [35, 22], [45, 36], [50, 40], [55, 36], [65, 22], [80, 8], [100, 0], [100, -4], [0, -4]], bands: [10, 20, 32] },
};
export const LANDFORM_PRESETS = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { title: v.title, parts: Object.keys(v.parts) }]));

export function landformDiagram(spec, st = DEFAULT_STYLE) {
  const p = PRESETS[spec.preset];
  if (!p) throw new Error(`모르는 모식도: ${spec.preset}. 쓸 수 있는 것: ${Object.keys(PRESETS).join(', ')}`);
  const W = spec.width || st.width, zs = p.ground.map((g) => g[1]), zmin = p.zRange?.[0] ?? Math.min(...zs), zmax = p.zRange?.[1] ?? Math.max(...zs);
  const H = spec.height || W * 0.42, sx = (v) => (v / 100) * W, sy = (v) => H - ((v - zmin) / (zmax - zmin)) * H * 0.85 - H * 0.08;
  const items = [];
  if (p.sea != null) items.push(S.poly([[[0, sy(p.sea)], [sx(p.seaTo || 30), sy(p.sea)], [sx(p.seaTo || 30), sy(Math.min(...zs))], [0, sy(Math.min(...zs))]]], { fill: { k: 'hatch', p: 'horz', gray: '#FFFFFF' }, stroke: 0, name: '바다' }));
  items.push(S.poly([p.ground.map(([x, z]) => [sx(x), sy(z)])], { fill: p.rock ? { k: 'hatch', p: 'cross', gray: '#FFFFFF' } : { k: 'solid', gray: '#D9D9D9' }, stroke: 0.35, name: '지면' }));
  if (p.water) items.push(S.poly([[[sx(p.water[0][0]), sy(p.water[0][1])], [sx(p.water[1][0]), sy(p.water[1][1])], [sx(p.water[1][0] - 1), sy(p.water[1][1] - 1.5)], [sx(p.water[0][0] + 1), sy(p.water[0][1] - 1.5)]]], { fill: { k: 'hatch', p: 'horz', gray: '#FFFFFF' }, stroke: 0.2, name: '물' }));
  if (p.cave) { const [cx, cz, w, h] = p.cave; items.push(S.ellipse(sx(cx - w / 2), sy(cz + h / 2), sx(w), sy(cz - h / 2) - sy(cz + h / 2), { fill: { k: 'solid', gray: '#FFFFFF' }, stroke: 0.3, name: '동굴' })); }
  if (p.bands) p.bands.forEach((z, i) => items.push(S.line([[sx(5), sy(z)], [sx(95), sy(z)]], { stroke: 0.2, dash: true, name: `경계 ${i + 1}` })));
  const top = (x) => { const g = p.ground; for (let i = 1; i < g.length; i++) if (g[i][0] >= x && g[i - 1][0] <= x) { const [a, b] = [g[i - 1], g[i]]; return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0] || 1)); } return 0; };
  const labs = spec.labels || {};
  for (const [part, lab] of Object.entries(labs)) {
    if (!(part in p.parts)) throw new Error(`'${spec.preset}' 모식도에 없는 부분: ${part}. 있는 것: ${Object.keys(p.parts).join(', ')}`);
    let x = sx(p.parts[part]), y;
    if (p.bands) { const zb = [0, ...p.bands, zmax]; const k = ['구릉대', '산지대', '아고산대', '고산식물대'].indexOf(part); y = sy((zb[k] + zb[k + 1]) / 2); x = sx(50); items.push(S.text(x, y, lab, { size: st.size, bold: true, box: true, name: `기호 ${lab}` })); continue; }
    if (part === '석회동굴' && p.cave) { y = sy(p.cave[1]); items.push(S.text(x, y, lab, { size: st.size, bold: true, box: true, name: `기호 ${lab}` })); continue; }
    y = sy(top(p.parts[part]));
    items.push(S.group(`기호 ${lab}`, [S.line([[x, y - 0.6], [x, y - 5]], { stroke: 0.2 }), S.text(x, y - 6.6, lab, { size: st.size, bold: true, box: true })]));
  }
  return items;
}
