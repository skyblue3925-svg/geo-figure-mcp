import { z } from 'zod';

const label = z.string().trim().min(1).max(120);
export const chartChoices = z.array(z.strictObject({
  series: label, left: label, right: label, direction: z.enum(['greater', 'less']),
})).length(5);

export function checkChartQuestion(figure, choices) {
  const charts = (figure.parts || [figure]).map(part => part.chart).filter(Boolean);
  if (charts.length !== 1 || charts[0].type !== 'bar' || charts[0].stacked) {
    throw new Error('표시값을 비교할 단일 묶은 막대그래프가 필요합니다.');
  }
  const { categories, series, valueLabels } = charts[0];
  if (!Array.isArray(categories) || !Array.isArray(series) || new Set(categories).size !== categories.length ||
      new Set(series.map(s => s.name)).size !== series.length) throw new Error('범주 및 지표 이름을 중복 없이 지정하세요.');
  if (valueLabels !== 'all') throw new Error('묶은 막대 검산에는 막대 값 표시(valueLabels: "all")가 필요합니다.');
  const checks = choices.map(({ series: metric, left, right, direction }, i) => {
    const s = series.find(v => v.name === metric);
    const a = s?.values?.[categories.indexOf(left)], b = s?.values?.[categories.indexOf(right)];
    if (left === right || !Number.isFinite(a) || !Number.isFinite(b)) throw new Error(i + 1 + '번 선지의 지표와 서로 다른 두 범주를 확인하세요.');
    const greater = direction === 'greater';
    return { number: i + 1, text: metric + '은(는) ' + left + '이(가) ' + right + '보다 ' + (greater ? '높다.' : '낮다.'),
      correct: greater ? a > b : a < b, evidence: { left, right, leftValue: a, rightValue: b } };
  });
  if (new Set(checks.map(c => c.text)).size !== 5) throw new Error('서로 다른 선지 다섯 개가 필요합니다.');
  const correct = checks.filter(c => c.correct);
  return { stem: '그래프를 보고 옳은 설명을 고르시오.', checks, correctCount: correct.length,
    answer: correct.length === 1 ? correct[0].number : null };
}
