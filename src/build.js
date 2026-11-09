// 그림 명세 → 장면 → PPTX·HWPX 파일
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { figure, withFooter, shift, bounds, S, DEFAULT_STYLE } from './scene.js';
import { makeMap } from './maps.js';
import { CHARTS } from './charts.js';
import { contourMap, profileChart, landformDiagram, fetchGrid, fetchProfile, DEM_CITE } from './terrain.js';
import { buildPptx } from './pptx.js';
import { buildHwpx } from './hwpx.js';

const STYLE_FILE = path.join(os.homedir(), '.geo-figure-mcp', 'style.json');
export function loadStyle() { try { return { ...DEFAULT_STYLE, ...JSON.parse(fs.readFileSync(STYLE_FILE, 'utf8')) }; } catch { return { ...DEFAULT_STYLE }; } }
export function saveStyle(patch) {
  const s = { ...loadStyle(), ...patch };
  fs.mkdirSync(path.dirname(STYLE_FILE), { recursive: true });
  fs.writeFileSync(STYLE_FILE, JSON.stringify(s, null, 1));
  return s;
}

async function part(p, st, cites) {
  if (p.map?.type === 'contour') {
    const grid = p.map.grid || await fetchGrid(p.map.bbox, p.map.resolution || 60);
    cites.add(DEM_CITE);
    return contourMap({ ...p.map, grid }, st);
  }
  if (p.map) {
    // 경계 자료의 출처 표시 의무(SGIS 공공누리 1유형 → vuski/admdongkor CC BY 4.0, Natural Earth)
    cites.add(p.map.region === 'korea' ? '지도: 통계청 SGIS(vuski/admdongkor 가공, CC BY 4.0)' : '지도: Natural Earth');
    return makeMap(p.map, st);
  }
  if (p.chart?.type === 'profile') {
    const points = p.chart.points || await fetchProfile(p.chart.from, p.chart.to, p.chart.samples || 120);
    if (!p.chart.points) cites.add(DEM_CITE);
    return profileChart({ ...p.chart, points }, st);
  }
  if (p.chart?.type === 'landform') return landformDiagram(p.chart, st);
  const fn = CHARTS[p.chart?.type];
  if (!fn) throw new Error(`모르는 그래프 종류: ${p.chart?.type}. 쓸 수 있는 것: ${Object.keys(CHARTS).join(', ')}`);
  return fn(p.chart, st);
}

// spec: { title, parts:[{ caption:'(가)', map:{...} | chart:{type,...} }], layout:'row'|'column', source, notes:[] }
export async function makeFigure(spec, st = loadStyle()) {
  const cites = new Set();
  const parts = spec.parts || [spec];
  const placed = [];
  let x = 0, y = 0;
  const gap = 6;
  const row = (spec.layout || (parts.length > 1 ? 'row' : 'column')) === 'row';
  for (const p of parts) {
    let items = await part(p, st, cites);
    const b = bounds(items);
    items = shift(items, -b.x, -b.y + (p.caption ? 5 : 0));
    if (p.caption) items.unshift(S.text(b.w / 2, 1.8, p.caption, { size: st.size, name: '자료 이름' }));
    placed.push(S.group(p.caption ? `자료 ${p.caption}` : '자료', shift(items, x, y)));
    if (row) x += b.w + gap; else y += b.h + (p.caption ? 5 : 0) + gap;
  }
  const source = [spec.source, ...[...cites].filter((c) => !(spec.source || '').includes(c.slice(0, 14)))].filter(Boolean).join('; ');
  return withFooter(figure({ title: spec.title, items: placed, source, notes: spec.notes }), st);
}

export function exportFigures(figs, { outDir, name = '지리자료', formats = ['pptx', 'hwpx'], answerKey, style } = {}) {
  const st = style || loadStyle();
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  if (formats.includes('pptx')) { const f = path.join(outDir, `${name}.pptx`); fs.writeFileSync(f, buildPptx(figs, { style: st, keyText: answerKey })); files.push(f); }
  if (formats.includes('hwpx')) { const f = path.join(outDir, `${name}.hwpx`); fs.writeFileSync(f, buildHwpx(figs, { style: st, keyText: answerKey })); files.push(f); }
  return files;
}
