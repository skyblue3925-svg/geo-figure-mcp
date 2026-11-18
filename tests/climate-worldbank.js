import assert from 'node:assert/strict';
import { findData } from '../src/data.js';

const regions = ['서울', '강릉', '대구', '제주', '울릉도', '대관령', '서귀포', '수원', '서울특별시'];
const climate = await findData({ source: 'climate', regions, indicators: ['temp'] });
assert.deepEqual(climate.rows.map((row) => row.id), regions);
assert.deepEqual(climate.rows.map((row) => row.station), [
  'Seoul', 'Gangneung', 'Daegu', 'Jeju', 'Ulleungdo', 'Daegwallyeong', 'Seogwipo', 'Suwon', 'Seoul',
]);
for (const row of climate.rows) {
  assert.equal(row.country, 'Rep._Korea');
  assert.equal(row.distanceKm, 0);
  assert.equal(row.values.temp.length, 12);
  assert.equal('precip' in row.values, false);
}
const compatible = await findData({ source: 'climate', regions: ['Seoul', '37.571,126.966', '칭다오'] });
assert.deepEqual(compatible.rows.slice(0, 2).map((row) => row.station), ['Seoul', 'Seoul']);
assert.ok(compatible.rows[2].exam);
await assert.rejects(findData({ source: 'climate', regions: ['없는관측소'] }), /지점을 찾지 못함/);

const country = { id: 'KR', value: 'Korea, Rep.' };
const currentYear = new Date().getUTCFullYear();
const latest = String(currentYear - 1);
const record = (date, value) => ({ country, countryiso3code: 'KOR', date: String(date), value });
const population = 'SP.POP.TOTL';
const urban = 'SP.URB.TOTL.IN.ZS';
const requestedDates = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (address) => {
  const url = new URL(address);
  assert.equal(url.origin, 'https://api.worldbank.org');
  const page = url.searchParams.get('page') || '1';
  if (url.pathname === '/v2/country') {
    const metadata = page === '1' ? [{ id: 'JPN', iso2Code: 'JP' }] : [{ id: 'KOR', iso2Code: 'KR' }];
    return Response.json([{ page, pages: '2' }, metadata]);
  }
  const date = url.searchParams.get('date');
  requestedDates.push(date);
  const indicator = url.pathname.split('/').at(-1);
  const data = {
    [population]: [[record(latest, 51), record(2001, null)], [record(2000, 47), record(1999, 46)]],
    [urban]: [[record(latest, 0), record(2002, 80)], [record(2000, 79)]],
  };
  if (!data[indicator]) return Response.json([{ message: [{ key: 'Invalid value' }] }]);
  const [start, end = start] = date ? date.split(':').map(Number) : [0, Infinity];
  return Response.json([{ page, pages: 2 }, data[indicator][Number(page) - 1].filter((row) => +row.date >= start && +row.date <= end)]);
};

try {
  const options = { source: 'worldbank', indicators: [population, urban], regions: ['KOR'] };
  const defaultResult = await findData(options);
  assert.equal(defaultResult.year, latest);
  assert.equal(defaultResult.rows[0].name, '대한민국');
  assert.deepEqual(defaultResult.rows[0].values, { [population]: 51, [urban]: 0 });
  assert.ok(requestedDates.splice(0).every((date) => date === `2000:${currentYear}`));

  const series = await findData({ ...options, years: true });
  assert.deepEqual(series.rows[0].byYear, {
    1999: { [population]: 46 },
    2000: { [population]: 47, [urban]: 79 },
    2002: { [urban]: 80 },
    [latest]: { [population]: 51, [urban]: 0 },
  });
  assert.ok(requestedDates.splice(0).every((date) => date === null));

  const annual = await findData({ ...options, year: 2000 });
  assert.equal(annual.rows[0].year, '2000');
  assert.deepEqual(annual.rows[0].values, { [population]: 47, [urban]: 79 });
  const annualSeries = await findData({ ...options, year: 2000, years: true });
  assert.deepEqual(annualSeries.rows[0].byYear, { 2000: annual.rows[0].values });
  assert.ok(requestedDates.splice(0).every((date) => date === '2000'));
  await assert.rejects(findData({ ...options, indicators: ['INVALID'] }), /없는 지표이거나 값이 없음: INVALID/);
} finally {
  globalThis.fetch = originalFetch;
}
