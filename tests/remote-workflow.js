// 원격 도구를 실제 HTTP로 호출한다. 외부 조회나 실제 운영 토큰을 사용하지 않는다.
// node tests/remote-workflow.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const token = 'remote-workflow-test';
const indicator = '주간 인구 지수';
const title = '경기도 주간 인구 지수';
const within = ['경기'];
const breaks = [100];
const query = { source: 'bundle', bundle: { key: 'daytime-population', items: [indicator], period: '2020', within } };
const exportArgs = { confirmed: true, name: title, formats: ['hwpx'] };
const idAbsent = (id) => (id.at(-1) === '0' ? '1' : '0').padStart(id.length, '0');
const bytes = (messages) => messages.reduce((sum, message) => sum + Buffer.byteLength(message, 'utf8'), 0);

async function availablePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await availablePort();
const base = 'http://127.0.0.1:' + port;
const temp = await mkdtemp(path.join(os.tmpdir(), 'geo-remote-workflow-'));
const filesDir = path.join(temp, 'files');
const child = spawn(process.execPath, [fileURLToPath(new URL('../src/http.js', import.meta.url))], {
  env: {
    ...process.env, PORT: String(port), PUBLIC_URL: base, ACCESS_TOKEN: token,
    FILES_DIR: filesDir, GEO_FIGURE_NO_UPDATE_CHECK: '1', DAILY_MAX: '600',
    HOME: temp, USERPROFILE: temp,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let log = '';
child.stdout.on('data', (chunk) => { log += chunk; });
child.stderr.on('data', (chunk) => { log += chunk; });
const stopped = new Promise((resolve) => {
  child.once('exit', resolve);
  child.once('error', (error) => { log += String(error); resolve(); });
});

const request = (url, options = {}) => fetch(url, {
  ...options, redirect: 'error', signal: AbortSignal.timeout(10000),
});

let nextId = 0;
async function call(name, args) {
  const id = ++nextId;
  const response = await request(base + '/mcp', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(response.status, 200, name);
  const body = await response.json();
  assert.equal(body.id, id);
  assert.ifError(body.error);
  return body.result;
}

function readText(name, result) {
  assert.ok(!result.isError, name + ': ' + result.content[0]?.text);
  assert.equal(result.content[0].type, 'text', name);
  return result.content[0].text;
}

async function preview(args) {
  const result = await call('preview_figures', args);
  assert.ok(!result.isError, result.content[0]?.text);
  const images = result.content.filter(({ type }) => type === 'image');
  assert.equal(images.length, 1);
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(Buffer.from(images[0].data, 'base64').subarray(1, 4).toString(), 'PNG');
  const id = result.content.at(-1).text.match(/previewId:\s*([a-zA-Z0-9_-]+)/)?.[1];
  assert.match(id || '', /^[a-f0-9]{48}$/, result.content.at(-1).text);
  return id;
}

async function rejects(name, args) {
  const result = await call(name, args);
  assert.equal(result.isError, true, name + ' accepted invalid arguments: ' + JSON.stringify(args));
}

async function download(args) {
  const result = JSON.parse(readText('make_figures', await call('make_figures', args)));
  assert.equal(result.files.length, 1);
  assert.ok(!Object.hasOwn(result, 'specFile'));
  const [url] = result.files;
  assert.equal(new URL(url).origin, base);
  assert.ok(url.endsWith('.hwpx'));
  const response = await request(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/hwp+zip');
  const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.ok(zip['Contents/section0.xml']);
  const missing = await request(url);
  assert.equal(missing.status, 404, '다운로드 주소는 한 번만 사용한다.');
  await missing.text();
  const section = strFromU8(zip['Contents/section0.xml']);
  const allXml = Object.entries(zip).filter(([name]) => name.endsWith('.xml')).map(([, data]) => strFromU8(data)).join('\n');
  return { ...result, section, allXml };
}

try {
  const deadline = Date.now() + 10000;
  let reachable = false;
  let connectionError;
  while (!reachable && Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    try {
      const response = await request(base + '/health');
      reachable = response.ok && (await response.json()).mcp === base + '/mcp';
    } catch (error) {
      connectionError = error.cause || error;
      await delay(100);
    }
  }
  assert.ok(reachable, 'HTTP 서버에 연결하지 못했습니다.\n' + log + (connectionError || ''));

  const refQuery = { ...query, asReference: true };
  const refText = readText('find_data', await call('find_data', refQuery));
  const ref = JSON.parse(refText);
  assert.match(ref.dataId || '', /^[a-f0-9]{48}$/);
  assert.equal(ref.rowCount, 31);
  assert.ok(!Object.hasOwn(ref, 'rows'));
  const another = JSON.parse(readText('find_data', await call('find_data', refQuery)));
  assert.match(another.dataId || '', /^[a-f0-9]{48}$/);
  assert.notEqual(another.dataId, ref.dataId);

  const linked = { dataId: ref.dataId, indicator, within, breaks, title };
  const previewId = await preview({ linked });
  const anotherPreviewId = await preview({ linked: { ...linked, dataId: another.dataId } });
  assert.notEqual(previewId, anotherPreviewId);
  await rejects('preview_figures', { linked: { ...linked, dataId: idAbsent(ref.dataId) } });
  await rejects('make_figures', { ...exportArgs, previewId: idAbsent(previewId) });
  await rejects('make_figures', { ...exportArgs, previewId, confirmed: false });
  await rejects('make_figures', { ...exportArgs, previewId, style: { size: 10 } });
  assert.deepEqual(await readdir(filesDir), [], '잘못된 요청으로 다운로드 파일이 생기면 안 된다.');

  const fullText = readText('find_data', await call('find_data', query));
  const full = JSON.parse(fullText);
  assert.equal(full.rows.length, ref.rowCount);
  const classes = Object.fromEntries(full.rows.map((row) => [row.mapName, Number(row.values[indicator] >= breaks[0])]));
  const map = { region: 'korea', level: 'sigungu', edition: full.mapEdition, within, classes, legend: ['100 미만', '100 이상'], labels: {} };
  const chart = {
    type: 'bar',
    categories: full.rows.map((row) => row.name),
    series: [{ name: indicator, values: full.rows.map((row) => row.values[indicator]) }],
    unit: '지수',
  };
  const source = full.cite.includes(full.year) ? full.cite : full.cite + ', ' + full.year;
  const figure = { title, source, parts: [{ map }, { chart }] };
  const legacyPreview = { figures: [figure] };
  const legacySave = { ...exportArgs, figures: [figure] };
  const compactSave = { ...exportArgs, previewId };
  await rejects('preview_figures', { ...legacyPreview, linked });
  await rejects('make_figures', { ...legacySave, previewId });
  await preview(legacyPreview);
  const expected = await download(legacySave);
  const compact = await download(compactSave);
  assert.ok(compact.section === expected.section, '연결 시안과 전체 명세의 Contents/section0.xml이 일치해야 한다.');

  const labels = { '경기 화성시': 'A', '경기 수원시': 'B' };
  const labeledId = await preview({ linked: { ...linked, labels } });
  const labeled = await download({ ...exportArgs, previewId: labeledId });
  assert.ok(labeled.answerKey.includes('A = 경기 화성시'));
  assert.ok(labeled.answerKey.includes('B = 경기 수원시'));
  assert.ok(labeled.section.includes('<hp:t>A</hp:t>'));
  assert.ok(labeled.section.includes('<hp:t>B</hp:t>'));
  const edit = { previewId: labeledId, labels: { '경기 화성시': 'C' } };
  const editedId = await preview({ edit });
  assert.notEqual(editedId, labeledId);
  await rejects('preview_figures', { edit: { ...edit, previewId: idAbsent(editedId) } });
  await rejects('preview_figures', { edit, linked });
  const edited = await download({ ...exportArgs, previewId: editedId });
  const expectedLabels = { ...labels, ...edit.labels };
  const expectedKey = ['정답표', ...['경기 수원시', '경기 화성시'].map((name) => {
    const value = full.rows.find((row) => row.mapName === name).values[indicator];
    return expectedLabels[name] + ' = ' + name + ' (' + indicator + ' ' + value + ' 지수)';
  })].join('\n');
  assert.equal(edited.answerKey, expectedKey);
  const expectedChart = { ...chart, categories: full.rows.map((row) => expectedLabels[row.mapName] || row.name) };
  const editedBaseline = await download({
    ...legacySave, figures: [{ ...figure, parts: [{ map: { ...map, labels: expectedLabels } }, { chart: expectedChart }] }],
  });
  assert.ok(edited.section === editedBaseline.section, '수정 후 지도와 막대그래프에 동일한 기호가 적용되어야 한다.');
  assert.ok(edited.section.includes('<hp:t>C</hp:t>'));
  assert.ok(edited.section.includes('<hp:t>B</hp:t>'));
  assert.ok(!edited.section.includes('<hp:t>A</hp:t>'));
  for (const artifact of [labeled, edited]) {
    assert.doesNotMatch(artifact.allXml, /정답표|[ABC] = 경기/);
  }

  const encode = (args) => JSON.stringify(args);
  const measurements = {
    save: { legacy: [encode(legacySave)], compact: [encode(compactSave)] },
    workflowInput: {
      legacy: [query, legacyPreview, legacySave].map(encode),
      compact: [refQuery, { linked }, compactSave].map(encode),
    },
    workflowInputAndFindOutput: {
      legacy: [encode(query), fullText, encode(legacyPreview), encode(legacySave)],
      compact: [encode(refQuery), refText, encode({ linked }), encode(compactSave)],
    },
  };
  const metrics = Object.fromEntries(Object.entries(measurements).map(([kind, { legacy, compact }]) =>
    [kind, { legacy: bytes(legacy), compact: bytes(compact) }]));
  for (const { legacy, compact } of Object.values(metrics)) assert.ok(compact < legacy);
  console.log('원격 HTTP 워크플로 통과 (UTF-8 바이트)', JSON.stringify(metrics));
  if (process.env.GEO_BENCH_FILE) {
    await writeFile(process.env.GEO_BENCH_FILE, JSON.stringify(measurements, null, 2) + '\n');
  }
} finally {
  child.kill();
  await stopped;
  await rm(temp, { recursive: true, force: true, maxRetries: 5 });
}
