import { z } from 'zod';
import { sourceTable } from './source-table.js';

const symbol = z.string().trim().min(1).max(12);
const sides = { left: symbol, right: symbol };
const comparison = { ...sides, direction: z.enum(['greater', 'less']) };
export const climateChoices = z.array(z.union([
  z.strictObject({ kind: z.literal('match'), ...sides }),
  z.strictObject({ kind: z.enum(['temperature', 'precipitation']), ...comparison, month: z.number().int().min(1).max(12) }),
  z.strictObject({ kind: z.enum(['temperatureRange', 'jjaPrecipitation', 'annualPrecipitation']), ...comparison }),
])).length(5);

const metrics = {
  temperature: { label: m => m + '월 평균 기온이', unit: '℃', words: ['높다', '낮다'],
    value: (s, m) => s.temp[m - 1] },
  precipitation: { label: m => m + '월 강수량이', unit: 'mm', words: ['많다', '적다'],
    value: (s, m) => s.precip[m - 1] },
  temperatureRange: { label: () => '기온의 연교차가', unit: '℃', words: ['크다', '작다'],
    value: s => Math.max(...s.temp) - Math.min(...s.temp) },
  jjaPrecipitation: { label: () => '6~8월 강수량의 합이', unit: 'mm', words: ['많다', '적다'],
    value: s => s.precip.slice(5, 8).reduce((a, b) => a + b, 0) },
  annualPrecipitation: { label: () => '연 강수량이', unit: 'mm', words: ['많다', '적다'],
    value: s => s.precip.reduce((a, b) => a + b, 0) },
};

export function checkClimateQuestion(figure, choices) {
  if (figure?.link?.kind !== 'climate') throw new Error('연결된 기후 지도와 그래프 시안이 필요합니다.');
  const stations = new Map();
  const bySymbol = new Map();
  const table = sourceTable(figure, 'teacher');
  for (const [map, chart, name, month, temp, precip] of table.rows) {
    if (!stations.has(name)) {
      const station = { name, map, chart, temp: [], precip: [] };
      if (map === chart || bySymbol.has(map) || bySymbol.has(chart)) throw new Error('기호가 중복됩니다.');
      stations.set(name, station);
      bySymbol.set(map, station);
      bySymbol.set(chart, station);
    }
    if (!Number.isFinite(temp) || !Number.isFinite(precip)) throw new Error('월별 기후 값이 누락되었습니다.');
    stations.get(name).temp[month - 1] = temp;
    stations.get(name).precip[month - 1] = precip;
  }
  const { link, parts } = figure;
  const points = parts[link.mapPart]?.map?.points;
  const panels = parts[link.chartPart]?.chart?.stations;
  if (panels?.length !== stations.size || points?.length !== stations.size) throw new Error('그림과 원자료의 지점 수가 다릅니다.');
  for (const s of link.stations) {
    const panel = panels.find(p => p.label === s.chartLabel);
    if (!points.some(p => p.label === s.mapLabel && p.lat === s.lat && p.lon === s.lon) ||
        !panel || !['temp', 'precip'].every(k => panel[k]?.length === 12 && s[k].every((v, i) => v === panel[k][i]))) {
      throw new Error('그림의 기호 또는 월별 값과 원자료가 일치하지 않습니다.');
    }
  }
  const checks = choices.map(({ kind, left, right, direction, month }, i) => {
    const a = bySymbol.get(left), b = bySymbol.get(right);
    if (!a || !b) throw new Error('그림에 없는 기호입니다: ' + (!a ? left : right));
    const number = i + 1;
    if (kind === 'match') {
      if (a.map !== left || b.chart !== right) throw new Error('match는 지도 기호와 그래프 기호 순서로 지정하세요.');
      return { number, text: left + ' 지점의 기후를 나타낸 그래프는 ' + right + '이다.',
        correct: a === b, evidence: { place: a.name, chart: a.chart, proposedPlace: b.name } };
    }
    if (a === b) throw new Error('서로 다른 두 지점을 비교하세요.');
    const metric = metrics[kind];
    // Source observations have decimal precision. Remove only floating-point summation noise.
    const value = s => Number(metric.value(s, month).toFixed(8));
    const leftValue = value(a), rightValue = value(b);
    const greater = direction === 'greater';
    return { number, text: left + ' 지점은 ' + right + ' 지점보다 ' + metric.label(month) + ' ' + metric.words[greater ? 0 : 1] + '.',
      correct: greater ? leftValue > rightValue : leftValue < rightValue,
      evidence: { leftPlace: a.name, leftValue, rightPlace: b.name, rightValue, unit: metric.unit } };
  });
  if (new Set(checks.map(c => c.text)).size !== 5) throw new Error('서로 다른 선지 다섯 개가 필요합니다.');
  const correct = checks.filter(c => c.correct);
  return { stem: '지도에 표시된 지점들의 월별 기온과 강수량을 그래프로 나타냈다. 이에 대한 설명으로 옳은 것은?',
    checks, correctCount: correct.length, answer: correct.length === 1 ? correct[0].number : null };
}
