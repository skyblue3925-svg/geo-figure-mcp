import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { unzipSync, strFromU8 } from 'fflate';
import { createServer } from '../src/tools.js';
import { makeFigure } from '../src/build.js';
import { renderPng } from '../src/svg.js';
import { climateChart } from '../src/charts.js';

const cities = ['서울', '강릉', '대구', '제주'];
const order = ['제주', '대구', '서울', '강릉'];
const source = JSON.parse(fs.readFileSync(new URL('../data/wmo-normals-1991-2020.json', import.meta.url)));
const stationIds = [47108, 47105, 47860, 47184];
const observations = new Map(cities.map((city, i) => [city, source.stations.find(s => +s[0] === stationIds[i])]));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-source-tables-'));
const client = new Client({ name: 'source-table-test', version: '1' });
const server = createServer();
const [a, b] = InMemoryTransport.createLinkedPair();
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, a + ' != ' + b);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, r.content[0].text);
  return r.content;
};
const query = async (name, args) => JSON.parse((await call(name, args))[0].text);
const id = result => result.at(-1).text.match(/previewId: (\w+)/)[1];
const section = file => strFromU8(unzipSync(fs.readFileSync(file))['Contents/section0.xml']);
function csvRecords(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  return lines.map(line => Array.from((line + ',').matchAll(/(?:"((?:[^"]|"")*)"|([^,]*)),/g), m => (m[1] ?? m[2]).replaceAll('""','"')));
}

try {
  await server.connect(b);
  await client.connect(a);
  const ref = await query('find_data', { source: 'climate', regions: cities, asReference: true });
  assert.equal(ref.rowCount, 4);
  assert.equal(ref.rows, undefined);
  const climate = { dataId: ref.dataId, chartOrder: order, title: '우리나라 네 지점의 기후 (1991~2020년)' };
  // Cached web schemas can require the figures array.
  const p = await call('preview_figures', { figures: [{ climate }] });
  const previewId = id(p);
  const args = { confirmed: true, outDir: out, name: '우리나라 네 지점의 기후' };
  const hwpx = await query('make_figures', { ...args, figures: [{ previewId }], formats: ['hwpx'], audience: 'student' });
  const csv = await query('make_figures', { ...args, previewId, formats: ['csv'], audience: 'teacher' });
  const spec = JSON.parse(fs.readFileSync(hwpx.specFile)).figures[0];
  const preview = Buffer.from(p.find(x => x.type === 'image').data, 'base64');
  assert.deepEqual(preview, Buffer.from(renderPng(await makeFigure(spec), { width: 800 })));
  const teacher = await query('get_source_table', { previewId, audience: 'teacher' });
  const student = await query('get_source_table', { previewId, audience: 'student' });
  assert.equal(teacher.rows.length, 48);
  assert.equal(student.rows.length, 48);
  const [header, ...records] = csvRecords(csv.files[0]);
  assert.ok(header.includes('원자료 URL'));
  assert.equal(records.length, 48);
  const sectionXml = section(hwpx.files[0]);
  assert.ok(!sectionXml.includes('정답표') && !cities.some(c => sectionXml.includes('<hp:t>' + c + '</hp:t>')));
  assert.ok(!cities.some(c => JSON.stringify(student).includes(c)));
  const chart = spec.parts[spec.link.chartPart].chart;
  const panels = climateChart(chart).filter(s => s.name?.startsWith('기후 그래프 '));
  assert.equal(panels.length, 4);
  const readAxis = (panel, name) => {
    const ticks = panel.items.find(it => it.name === name).items.filter(it => it.name === '눈금 값');
    const [low, high] = [ticks[0], ticks.at(-1)];
    return y => +low.str + (y - low.y) / (high.y - low.y) * (+high.str - +low.str);
  };
  let checked = 0;
  for (const [panelIndex, panel] of panels.entries()) {
    const city = order[panelIndex];
    const station = observations.get(city);
    const symbol = spec.link.stations.find(s => s.name === city).chartLabel;
    assert.equal(panel.name, '기후 그래프 ' + symbol);
    const temp = readAxis(panel, '세로축'), rain = readAxis(panel, '오른쪽 세로축');
    const bars = panel.items.find(it => it.name === '강수량 막대').items;
    const line = panel.items.find(it => it.name === '기온 선').pts;
    for (let i = 0; i < 12; i++) {
      const row = records.find(r => r[2] === city && +r[3] === i + 1);
      assert.equal(row[1], symbol);
      assert.equal(row[0], 'ABCD'[cities.indexOf(city)]);
      assert.deepEqual([+row[4], +row[5]], [station[6][i], station[7][i]]);
      assert.deepEqual(teacher.rows.find(r => r[2] === city && r[3] === i + 1).slice(4, 6), [+row[4],+row[5]]);
      assert.deepEqual(student.rows.find(r => r[0] === symbol && r[1] === i + 1).slice(2), [+row[4],+row[5]]);
      close(temp(line[i][1]), +row[4]);
      close(rain(bars[i].y), +row[5]);
      checked += 2;
    }
  }
  console.log('Verified WMO observations, teacher CSV, student table and plotted coordinates:', checked);
  const choices = [
    { kind: 'match', left: 'A', right: '(가)' },
    { kind: 'temperature', month: 1, left: 'B', right: 'D', direction: 'greater' },
    { kind: 'jjaPrecipitation', left: 'A', right: '(나)', direction: 'greater' },
    { kind: 'temperatureRange', left: '(가)', right: '(다)', direction: 'greater' },
    { kind: 'precipitation', month: 7, left: 'C', right: 'A', direction: 'greater' },
  ];
  const verify = choices => query('check_climate_question', { previewId, choices });
  const question = await verify(choices);
  assert.deepEqual(question.checks.map(c => c.correct), [false, false, true, false, false]);
  assert.equal(question.answer, 3);
  assert.deepEqual(question.checks.slice(1).map(c => [c.evidence.leftValue, c.evidence.rightValue]),
    [[0.9, 6.1], [892.1, 598.4], [21.1, 28.1], [223.9, 414.4]]);
  for (const [index, count] of [[2, 0], [3, 2]]) {
    const revised = choices.map((choice, i) => i === index ? { ...choice, direction: 'less' } : choice);
    const result = await verify(revised);
    assert.equal(result.correctCount, count);
    assert.equal(result.answer, null);
    assert.equal(result.questionId, undefined);
  }
  const questionArgs = { ...args, previewId, questionId: question.questionId, name: '한국지리_네_지점의_기후_문항_학생용' };
  const exam = await query('make_figures', questionArgs);
  assert.equal(exam.files.length, 1);
  const examXml = section(exam.files[0]);
  assert.ok(examXml.includes(question.stem));
  assert.ok(!examXml.includes('정답') && !examXml.includes('pageBreak="1"') && !cities.some(c => examXml.includes('<hp:t>' + c + '</hp:t>')));
  for (const [i, check] of question.checks.entries()) assert.ok(examXml.includes('①②③④⑤'[i] + ' ' + check.text));
  for (const invalid of [{ previewId: 'unrelated' }, { formats: ['pptx'] }, { appendTable: true }]) {
    const result = await client.callTool({ name: 'make_figures', arguments: { ...questionArgs, ...invalid } });
    assert.equal(result.isError, true);
  }
  if (process.env.GEO_QUESTION_EXAMPLE_DIR) {
    const dest = process.env.GEO_QUESTION_EXAMPLE_DIR;
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(exam.files[0], path.join(dest, path.basename(exam.files[0])));
    fs.copyFileSync(csv.files[0], path.join(dest, 'observations.csv'));
    fs.writeFileSync(path.join(dest, 'verification.json'), JSON.stringify(question));
  }
  const append = await query('make_figures', { ...args, name: '자료표 시험', previewId, appendTable: true, audience: 'student', formats: ['hwpx'] });
  const appendix = section(append.files[0]);
  assert.ok(appendix.includes('<hp:tbl ') && appendix.includes('월평균 기온') && !appendix.includes('정답표'));
  assert.ok(!cities.some(c => appendix.includes('<hp:t>' + c + '</hp:t>')));
  if (process.env.GEO_CLIMATE_EXAMPLE_DIR) {
    const dest = process.env.GEO_CLIMATE_EXAMPLE_DIR;
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(hwpx.files[0], path.join(dest, '한국_네_지점_기후_학생용.hwpx'));
    fs.copyFileSync(csv.files[0], path.join(dest, '한국_네_지점_기후_교사용_원자료.csv'));
    fs.writeFileSync(path.join(dest, '한국_네_지점_기후_시안.png'), preview);
  }
  const indicator = '주간 인구 지수';
  const bundle = { key: 'daytime-population', items: [indicator], period: '2020', within: ['경기'] };
  const regional = await query('find_data', {source:'bundle',bundle, asReference:true});
  const regionalId = id(await call('preview_figures',{ linked:{dataId:regional.dataId, indicator, within:['경기'], breaks:[100], top:5, digits:0} }));
  const table = await query('get_source_table',{previewId:regionalId,audience:'teacher'});
  const actual = await query('find_data',{source:'bundle',bundle});
  assert.equal(table.rows.length,31);
  assert.equal(table.rows.filter(r=>r.at(-1)==='포함').length,5);
  for (const row of table.rows) {
    assert.equal(row[2],actual.rows.find(r=>r.mapName===row[0]).values[indicator]);
    if (row.at(-1)==='포함') assert.equal(row[3],Number(row[2].toFixed(0)));
  }
  assert.ok(table.notes.some(n=>n.includes('DT_1PA2020')));
} finally {
  await client.close(); await server.close();
  fs.rmSync(out,{ recursive:true,force:true });
}
