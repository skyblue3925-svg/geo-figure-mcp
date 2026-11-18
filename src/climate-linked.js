import { createHash } from 'node:crypto';

const MAP_LABELS = ['A', 'B', 'C', 'D'];
const CHART_LABELS = ['(가)', '(나)', '(다)', '(라)'];

const SOURCES = {
  wmo: ['WMO 기후평년값', 'https://doi.org/10.25921/800j-vn07', 'observation'],
  noaa: ['NOAA GHCN-Daily', 'https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily', 'observation'],
  beck: ['Beck et al.(2023) 0.1° 격자 추정값', 'https://doi.org/10.6084/m9.figshare.21789074', 'grid-estimate'],
};

function sourceFor(row, data, period) {
  const cite = row.cite || data.cite;
  const source = /^Beck/.test(cite) ? SOURCES.beck : /^NOAA GHCN-Daily/.test(cite) ? SOURCES.noaa : /^WMO/.test(cite) ? SOURCES.wmo : undefined;
  if (!source) throw new Error(row.name + '의 기후 자료 출처를 확인할 수 없습니다.');
  // NOAA citations include station identifiers. Use the dataset name on the question.
  const caption = source[0] + (period ? ' (' + period + (source === SOURCES.noaa ? ' 중 관측 기록' : '') + ')' : '');
  return { cite: row.cite || caption, caption, sourceUrl: row.sourceUrl || (source === SOURCES.wmo ? data.sourceUrl : undefined) || source[1], dataType: row.dataType || source[2] };
}

function isKoreanStation({ country, lat, lon }) {
  return country === 'Rep._Korea' || (!country && lat >= 32.9 && lat <= 38.7 && lon >= 124.5 && lon <= 132);
}

function monthly(values, min) {
  return Array.isArray(values) && values.length === 12 &&
    [...values].every((value) => Number.isFinite(value) && value >= min);
}

function chartOrderFor(stations, order) {
  const names = stations.map((station) => station.name);
  if (order !== undefined) {
    if (!Array.isArray(order) || order.length !== names.length || new Set(order).size !== names.length ||
        order.some((name) => !names.includes(name))) {
      throw new Error('chartOrder에는 모든 기후 지점의 이름을 중복 없이 한 번씩 지정하세요.');
    }
    return order;
  }
  if (names.length < 2) return names;
  // Choose a reproducible non-zero rotation for these stations.
  const seed = createHash('sha256').update(JSON.stringify(names)).digest()[0];
  const offset = 1 + seed % (names.length - 1);
  return [...names.slice(offset), ...names.slice(0, offset)];
}

function updateLabels(stations, labels) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new Error('labels는 기후 지점 이름과 지도 기호를 짝지은 객체여야 합니다.');
  }
  for (const name of Object.keys(labels)) {
    if (!stations.some((station) => station.name === name)) throw new Error('기호를 지정할 기후 지점이 없습니다: ' + name);
  }
  const result = stations.map((station) => {
    if (!Object.hasOwn(labels, station.name)) return station;
    const raw = labels[station.name];
    const mapLabel = typeof raw === 'string' && !/[\r\n]/.test(raw) ? raw.trim() : '';
    if (!mapLabel) throw new Error('지도 기호를 비워 두거나 여러 줄로 입력할 수 없습니다.');
    if (CHART_LABELS.includes(mapLabel)) throw new Error('지도와 기후 그래프에는 다른 기호를 지정하세요.');
    return { ...station, mapLabel };
  });
  if (new Set(result.map((station) => station.mapLabel)).size !== stations.length) {
    throw new Error('지도 기호가 중복됩니다. 지점마다 서로 다른 기호를 지정하세요.');
  }
  return result;
}

const mapPoints = (stations) => stations.map(({ lat, lon, mapLabel }) => ({ lat, lon, label: mapLabel }));

