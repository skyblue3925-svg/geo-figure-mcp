import { listRegions } from './maps.js';
import { CLASS_FILLS } from './scene.js';
import { climateAnswerEntries, relabelClimateFigure } from './climate-linked.js';
import { withDaytimeComparison, validateDaytimeComparison } from './paired-daytime.js';

export { makeClimateFigure } from './climate-linked.js';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unitFor(unit, indicator) {
  if (unit && typeof unit === 'object') {
    const metric = indicator.split(' · ').at(-1);
    return text(Object.hasOwn(unit, indicator) ? unit[indicator] : Object.hasOwn(unit, metric) ? unit[metric] : undefined);
  }
  if (unit === '명, 지수') {
    if (indicator === '주간인구지수') return '지수';
    if (['상주인구', '유입인구', '유출인구', '주간인구'].includes(indicator)) return '명';
  }
  const value = text(unit);
  return !value.startsWith('[') && !value.includes(', ') ? value : '';
}

function checkedLabels(current, changes, allowed) {
  if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('labels는 지도 지역명과 기호를 짝지은 객체여야 합니다.');
  for (const key of Object.keys(changes)) {
    if (!allowed.has(key)) throw new Error('기호를 지정할 지도 지역이 없습니다: ' + key);
  }
  const labels = Object.fromEntries(Object.entries({ ...current, ...changes }).map(([key, value]) => [key, text(value)]));
  const symbols = Object.values(labels);
  if (symbols.some((symbol) => !symbol || /[\r\n]/.test(symbol))) throw new Error('지도 기호를 비워 두거나 여러 줄로 입력할 수 없습니다.');
  if (new Set(symbols).size !== symbols.length) throw new Error('지도 기호가 중복됩니다. 지역마다 서로 다른 기호를 지정하세요.');
  return labels;
}

function categoryLabels(chartRegions, regions, labels) {
  const byName = new Map(regions.map((r) => [r.mapName, r.name]));
  const categories = chartRegions.map((key) => Object.hasOwn(labels, key) ? labels[key] : byName.get(key));
  if (categories.some((label) => !text(label))) throw new Error('그래프에 해당하는 지도 지역이 없습니다.');
  if (new Set(categories).size !== categories.length) throw new Error('그래프 범주가 중복됩니다. 같은 이름의 지역에 서로 다른 기호를 지정하세요.');
  return categories;
}

