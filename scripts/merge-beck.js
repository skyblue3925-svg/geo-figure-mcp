// 관측소 자료가 약한 기출 지점(가까운 관측소 없음·기록 짧음·50km 넘음)에 Beck 0.1° 격자값을 넣는다.
// node scripts/merge-beck.js <beck-pts.json>
import fs from 'node:fs';
const B = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const d = JSON.parse(fs.readFileSync('data/exam-climate-spots.json', 'utf8'));
const W = JSON.parse(fs.readFileSync('data/wmo-normals-1991-2020.json', 'utf8')).stations;
const hav = (a, b, c, e) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((e - b) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
for (const s of d.spots) {
  if (s.lat == null) continue;
  const dW = Math.min(...W.map((w) => hav(s.lat, s.lon, w[3], w[4])));
  const weak = s.climate ? s.climate.tier === 2 || s.climate.distanceKm > 50 : dW > 50;
  if (!weak) continue;
  const b = B[s.name];
  if (!b) { console.log(s.name, '격자값도 없음'); continue; }
  s.climateStation = s.climate || null; // 비교용으로 남긴다
  s.climate = { source: 'Beck-0.1', station: `0.1° 격자(${b.cellLat}, ${b.cellLon})`, distanceKm: Math.round(hav(s.lat, s.lon, b.cellLat, b.cellLon)), elev: null, temp: b.temp, precip: b.precip };
  console.log(s.name, '→ 격자', `연강수 ${b.precip.reduce((x, y) => x + y, 0).toFixed(0)}mm`, `최한 ${Math.min(...b.temp)} 최난 ${Math.max(...b.temp)}`);
}
d.climateNote += ' 관측소 자료가 약한 지점(가까운 관측소 없음·기록 10년 미만·50km 초과)은 Beck et al.(2023) 0.1° 격자 1991~2020 값(CC BY 4.0, doi:10.6084/m9.figshare.21789074)을 쓴다.';
fs.writeFileSync('data/exam-climate-spots.json', JSON.stringify(d, null, 1));