export function makeClimateFigure(data, { region, labels = {}, chartOrder, title } = {}) {
  if (!Array.isArray(data?.rows) || data.rows.length < 1 || data.rows.length > MAP_LABELS.length) {
    throw new Error('기후 지점을 1~4곳 지정하세요.');
  }
  const period = String(data.year ?? '');
  const positions = new Set();
  const names = new Set();
  const ids = new Set();
  const stations = updateLabels(data.rows.map((row, index) => {
    const { id, name, station, lat, lon, warn, country, distanceKm, height, stationId, observationYears, cellLat, cellLon } = row;
    if (!name || !id || names.has(name) || ids.has(id)) throw new Error('기후 지점 이름 또는 ID가 비어 있거나 중복됩니다.');
    const point = lat + ',' + lon;
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
      throw new Error(name + '의 위도·경도를 확인할 수 없습니다.');
    }
    if (positions.has(point)) throw new Error('같은 좌표의 기후 지점을 둘 이상 표시할 수 없습니다: ' + name);
    const { temp, precip } = row.values || {};
    if (!monthly(temp, -Infinity) || !monthly(precip, 0)) {
      throw new Error(name + '의 월별 기온과 강수량이 각각 12개 필요합니다.');
    }
    names.add(name);
    ids.add(id);
    positions.add(point);
    return { id, name, station, lat, lon, country, warn: warn ?? null, distanceKm, height, stationId, observationYears, cellLat, cellLon, period: row.period ?? period,
      mapLabel: MAP_LABELS[index], temp: [...temp], precip: [...precip], ...sourceFor(row, data, period) };
  }), labels);

  const korean = stations.every(isKoreanStation);
  const mapRegion = region ?? (korean ? 'korea' : 'world');
  if (!['korea', 'world'].includes(mapRegion)) throw new Error('region은 korea 또는 world를 지정하세요.');
  if (mapRegion === 'korea' && !korean) throw new Error('국외 기후 지점을 포함할 때는 world 지도를 지정하세요.');

  const order = chartOrderFor(stations, chartOrder);
  for (const station of stations) station.chartLabel = CHART_LABELS[order.indexOf(station.name)];
  const chartStations = order.map((name) => {
    const { chartLabel, temp, precip } = stations.find((station) => station.name === name);
    return { label: chartLabel, temp, precip };
  });
  const cites = [...new Set(stations.map((station) => station.caption))];
  const cite = cites.join('; ');
  const sourceUrls = [...new Set(stations.map((station) => station.sourceUrl))];

  return {
    title: title || '기후 지점과 월별 기온·강수량',
    source: cite,
    layout: 'column',
    parts: [
      { map: { region: mapRegion, width: 143, height: mapRegion === 'korea' ? 111 : 72, points: mapPoints(stations) } },
      { chart: { type: 'climate', width: order.length > 1 ? 143 : 82.5, cellHeight: 40, stations: chartStations } },
    ],
    link: { version: 1, kind: 'climate', period, mapPart: 0, chartPart: 1, stations,
      metadata: { period, cite, sourceUrls, ...(sourceUrls.length === 1 ? { sourceUrl: sourceUrls[0] } : {}) } },
  };
}

export function relabelClimateFigure(figure, { partIndex, labels }) {
  const { link, parts } = figure;
  if (link.version !== 1 || link.mapPart !== partIndex || !Array.isArray(link.stations) ||
      !Array.isArray(parts?.[partIndex]?.map?.points)) throw new Error('기호를 수정할 기후 지점이 없습니다.');
  const stations = updateLabels(link.stations, labels);
  return {
    ...figure,
    parts: parts.map((part, index) => index === partIndex
      ? { ...part, map: { ...part.map, points: mapPoints(stations) } } : part),
    link: { ...link, stations },
  };
}

export function climateAnswerEntries(link) {
  return [...link.stations].sort((a, b) => a.mapLabel.localeCompare(b.mapLabel, 'ko', { numeric: true })).map((station) => {
    const place = station.station && station.station !== station.name ? station.name + ' (' + station.station + ')' : station.name;
    const line = station.mapLabel + ' = ' + station.chartLabel + ' = ' + place;
    const detail = [station.cite, station.warn].filter(Boolean).join(' · ');
    return detail ? line + ' — ' + detail : line;
  });
}