export function makeLinkedFigure(data, { indicator, within, breaks, top, labels = {}, title, digits, comparison, valueLabels } = {}) {
  if (!text(indicator)) throw new Error('indicator에 자료의 지표 이름을 지정하세요.');
  if (!Array.isArray(breaks) || breaks.length < 1 || breaks.length >= CLASS_FILLS.length ||
      breaks.some((value, i) => !Number.isFinite(value) || (i > 0 && value <= breaks[i - 1]))) {
    throw new Error('breaks에는 유한한 숫자 1~' + (CLASS_FILLS.length - 1) + '개를 오름차순으로 지정하세요.');
  }
  if (top !== undefined && (!Number.isSafeInteger(top) || top < 1)) throw new Error('top에는 양의 정수를 지정하세요.');
  if (digits !== undefined && (!Number.isInteger(digits) || digits < 0 || digits > 6)) {
    throw new Error('digits에는 0~6 사이 정수를 지정하세요.');
  }
  if (valueLabels !== undefined && valueLabels !== 'all') throw new Error('막대 값 표시에는 valueLabels: "all"을 지정하세요.');
  if (comparison !== undefined && comparison !== 'daytimeNetInflow') throw new Error('알 수 없는 비교 지표입니다.');
  if (!Array.isArray(data?.rows) || !data.rows.length) throw new Error('자료에 지역 행이 없습니다.');

  const seoulDaytime = data.title === '서울 자치구 상주·주간 인구' && String(data.year) === '2020';
  const period = String(data.year ?? '');
  const year = Number(period.slice(0, 4));
  const historical = year > 0 && (year < 2026 || (year === 2026 && period < '202607'));
  const edition = String(data.mapEdition ?? (historical ? '2025' : '2026'));
  if (!['2025', '2026'].includes(edition)) throw new Error('한국 지도 판은 2025 또는 2026을 지정하세요.');
  const scope = within ?? (seoulDaytime ? ['서울'] : undefined);
  if (scope !== undefined && (!Array.isArray(scope) || !scope.length || new Set(scope).size !== scope.length ||
      scope.some((province) => !text(province)))) throw new Error('within에는 중복 없이 시·도 이름을 지정하세요.');
  const level = scope ? 'sigungu' : 'sido';
  const available = new Set(listRegions({ level, within: scope, edition }));
  if (scope?.some((province) => ![...available].some((name) => name.startsWith(province + ' ')))) {
    throw new Error('within에 해당 지도 판의 시·도 이름을 사용하세요: ' + scope.join(', '));
  }

  const regions = [];
  const used = new Set();
  const units = new Set();
  // The bundled daytime table's unit fields are empty. Its two kinds of
  // measures are persons and the daytime-to-resident population index.
  const daytimeUnit = data.title === '성별/연령별 상주(야간) · 주간 인구-시군구'
    ? indicator === '주간 인구 지수' ? '지수' : /^(상주|유입 |유출 |주간 )인구/.test(indicator) ? '명' : ''
    : '';
  const defaultUnit = unitFor(data.unit, indicator) || daytimeUnit;
  for (const row of data.rows) {
    const mapName = row.mapName ?? (seoulDaytime ? '서울 ' + row.name : null);
    if (!available.has(mapName)) continue;
    if (used.has(mapName)) throw new Error('지도 지역의 자료가 중복됩니다: ' + mapName);
    const value = row.values && Object.hasOwn(row.values, indicator) ? row.values[indicator] : undefined;
    if (!Number.isFinite(value)) throw new Error(mapName + '의 지표 값이 없거나 숫자가 아닙니다: ' + indicator);
    const rowUnit = row.unit === undefined ? defaultUnit : unitFor(row.unit, indicator);
    if (!rowUnit) throw new Error('지표의 단위를 확인할 수 없습니다: ' + indicator);
    units.add(rowUnit);
    used.add(mapName);
    regions.push({ mapName, name: text(row.name) || mapName, value });
  }
  if (!regions.length) throw new Error('선택한 지도 범위에서 자료와 일치하는 지역이 없습니다.');
  if (units.size !== 1 || (defaultUnit && !units.has(defaultUnit))) throw new Error('같은 지표에 서로 다른 단위가 사용됐습니다: ' + indicator);
  const [unit] = units;
  const symbols = checkedLabels({}, labels, used);
  const plotted = top === undefined ? regions : [...regions].sort((a, b) => b.value - a.value).slice(0, top);
  const chartRegions = plotted.map((r) => r.mapName);
  const partial = available.size > regions.length;
  if (partial && breaks.length + 2 > CLASS_FILLS.length) {
    throw new Error('자료가 없는 지역까지 구분하려면 breaks를 ' + (CLASS_FILLS.length - 2) + '개 이하로 지정하세요.');
  }
  const classes = Object.fromEntries(regions.map(({ mapName, value }) => [
    mapName, Number(partial) + breaks.filter((threshold) => value >= threshold).length,
  ]));
  const legend = [breaks[0] + ' 미만', ...breaks.slice(1).map((end, i) => breaks[i] + ' 이상 ' + end + ' 미만'), breaks.at(-1) + ' 이상'];
  if (partial) legend.unshift('자료 없음');
  const map = { region: 'korea', level, within: scope, edition, classes, legend, labels: symbols };
  const chart = {
    type: 'bar',
    categories: categoryLabels(chartRegions, regions, symbols),
    series: [{ name: indicator, values: plotted.map((r) => digits === undefined ? r.value : Number(r.value.toFixed(digits))) }],
    unit,
    ...(valueLabels ? { valueLabels } : {}),
  };
  const cite = text(data.cite);
  const sourceUrl = text(data.sourceUrl);
  const source = [cite, period && !cite.includes(period) ? period : ''].filter(Boolean).join(', ');
  const figure = {
    title: text(title) || text(data.title) || indicator,
    source,
    parts: [{ map }, { chart }],
    link: { version: 1, mapPart: 0, chartPart: 1, indicator, unit, regions, chartRegions,
      ...(digits === undefined ? {} : { digits }), metadata: { period, cite, ...(sourceUrl ? { sourceUrl } : {}) } },
  };
  return comparison ? withDaytimeComparison(figure, data) : figure;
}

const MAP_BINDING_ERROR = '저장된 지도와 그래프의 기호를 일대일로 확인할 수 없습니다. 지도와 같은 기호를 그래프에 지정하거나 연결된 그림을 새로 만드세요.';

function replaceMap(figure, partIndex, map) {
  if (!figure.parts) return { ...figure, map };
  return { ...figure, parts: figure.parts.map((part, i) => i === partIndex ? { ...part, map } : part) };
}

