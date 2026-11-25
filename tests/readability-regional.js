import assert from 'node:assert/strict';
import { bundleData } from '../src/data.js';
import { makeLinkedFigure, relabelFigure } from '../src/linked.js';
import { checkRegionalQuestion, regionalChoices } from '../src/regional-question.js';

const indicator = '주간 인구 지수';
const query = { key: 'daytime-population', period: '2020', within: ['경기'],
  items: [indicator, '유입 인구-계', '유출 인구-계'] };
const data = bundleData(query);
const options = { within: ['경기'], indicator, breaks: [90, 100, 110], top: 5 };
const choices = [
  { kind: 'chartRank', region: '과천시', rank: 2 },
  { kind: 'bandCount', band: '110 이상', count: 4 },
  { kind: 'daytimeSurplus', region: '포천시', percent: 10 },
  { kind: 'sameBand', left: '과천시', right: '안성시' },
  { kind: 'coversThreshold', threshold: 100 },
];
const legacy = checkRegionalQuestion(makeLinkedFigure(data, options), choices);
assert.deepEqual(legacy.checks.map(c => c.correct), [false, false, true, false, false]);
assert.equal(legacy.correctCount, 1);
assert.equal(legacy.answer, null);
assert.equal(legacy.checks[3].readable, false);
assert.match(legacy.reason, /4번/);
assert.equal(legacy.checks[4].readable, true); // More eligible map areas than bars.
const printed = checkRegionalQuestion(makeLinkedFigure(data, { ...options, valueLabels: 'all' }), choices);
assert.equal(printed.answer, 3);
assert.ok(printed.checks.every(c => c.readable && c.readability));

const synthetic = {
  title: '모형', year: '2020', unit: '지수',
  rows: [
    { name: '포천시', mapName: '경기 포천시', values: { [indicator]: 110.02 } },
    { name: '화성시', mapName: '경기 화성시', values: { [indicator]: 109.98 } },
  ],
};
const small = { within: ['경기'], indicator, breaks: [100, 110] };
const nearby = [
  { kind: 'chartRank', region: '포천시', rank: 1 },
  { kind: 'bandCount', band: '110 이상', count: 0 },
  { kind: 'sameBand', left: '포천시', right: '화성시' },
  { kind: 'daytimeSurplus', region: '화성시', percent: 10 },
  { kind: 'indicatorCompare', indicator, left: '포천시', right: '화성시', direction: 'less' },
];
const close = checkRegionalQuestion(makeLinkedFigure(synthetic, small), nearby);
assert.equal(close.correctCount, 1);
assert.equal(close.answer, null);
assert.deepEqual(close.checks.map(c => c.readable), [false, true, false, false, false]);
const withMap = makeLinkedFigure(synthetic, { ...small, labels: { '경기 포천시': '포천시', '경기 화성시': '화성시' } });
assert.equal(checkRegionalQuestion(withMap, nearby).answer, 1);
const exact = makeLinkedFigure(synthetic, { ...small, valueLabels: 'all' });
assert.equal(checkRegionalQuestion(exact, nearby).answer, 1);
const rounded = makeLinkedFigure(synthetic, { ...small, digits: 0, valueLabels: 'all' });
const tie = checkRegionalQuestion(rounded, nearby);
assert.equal(tie.checks[0].evidence.rank, 1);
assert.equal(tie.checks[0].readable, true); // Printed 110 = 110 for height rank.
assert.equal(tie.checks[3].readable, false); // A rounded 110 cannot establish the raw cutoff.
assert.equal(tie.checks[4].readable, false); // Nor the underlying strict ordering of the index.
assert.equal(tie.answer, null);

const two = bundleData({ ...query, regions: ['경기 포천시', '경기 화성시'] });
const paired = makeLinkedFigure(two, { ...small, comparison: 'daytimeNetInflow' });
const checkPair = [
  { kind: 'higherPair', left: '포천시', right: '화성시', higherIndex: '포천시', higherNet: '화성시' },
  { kind: 'indicatorCompare', indicator: '순유입 인구', left: '포천시', right: '화성시', direction: 'greater' },
  { kind: 'indicatorCompare', indicator, left: '포천시', right: '화성시', direction: 'less' },
  { kind: 'sameBand', left: '포천시', right: '화성시' },
  { kind: 'bandCount', band: '110 이상', count: 2 },
];
regionalChoices.parse(checkPair);
const verified = checkRegionalQuestion(paired, checkPair);
assert.equal(verified.answer, 1);
assert.equal(verified.checks[0].evidence.comparisons.length, 2);
assert.deepEqual(verified.checks[0].evidence.comparisons.map(c => c.readable), [true, true]);
assert.match(verified.checks[0].readability, /122\.8/);
assert.match(verified.checks[0].readability, /명/);
assert.throws(() => checkRegionalQuestion(paired, [{ ...checkPair[0], higherNet: '안성시' }, ...checkPair.slice(1)]), /두 지역 중/);
assert.throws(() => checkRegionalQuestion(exact, checkPair), /함께 제시/);
const relabeled = relabelFigure(paired, { labels: { '경기 포천시': 'A', '경기 화성시': 'B' } });
const symbols = JSON.parse(JSON.stringify(checkPair).replaceAll('포천시', 'A').replaceAll('화성시', 'B'));
assert.equal(checkRegionalQuestion(relabeled, symbols).answer, 1);
assert.ok(!checkRegionalQuestion(relabeled, symbols).checks[0].text.includes('포천'));
assert.throws(() => checkRegionalQuestion(relabeled, checkPair), /표시된 이름/);

console.log('Regional print evidence, rounding, rank ties and paired indicators verified.');
