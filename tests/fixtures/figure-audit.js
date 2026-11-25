const fill = (gray, p) => p ? { k: 'hatch', gray, p } : { k: 'solid', gray };
const grey = fill('#A6A6A6'), dark = fill('#4C4C4C'), white = fill('#FFFFFF'), stripe = fill('#FFFFFF', 'slash');
export const energy = [
  ['석유', [['A', 18.9, grey], ['B', 11.6, fill('#808080')], ['사우디아라비아', 11.2, white], ['캐나다', 6.4, stripe], ['C', 5.2, dark], ['기타', 46.7, fill('#CCCCCC')]]],
  ['천연가스', [['A', 25, grey], ['B', 15.3, fill('#808080')], ['C', 6.4, white], ['D', 6, stripe], ['캐나다', 4.7, dark], ['기타', 42.6, fill('#CCCCCC')]]],
  ['석탄', [['D', 51.7, grey], ['인도', 11.7, fill('#808080')], ['인도네시아', 9, white], ['A', 5, stripe], ['오스트레일리아', 5, dark], ['기타', 17.6, fill('#CCCCCC')]]],
];
export const countValues = [2, 0, 0.5, 4, 6, 8, 18, 12, 5.5, 1.5, 3.5, 3.5];
export const months = countValues.map((v, i) => i + 1 + '월');
export const countPart = { chart: { type: 'scatter', yLabel: '싱크홀 누적 발생 건수(건)',
  points: countValues.map((y, i) => ({ x: i + 1, y, label: months[i] })) } };
export const energyFigure = { title: '2024년 에너지 생산 비중', audit: { entityFills: true }, parts: energy.map(([caption, items]) => ({
  caption, chart: { type: 'stacked', categories: [caption], series: items.map(([name, value, fill]) => ({ name, values: [value], fill })) },
})) };
// Approximate point heights read from the two population transition examples, in per mille.
export const regions = [[31, 7.6, -0.3], [13.7, 7.1, -0.5], [10.3, 8.5, 4.6], [8.4, 11, 2.1]];
const metric = ['출생률', '사망률', '순이동률'];
export const pop = (categories, data) => ({ title: '2023년 대륙별 인구 변천', chart: { type: 'bar', categories, unit: '‰', valueLabels: 'all',
  series: metric.map((name, i) => ({ name, values: data.map(row => row[i]) })) } });
export const [ga, na, da, ra] = ['(가)', '(나)', '(다)', '(라)'];
export const choices = [
  [0, ga, na], [0, na, ga], [1, na, ra], [0, ra, na], [0, da, ga],
].map(([i, left, right]) => ({ series: metric[i], left, right, direction: 'greater' }));