function chartLabels(chart) {
  if (['bar', 'stacked', 'deviation'].includes(chart.type) && Array.isArray(chart.categories)) {
    return { symbols: chart.categories, replace: (symbols) => ({ ...chart, categories: symbols }) };
  }
  const field = chart.type === 'climate' ? 'stations' : ['scatter', 'bubble', 'triangle'].includes(chart.type) ? 'points' : undefined;
  if (field && Array.isArray(chart[field])) {
    const entries = chart[field];
    return { symbols: entries.map((entry) => entry.label), replace: (symbols) => ({
      ...chart, [field]: entries.map((entry, i) => ({ ...entry, label: symbols[i] })),
    }) };
  }
  throw new Error(MAP_BINDING_ERROR);
}

export function relabelFigure(figure, { partIndex = 0, labels }) {
  if (figure.link?.kind === 'climate') return relabelClimateFigure(figure, { partIndex, labels });
  const parts = figure.parts || [figure];
  const map = parts[partIndex]?.map;
  if (!map) throw new Error('기호를 수정할 지도 부분이 없습니다.');
  const current = map.labels || {};
  const link = figure.link;
  if (link?.comparison) validateDaytimeComparison(figure);
  if (link && (link.version !== 1 || link.mapPart !== partIndex)) throw new Error(MAP_BINDING_ERROR);
  if (link && (!Array.isArray(link.regions) || !Array.isArray(link.chartRegions))) throw new Error(MAP_BINDING_ERROR);
  const regions = link?.regions;
  const allowed = new Set(regions ? regions.map((r) => r.mapName) : Object.keys(current));
  if (link && (allowed.size !== regions.length || !link.chartRegions.length ||
      new Set(link.chartRegions).size !== link.chartRegions.length ||
      link.chartRegions.some((name) => !allowed.has(name)))) throw new Error(MAP_BINDING_ERROR);
  const next = checkedLabels(current, labels, allowed);
  const result = replaceMap(figure, partIndex, { ...map, labels: next });
  if (link) {
    const chartPart = result.parts?.[link.chartPart];
    if (chartPart?.chart?.type !== 'bar') throw new Error(MAP_BINDING_ERROR);
    const categories = categoryLabels(link.chartRegions, regions, next);
    result.parts[link.chartPart] = { ...chartPart, chart: { ...chartPart.chart, categories } };
    if (link.comparison) {
      const i = link.comparison.chartPart;
      result.parts[i] = { ...result.parts[i], chart: { ...result.parts[i].chart, categories: [...categories] } };
    }
    return result;
  }
  const chartParts = parts.filter((part) => part.chart);
  if (!chartParts.length) return result;
  if (parts.filter((part) => part.map).length !== 1 || !figure.parts) throw new Error(MAP_BINDING_ERROR);
  const previous = new Map(Object.entries(checkedLabels({}, current, allowed)).map(([name, symbol]) => [symbol, name]));
  result.parts = result.parts.map((part) => {
    if (!part.chart) return part;
    const { symbols, replace } = chartLabels(part.chart);
    if (!symbols.length || new Set(symbols).size !== symbols.length || symbols.some((symbol) => !previous.has(symbol))) {
      throw new Error(MAP_BINDING_ERROR);
    }
    return { ...part, chart: replace(symbols.map((symbol) => next[previous.get(symbol)])) };
  });
  return { ...result, legacyLabelMapPart: partIndex };
}

export function figureAnswerKey(figures) {
  const sections = [];
  for (const [i, figure] of figures.entries()) {
    const link = figure.link?.version === 1 ? figure.link : undefined;
    const heading = figures.length > 1 ? [(i + 1) + '. ' + (figure.title || '그림')] : [];
    if (link?.kind === 'climate') {
      sections.push([...heading, ...climateAnswerEntries(link)].join('\n'));
      continue;
    }
    const map = figure.parts?.[link?.mapPart ?? figure.legacyLabelMapPart]?.map;
    if (!map?.labels) continue;
    const labels = Object.entries(map.labels).sort(([, a], [, b]) => a.localeCompare(b, 'ko', { numeric: true }));
    if (!labels.length) continue;
    const entries = labels.map(([name, symbol]) => {
      const region = link?.regions.find((r) => r.mapName === name);
      const net = link?.comparison ? ', 순유입 인구 ' + region.netInflow.toLocaleString('ko-KR') + '명' : '';
      return symbol + ' = ' + name + (region ? ' (' + link.indicator + ' ' + region.value + ' ' + link.unit + net + ')' : '');
    });
    sections.push([...heading, ...entries].join('\n'));
  }
  return sections.length ? ['정답표', ...sections].join('\n') : undefined;
}
