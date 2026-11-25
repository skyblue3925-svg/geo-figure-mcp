import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { unzipSync, strFromU8 } from 'fflate';
import { createReferences } from '../src/references.js';
import { createServer } from '../src/tools.js';

const cities = ['서울', '강릉', '대구', '제주'];
const choices = [
  { kind: 'match', left: 'A', right: '(가)' },
  { kind: 'match', left: 'B', right: '(가)' },
  { kind: 'match', left: 'D', right: '(가)' },
  { kind: 'match', left: 'C', right: '(다)' },
  { kind: 'match', left: 'D', right: '(나)' },
];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-question-pack-test-'));
const references = createReferences(true);
const clients = [];
async function connect(options) {
  const server = createServer({ references, ...options });
  const client = new Client({ name: 'teacher-pack-test', version: '1' });
  clients.push(client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  return async (name, args, expectError = false) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(Boolean(result.isError), expectError, result.content[0]?.text);
    if (expectError) return result.content[0].text;
    if (name === 'preview_figures') return result.content.at(-1).text.match(/previewId: (\w+)/)[1];
    return JSON.parse(result.content[0].text);
  };
}

try {
  const local = await connect({});
  const { dataId } = await local('find_data', { source: 'climate', regions: cities, asReference: true });
  const previewId = await local('preview_figures', { climate: { dataId, chartOrder: ['제주', '대구', '서울', '강릉'] } });
  const checked = await local('check_climate_question', { previewId, choices, responseMode: 'compact' });
  const { questionId } = checked;
  assert.ok(questionId);
  assert.deepEqual(checked, { answer: 3, correctCount: 1, questionId });
  const review = await local('get_question_review', { questionId });
  assert.equal(review.checks.length, 5);
  assert.equal(review.checks[2].evidence.place, '제주');
  await local('get_question_review', { questionId: 'expired' }, true);
  const ambiguous = await local('check_climate_question', { previewId, choices: [...choices.slice(0, 4),
    { kind: 'match', left: 'B', right: '(라)' }], responseMode: 'compact' });
  assert.deepEqual(ambiguous.correctChoices, [3, 5]);
  assert.equal(ambiguous.questionId, undefined);
  assert.ok(ambiguous.reason);

  const args = { previewId, questionId, questionPack: true, confirmed: true, responseMode: 'compact', name: '기후 문항' };
  const outDir = path.join(temp, 'local');
  await local('make_figures', { ...args, previewId: 'different', outDir }, true);
  await local('make_figures', { ...args, confirmed: false, outDir }, true);
  await local('make_figures', { ...args, questionId: undefined, outDir }, true);
  assert.ok(!fs.existsSync(outDir));
  const pack = await local('make_figures', { ...args, outDir });
  assert.deepEqual(Object.keys(pack).sort(), ['studentHwpx', 'teacherCsv']);
  assert.deepEqual(fs.readdirSync(path.dirname(pack.studentHwpx)).sort(), [path.basename(pack.studentHwpx), path.basename(pack.teacherCsv)].sort());
  const zip = unzipSync(fs.readFileSync(pack.studentHwpx));
  const document = Object.values(zip).map(bytes => strFromU8(bytes)).join('\n');
  for (const check of review.checks) assert.ok(document.includes(check.text));
  for (const hidden of [...cities, '정답표', '실제 지점', '관측소 ID', '<hp:tbl ']) assert.ok(!document.includes(hidden), hidden);
  const csv = fs.readFileSync(pack.teacherCsv, 'utf8');
  assert.ok(csv.includes('원자료 URL') && cities.every(name => csv.includes(name)));

  const remoteRoot = path.join(temp, 'remote');
  fs.mkdirSync(remoteRoot);
  let failTeacherLink = false;
  const publish = {
    newDir: () => fs.mkdtempSync(path.join(remoteRoot, 'token-')),
    url(file) {
      if (failTeacherLink && file.endsWith('.csv')) throw new Error('test publication failure');
      return 'https://example.test/' + path.relative(remoteRoot, file).split(path.sep).map(encodeURIComponent).join('/');
    },
    keepText: '1시간',
  };
  const remote = await connect({ remote: true, publish });
  const urls = await remote('make_figures', args);
  const remotePath = url => path.join(remoteRoot, decodeURIComponent(new URL(url).pathname.slice(1)));
  const student = remotePath(urls.studentHwpx), teacher = remotePath(urls.teacherCsv);
  assert.notEqual(path.dirname(student), path.dirname(teacher));
  assert.ok(!fs.existsSync(path.join(path.dirname(student), path.basename(teacher))));
  const downloaded = unzipSync(fs.readFileSync(student));
  assert.ok(strFromU8(downloaded['Contents/section0.xml']).includes(review.stem));
  assert.equal(fs.readFileSync(teacher, 'utf8'), csv);
  const original = fs.readdirSync(remoteRoot).sort();
  failTeacherLink = true;
  assert.match(await remote('make_figures', args, true), /test publication failure/);
  assert.deepEqual(fs.readdirSync(remoteRoot).sort(), original);
  console.log('Verified compact checking, on-demand review, separated local/remote question files and rollback.');
} finally {
  for (const client of clients) await client.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
