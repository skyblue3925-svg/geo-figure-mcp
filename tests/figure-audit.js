import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/tools.js';

import { choices, countPart, countValues, da, energy, energyFigure, ga, months, na, pop, ra, regions } from './fixtures/figure-audit.js';

const server = createServer();
const client = new Client({ name: 'figure-audit-test', version: '1' });
const [a,b] = InMemoryTransport.createLinkedPair();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-figure-audit-'));
try {
  await server.connect(b);
  await client.connect(a);
  async function rpc(name, args, error = false) {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(Boolean(r.isError), error, r.content[0]?.text);
    return r.content;
  }
  const json = async (name, args) => JSON.parse((await rpc(name, args))[0].text);
  const preview = async (figure) => {
    const content = await rpc('preview_figures', { figures: [figure] });
    return { previewId: content.at(-1).text.match(/previewId: (\w+)/)[1],
      warning: content.some(v => v.type === 'text' && v.text.includes('시안 검산 오류')) };
  };
  const observed = await json('check_figure', { observations: {
    fills: energy.flatMap(([where, rows]) => rows.map(([entity, value, fill]) => ({ entity, where: where + ' ' + value + '%', fill }))),
    counts: countValues.map((value, i) => ({ where: months[i], value })),
  } });
  assert.equal(observed.source, 'observations');
  assert.deepEqual(observed.issues.filter(x => x.code === 'entityFillMismatch').map(x => x.entity).sort(), ['A', 'C', 'D', '캐나다']);
  assert.deepEqual(observed.issues.filter(x => x.code === 'invalidCount').map(x => x.where), ['3월', '9월', '10월', '11월', '12월']);
  for (const figure of [energyFigure, countPart]) {
    const { previewId, warning } = await preview(figure);
    assert.ok(warning);
    assert.equal((await json('check_figure', { previewId })).issueCount, figure === energyFigure ? 4 : 5);
    await rpc('make_figures', { previewId, outDir, confirmed: true }, true);
    assert.deepEqual(fs.readdirSync(outDir), []);
  }
  const alias = { ...energyFigure, parts: structuredClone(energyFigure.parts) };
  alias.parts[0].chart.series[0].entityId = 'US';
  alias.parts[1].chart.series[0].entityId = 'US';
  alias.parts[2].chart.series.find(v => v.name === 'A').entityId = 'US';
  assert.ok((await json('check_figure', { figures: [alias] })).issues.some(v => v.entity === 'US'));
  const countBar = { chart: { type: 'bar', unit: '건', categories: ['A', 'B', 'C'], series: [{ name: '발생', values: [0, -1, 0.5] }] } };
  assert.equal((await json('check_figure', { figures: [countBar] })).issueCount, 2);
  countBar.chart.unit = '천 건';
  countBar.chart.series[0].values = [0, 1, 0.5];
  assert.equal((await json('check_figure', { figures: [countBar] })).issueCount, 0);

  const average = structuredClone(countPart);
  average.chart.yLabel = '월평균 발생 건수(건)';
  assert.equal((await json('check_figure', { figures: [average] })).issueCount, 0);
  const someMap = { parts: [
    { map: { classes: { 중국: 0 }, entityIds: { 중국: 'CHN' } } },
    { chart: { type: 'bar', categories: ['2024'], series: [{ name: 'D', entityId: 'CHN', values: [1], fill: { k: 'solid', gray: '#A6A6A6' } }] } },
  ] };
  assert.equal((await json('check_figure', { figures: [someMap] })).issues[0].entity, 'CHN');

  const old = (await preview(pop([ga, na, da, ra], regions))).previewId;
  const changed = (await preview(pop([na, da, ra, ga], regions))).previewId;
  const reorder = (await preview(pop([ra, da, na, ga], [...regions].reverse()))).previewId;
  const check = (args) => json('check_chart_question', { responseMode: 'compact', ...args });
  const first = await check({ previewId: old, choices });
  assert.equal(first.answer, 1);
  const retry = await check({ previewId: changed, previousQuestionId: first.questionId });
  assert.equal(retry.previousAnswer, 1);
  assert.equal(retry.answer, null);
  assert.deepEqual(retry.correctChoices, [2, 5]);
  assert.equal(retry.questionId, undefined);
  await rpc('make_figures', { previewId: changed, questionId: first.questionId, confirmed: true, outDir }, true);
  const stable = await check({ previewId: reorder, previousQuestionId: first.questionId });
  assert.equal(stable.answer, 1);
  assert.notEqual(stable.questionId, first.questionId);
  assert.equal((await json('make_figures', { previewId: reorder, questionId: stable.questionId, confirmed: true, outDir })).files.length, 1);
  const energyPreview = (await preview(energyFigure)).previewId;
  const countPreview = (await preview(countPart)).previewId;
  const item = previewId => ({ kind: 'previous', previewId, previousQuestionId: first.questionId });
  const items = [item(energyPreview), item(countPreview), item(reorder), item(changed)];
  await rpc('check_questions_batch', { items, confirmed: false, outDir }, true);
  await rpc('check_questions_batch', { items: [...items, item('expired')], confirmed: true, outDir }, true);
  const result = await json('check_questions_batch', { items, confirmed: true, outDir });
  assert.equal(result.length, 4);
  assert.deepEqual(result.slice(0, 2), [{ revise: [1, 2, 3, 4, 5] }, { revise: [1, 2, 3, 4, 5] }]);
  assert.deepEqual(result[3], { revise: [2, 5] });
  assert.deepEqual(Object.keys(result[2]), ['hwpx']);
  assert.ok(fs.statSync(result[2].hwpx).size > 1000);
  const repeat = await json('check_questions_batch', { items, confirmed: true, outDir });
  assert.notEqual(repeat[2].hwpx, result[2].hwpx);
  const fresh = await json('check_questions_batch', { items: [{ kind: 'chart', previewId: changed, choices }], confirmed: true, outDir });
  assert.deepEqual(fresh, [{ revise: [2,5] }]);
  console.log('PNG-derived cases: 4 country fill mismatches, 5 non-integer count positions, edited answer set 1 -> 2 and 5; independent permutation stays 1.');
} finally {
  await client.close();
  await server.close();
  fs.rmSync(outDir, { recursive: true, force: true });
}
