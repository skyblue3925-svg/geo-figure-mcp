import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { makeFigure } from '../src/build.js';
import { barChart } from '../src/charts.js';
import { bundleData } from '../src/data.js';
import { buildHwpx } from '../src/hwpx.js';
import { figureAnswerKey, makeLinkedFigure, relabelFigure } from '../src/linked.js';
import { sourceTable, tableCsv } from '../src/source-table.js';

const indicator = '주간 인구 지수';
const inflow = '유입 인구-계', outflow = '유출 인구-계';
const p = '경기 포천시', h = '경기 화성시';
const data = bundleData({ key: 'daytime-population', period: '2020', items: [indicator, inflow, outflow], regions: [p, h] });
const options = { indicator, within: ['경기'], breaks: [100, 110], labels: { [p]: 'A', [h]: 'B' },
  comparison: 'daytimeNetInflow', title: '경기도 두 도시의 주간 인구' };
const spec = makeLinkedFigure(data, options);
const teacher = sourceTable(spec, 'teacher');
assert.deepEqual(teacher.rows.map(r => [r[0], r[2], ...r.slice(-3)]), [
  [p, 122.8, 43246, 10553, 32693], [h, 106.7, 219042, 163061, 55981],
]);
assert.match(tableCsv(teacher, spec, 'teacher'), /"2020".*DT_1PA2020/);
assert.ok(!JSON.stringify(sourceTable(spec, 'student')).includes('포천시'));
assert.match(figureAnswerKey([spec]), /A = 경기 포천시 .*32,693명/);
const edited = relabelFigure(spec, { labels: { [p]: '(가)', [h]: '(나)' } });
for (const part of edited.parts.slice(1)) assert.deepEqual(part.chart.categories, ['(나)', '(가)']);
assert.deepEqual(spec.parts[2].chart.categories, ['B', 'A']);
const scene = await makeFigure(edited);
const printed = scene.items.filter(item => item.name === '값').map(item => item.str);
assert.deepEqual(printed, ['106.7', '122.8', '55,981', '32,693']);
assert.ok(scene.items.some(item => item.name === '주석' && item.str.includes('통근·통학')));
const question = { stem: '다음 자료에 대한 설명으로 옳은 것은?', caption: '주간 인구 지수 = (주간 인구 ÷ 상주 인구) × 100',
  choices: ['(가)의 지수가 (나)보다 높다.', '(가)의 순유입 인구가 (나)보다 많다.', '(나)는 순유출 지역이다.',
    '(가)의 지수가 100 미만이다.', '두 지역의 순유입 인구가 같다.'] };
const files = unzipSync(buildHwpx([scene], { question }));
const section = strFromU8(files['Contents/section0.xml']);
assert.ok(!section.includes('pageBreak="1"'));
for (const value of [...printed, ...question.choices]) assert.ok(section.includes(value), value);
assert.ok(!section.includes('<hp:t>포천시</hp:t>'));

// Direct source fields, derived values, rendered categories and units all participate in grading.
for (const corrupt of [
  f => { f.link.regions[0].inflow++; },
  f => { f.parts[2].chart.series[0].values.reverse(); },
  f => { f.parts[2].chart.categories.reverse(); },
  f => { f.parts[2].chart.unit = '%'; },
  f => { f.parts[1].chart.valueLabels = 'none'; },
]) {
  const bad = structuredClone(spec);
  corrupt(bad);
  assert.throws(() => sourceTable(bad, 'teacher'), /원자료와 일치/);
}
const incomplete = structuredClone(data);
delete incomplete.rows[0].values[outflow];
assert.throws(() => makeLinkedFigure(incomplete, options), /유출 인구-계/);
assert.throws(() => makeLinkedFigure({ ...data, rows: data.rows.map(row => ({ ...row, year: 2021 })) }, options), /기간/);
assert.throws(() => makeLinkedFigure({ ...data, unit: { ...data.unit, [inflow]: '천 명' } }, options), /원자료/);
const rounded = makeLinkedFigure(data, { ...options, digits: 0 });
assert.deepEqual(rounded.parts[1].chart.series[0].values, [107, 123]);
assert.deepEqual(rounded.parts[2].chart.series[0].values, [55981, 32693]);

const labels = barChart({ type: 'bar', categories: ['A', 'B', 'C'], series: [{ name: '지표', values: [0, 1.000007, -1234.56789] }],
  valueLabels: 'all' }).filter(item => item.name?.startsWith('막대 ')).flatMap(item => item.items.filter(x => x.name === '값').map(x => x.str));
assert.deepEqual(labels, ['0', '1.000007', '-1,234.56789']);
console.log('paired daytime figure and one-page HWPX passed (' + scene.w.toFixed(1) + ' × ' + scene.h.toFixed(1) + ' mm)');
