import assert from 'node:assert/strict';
import { bundleData, findData } from '../src/data.js';
import { makeFigure } from '../src/build.js';
import { figureAnswerKey, makeLinkedFigure, relabelFigure } from '../src/linked.js';

const data = bundleData({ key: 'daytime-population', within: ['경기'], period: '2020' });
const indicator = Object.keys(data.rows[0].values).find((name) => /지수/.test(name));
assert.ok(indicator);
const breaks = [90, 100, 110];
const options = { indicator, within: ['경기'], breaks };
const original = makeLinkedFigure(data, options);
assert.equal(original.parts[0].map.edition, '2025');
assert.deepEqual(original.link.chartRegions, data.rows.map((row) => row.mapName));
assert.deepEqual(original.parts[1].chart.series[0].values, data.rows.map((row) => row.values[indicator]));
assert.equal(original.parts[0].map.classes['경기 화성시'], 2);
assert.equal(figureAnswerKey([original]), undefined);
assert.equal(original.parts[0].map.legend.length, breaks.length + 1);
const subset = { ...data, rows: [data.rows[0]] };
const partialMap = makeLinkedFigure(subset, options).parts[0].map;
assert.equal(partialMap.legend[0], '자료 없음');
assert.equal(partialMap.classes[subset.rows[0].mapName], original.parts[0].map.classes[subset.rows[0].mapName] + 1);
assert.equal(Object.keys(partialMap.classes).length, 1);
assert.throws(() => makeLinkedFigure(subset, { ...options, breaks: [90, 95, 100, 105, 110] }), /자료가 없는 지역/);

const top = makeLinkedFigure(data, { ...options, top: 1 });
const [first] = top.link.chartRegions;
const second = top.link.regions.find((r) => r.mapName !== first).mapName;
const labels = { [first]: 'A', [second]: 'B' };
const labeled = makeLinkedFigure(data, { ...options, top: 1, labels });
assert.equal(labeled.link.regions.length, original.link.regions.length);
assert.deepEqual(labeled.parts[1].chart.categories, ['A']);
const swapped = relabelFigure(JSON.parse(JSON.stringify(labeled)), { labels: { [first]: 'B', [second]: 'A' } });
assert.deepEqual(swapped.parts[1].chart.categories, ['B']);
assert.deepEqual(labeled.parts[1].chart.categories, ['A']);
assert.ok(figureAnswerKey([swapped]).startsWith('정답표\nA = ' + second));
assert.ok(figureAnswerKey([swapped]).includes('\nB = ' + first));
assert.deepEqual(swapped.parts[1].chart.series, labeled.parts[1].chart.series);
assert.ok((await makeFigure(swapped)).items.some((item) => item.name === '항목 B'));

const seoulData = await findData({ source: 'seoul-daytime' });
const seoul = makeLinkedFigure(seoulData, { indicator: '주간인구지수', breaks });
assert.equal(seoul.link.regions.length, 25);
assert.equal(seoul.link.unit, '지수');
assert.deepEqual(seoul.parts[0].map.within, ['서울']);
assert.equal(makeLinkedFigure(seoulData, { indicator: '주간인구', breaks }).link.unit, '명');
const energy = bundleData({ key: 'energy-consumption' });
const energyIndicator = Object.keys(energy.rows[0].values)[0];
assert.equal(makeLinkedFigure(energy, { indicator: energyIndicator, breaks }).link.unit, '1,000 toe');

const legacy = { parts: [{ map: { labels } }, { chart: { type: 'scatter', points: [{ label: 'B', x: 20, y: 1 }, { label: 'A', x: 10, y: 2 }] } }] };
const edited = relabelFigure(legacy, { labels: { [first]: 'B', [second]: 'A' } });
assert.deepEqual(edited.parts[1].chart.points, [{ label: 'A', x: 20, y: 1 }, { label: 'B', x: 10, y: 2 }]);
assert.equal(figureAnswerKey([edited]), '정답표\nA = ' + second + '\nB = ' + first);
const climate = { type: 'climate', stations: [{ label: 'A', temp: [1], precip: [2] }] };
const triangle = { type: 'triangle', points: [{ label: 'B', a: 20, b: 30, c: 50 }] };
const both = relabelFigure({ parts: [legacy.parts[0], { chart: climate }, { chart: triangle }] }, { labels: { [first]: 'C', [second]: 'D' } });
assert.deepEqual(both.parts[1].chart.stations, [{ ...climate.stations[0], label: 'C' }]);
assert.deepEqual(both.parts[2].chart.points, [{ ...triangle.points[0], label: 'D' }]);
assert.throws(() => relabelFigure({ ...labeled, link: { ...labeled.link, regions: [...labeled.link.regions, labeled.link.regions[0]] } },
  { labels: { [first]: 'C' } }), /일대일/);
assert.throws(() => relabelFigure({ parts: [legacy.parts[0], { chart: { type: 'bar', categories: ['X'] } }] }, { labels: { [first]: 'C' } }), /일대일/);
assert.throws(() => relabelFigure({ parts: [legacy.parts[0], { chart: { type: 'bar', categories: ['A', 'A'] } }] }, { labels: { [first]: 'C' } }), /일대일/);
const standalone = relabelFigure(legacy.parts[0], { labels: { [first]: 'C' } });
assert.equal(standalone.map.labels[first], 'C');
assert.equal(figureAnswerKey([standalone]), undefined);
assert.throws(() => relabelFigure(labeled, { labels: { [first]: 'B' } }), /중복/);

assert.throws(() => makeLinkedFigure(data, { ...options, breaks: [90, 90] }), /오름차순/);
assert.throws(() => makeLinkedFigure(data, { ...options, top: 0 }), /양의 정수/);
assert.throws(() => makeLinkedFigure(data, { ...options, labels: { '경기 범위를 벗어난 곳': 'A' } }), /지역이 없습니다/);
assert.throws(() => makeLinkedFigure(data, { ...options, within: ['없는시도'] }), /시·도 이름/);
assert.throws(() => makeLinkedFigure({ ...data, rows: [...data.rows, data.rows[0]] }, options), /자료가 중복/);
assert.throws(() => makeLinkedFigure({ ...data, rows: [{ ...data.rows[0], values: {} }] }, options), /지표 값이 없거나/);
assert.throws(() => makeLinkedFigure({ ...data, title: '단위 미상', unit: {}, rows: [data.rows[0]] }, options), /단위를 확인/);
assert.throws(() => makeLinkedFigure({ ...data, rows: [data.rows[0], { ...data.rows[1], unit: '톤' }] }, options), /서로 다른 단위/);

console.log('linked figure tests passed');
