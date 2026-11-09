// 기출 지점 값으로 쾨펜 기후를 분류해 평가원 기호와 대조한다 (자료 검증용)
import { findData, examSpots } from '../src/data.js';
const sum = (a) => a.reduce((x, y) => x + y, 0);
export function koppen(T, P, lat) {
  const Tmin = Math.min(...T), Tmax = Math.max(...T), Ta = sum(T) / 12, Pa = sum(P);
  const north = lat >= 0, sumIdx = north ? [3, 4, 5, 6, 7, 8] : [9, 10, 11, 0, 1, 2], winIdx = north ? [9, 10, 11, 0, 1, 2] : [3, 4, 5, 6, 7, 8];
  const Ps = sumIdx.map((i) => P[i]), Pw = winIdx.map((i) => P[i]);
  const pth = sum(Ps) >= 0.7 * Pa ? 2 * Ta + 28 : sum(Pw) >= 0.7 * Pa ? 2 * Ta : 2 * Ta + 14;
  if (Tmax < 10) return Tmax < 0 ? 'EF' : 'ET';
  if (Pa < 10 * pth) return Pa < 5 * pth ? 'BW' : 'BS';
  if (Tmin >= 18) { const Pdry = Math.min(...P); return Pdry >= 60 ? 'Af' : Pdry >= 100 - Pa / 25 ? 'Am' : 'Aw'; }
  const g = Tmin > -3 ? 'C' : 'D';
  const s = Math.min(...Ps) < 40 && Math.min(...Ps) < Math.max(...Pw) / 3 ? 's' : Math.min(...Pw) < Math.max(...Ps) / 10 ? 'w' : 'f';
  const t = Tmax >= 22 ? 'a' : T.filter((x) => x >= 10).length >= 4 ? 'b' : 'c';
  return g + s + t;
}
const sp = examSpots().filter((s) => s.lat != null);
const r = await findData({ source: 'climate', regions: sp.map((s) => s.name) });
let bad = 0;
for (const x of r.rows) {
  const k = koppen(x.values.temp, x.values.precip, x.lat), code = x.exam?.code || '';
  const ok = code.split(/[\/()]/).some((c) => c && (k.startsWith(c) || (c === 'Cs' && k.startsWith('Cs')) || c === 'H')) || (code.startsWith('A') && k.startsWith('A'));
  if (!ok) { bad++; console.log('다름', x.name.padEnd(10), '평가원', code.padEnd(6), '계산', k, `(${x.station}, ${x.distanceKm}km)`); }
}
console.log(`대조 ${r.rows.length}곳, 다름 ${bad}곳`);
