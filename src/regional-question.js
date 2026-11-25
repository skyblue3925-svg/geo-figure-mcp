import { z } from 'zod';
import { barChart } from './charts.js';
import { bounds } from './scene.js';
import { validateDaytimeComparison } from './paired-daytime.js';

const label = z.string().trim().min(1).max(100);
const positive = z.number().int().positive();
export const regionalChoices = z.array(z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('chartRank'), region: label, rank: positive }),
  z.strictObject({ kind: z.literal('bandCount'), band: label, count: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('sameBand'), left: label, right: label }),
  z.strictObject({ kind: z.literal('coversThreshold'), threshold: z.number().finite() }),
  z.strictObject({ kind: z.literal('daytimeSurplus'), region: label, percent: positive }),
  z.strictObject({ kind: z.literal('indicatorCompare'), indicator: label, left: label, right: label,
    direction: z.enum(['greater', 'less']) }),
  z.strictObject({ kind: z.literal('higherPair'), left: label, right: label, higherIndex: label, higherNet: label }),
])).length(5);

function parseBand(text) {
  if (text === '자료 없음') return null;
  const m = /^(?:(\S+) 이상(?:,? (\S+) 미만)?|(\S+) 미만)$/.exec(text);
  if (!m || m.slice(1).some(s => s !== undefined && !Number.isFinite(Number(s)))) {
    throw new Error('수치 경계를 확인할 수 있는 지도 범례가 필요합니다: ' + text);
  }
  return { low: Number(m[1] ?? -Infinity), high: Number(m[2] ?? m[3] ?? Infinity), openHigh: true };
}

const unknown = () => ({ low: -Infinity, high: Infinity });
const below = (range, cutoff) => range.high < cutoff || (range.high === cutoff && range.openHigh === true);
function atLeast(range, cutoff) {
  if (range.low >= cutoff) return true;
  if (below(range, cutoff)) return false;
  return null;
}

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Use the same label strings, strokes and coordinates as the printed diagram. A
// bar without a value label gives only the tick interval clearly bracketing its tip.
// Keep one printed tick mark's length of clearance for visual height comparisons.
function printedBars(chart, style) {
  const scene = barChart(chart, style);
  const axis = scene.find(shape => shape.name === '세로축').items;
  const tick = axis.find(shape => shape.name === '눈금');
  const clearance = Math.abs(tick.pts[1][0] - tick.pts[0][0]);
  const ticks = axis.filter(shape => shape.name === '눈금 값');
  const zero = scene.find(shape => shape.name === '가로축').pts[0][1];
  const groups = scene.filter(shape => shape.t === 'group' && shape.name.startsWith('막대 '));
  const textBoxes = new Map(groups.flatMap(group => group.items.filter(shape => shape.t === 'text'))
    .map(shape => [shape, bounds([shape])]));
  const legible = shape => shape && ![...textBoxes].some(([other, box]) =>
    other !== shape && overlap(textBoxes.get(shape), box));
  return groups.map(group => {
    const rect = group.items.find(shape => shape.t === 'rect');
    const tip = Math.abs(rect.y - zero) >= Math.abs(rect.y + rect.h - zero) ? rect.y : rect.y + rect.h;
    const valueLabel = group.items.find(shape => shape.name === '값');
    const category = group.items.find(shape => shape.t === 'text' && shape.name.startsWith('항목 '));
    const value = legible(valueLabel) ? Number(valueLabel.str.replaceAll(',', '')) : undefined;
    const interval = unknown();
    for (const t of ticks) {
      const v = Number(t.str.replaceAll(',', ''));
      if (t.y - tip > clearance) interval.low = Math.max(interval.low, v);
      if (tip - t.y > clearance) interval.high = Math.min(interval.high, v);
    }
    return { tip, clearance, value, interval, categoryReadable: Boolean(legible(category)) };
  });
}

function barRange(bar, digits) {
  if (!bar?.categoryReadable) return unknown();
  const printed = bar.value === undefined ? bar.interval : { low: bar.value, high: bar.value };
  // The chart may round original observations. In particular a printed 107
  // at zero decimal places cannot establish that the original index was >=107.
  const margin = digits === undefined ? 0 : 0.5 * 10 ** -digits;
  return { low: printed.low - margin, high: printed.high + margin };
}

function compareRanges(a, b) {
  if (below(b, a.low)) return 1;
  if (below(a, b.low)) return -1;
  if (a.low === a.high && a.low === b.low && b.low === b.high) return 0;
  return null;
}

// Monotone rounding preserves strict order when the rounded bars visibly differ.
function barOrder(a, b) {
  if (!a?.categoryReadable || !b?.categoryReadable) return null;
  if (Math.abs(a.tip - b.tip) > a.clearance) return Math.sign(b.tip - a.tip);
  return null;
}

function regionRows(figure, chart, map, bands, style) {
  const { link } = figure;
  const indices = new Map(link.chartRegions.map((name, i) => [name, i]));
  const sourceNames = new Set(link.regions.map(r => r.mapName));
  if (sourceNames.size !== link.regions.length || indices.size !== link.chartRegions.length ||
      link.chartRegions.some(name => !sourceNames.has(name)) ||
      Object.keys(map.classes ?? {}).some(name => !sourceNames.has(name))) {
    throw new Error('그래프와 원자료의 지역이 일치하지 않습니다.');
  }
  const bars = printedBars(chart, style);
  return link.regions.map(region => {
    const { mapName: name, value: raw } = region;
    const band = map.legend[map.classes?.[name]], limits = bands.get(band);
    if (!Number.isFinite(raw) || !limits || raw < limits.low || raw >= limits.high) {
      throw new Error(name + '의 원값과 지도 범례가 일치하지 않습니다.');
    }
    const index = indices.get(name), plotted = index !== undefined;
    const symbol = map.labels?.[name], label = symbol || (plotted ? region.name : undefined);
    const shown = chart.series[0].values[index];
    if (plotted && (chart.categories[index] !== label ||
        shown !== (link.digits === undefined ? raw : Number(raw.toFixed(link.digits))))) {
      throw new Error(name + '의 막대 기호 또는 표시값과 원자료가 일치하지 않습니다.');
    }
    const bar = bars[index], barInterval = barRange(bar, link.digits);
    const rawRange = symbol ? limits : barInterval;
    const threshold = cutoff => atLeast(rawRange, cutoff) ?? atLeast(barInterval, cutoff);
    const possibleBands = symbol ? [band] : [...bands].filter(([, range]) => range &&
      !below(barInterval, range.low) && barInterval.low < range.high).map(([key]) => key);
    return { name, label, symbol, raw, shown, band, index, plotted, bar, barInterval, rawRange, possibleBands, threshold,
      netInflow: region.netInflow };
  });
}

function printedValue(row, bar, unit) {
  if (!bar?.categoryReadable || bar.value === undefined) return '';
  return row.label + ' ' + bar.value.toLocaleString('ko-KR', { maximumFractionDigits: 12 }) + ' ' + unit;
}

export function checkRegionalQuestion(figure, choices, style) {
  const { link, parts } = figure;
  if (link?.version !== 1 || !Array.isArray(link.regions) || !Array.isArray(link.chartRegions)) {
    throw new Error('원자료가 연결된 지역 통계 지도와 막대그래프가 필요합니다.');
  }
  const map = parts?.[link.mapPart]?.map, chart = parts?.[link.chartPart]?.chart;
  const series = chart?.series?.[0];
  if (!Array.isArray(map?.legend) || chart?.type !== 'bar' || chart.stacked || chart.series?.length !== 1 ||
      series.name !== link.indicator || chart.unit !== link.unit || !link.chartRegions.length ||
      series.values?.length !== link.chartRegions.length || chart.categories?.length !== link.chartRegions.length) {
    throw new Error('막대그래프와 원자료의 지표·범주를 확인하세요.');
  }
  if (link.comparison) validateDaytimeComparison(figure);
  const bands = new Map(map.legend.map(text => [text, parseBand(text)]));
  const ranges = [...bands.values()].filter(Boolean);
  if (bands.size !== map.legend.length || ranges[0]?.low !== -Infinity || ranges.at(-1)?.high !== Infinity ||
      ranges.some(({low, high}, i) => low >= high || (i > 0 && ranges[i - 1].high !== low))) {
    throw new Error('지도 범례의 수치 구간이 연속이어야 합니다.');
  }
  const rows = regionRows(figure, chart, map, bands, style);
  const plotted = rows.filter(row => row.plotted);
  const visible = new Map();
  for (const row of rows.filter(r => r.label)) {
    if (visible.has(row.label)) throw new Error('자료에 중복된 지역 기호가 있습니다: ' + row.label);
    visible.set(row.label, row);
  }
  const get = key => {
    const row = visible.get(key);
    if (!row) throw new Error('자료에 표시된 이름이나 기호를 지정하세요: ' + key);
    return row;
  };
  const pair = c => {
    const a = get(c.left), b = get(c.right);
    if (a === b) throw new Error('서로 다른 두 지역을 지정하세요.');
    return [a, b];
  };
  const netBars = link.comparison && printedBars(parts[link.comparison.chartPart].chart, style);
  const daytime = link.unit === '지수' && ['주간 인구 지수', '주간인구지수'].includes(link.indicator);
  const metricComparison = (a, b, indicator) => {
    const primary = indicator === link.indicator;
    if (!primary && indicator !== link.comparison?.indicator) throw new Error('자료에 인쇄된 지표를 지정하세요: ' + indicator);
    const barA = primary ? a.bar : netBars[a.index], barB = primary ? b.bar : netBars[b.index];
    if (!primary && (!barA || !barB)) throw new Error('순유입 인구 그래프에 제시된 두 지역을 지정하세요.');
    const left = primary ? a.raw : a.netInflow, right = primary ? b.raw : b.netInflow;
    const range = (r, bar) => primary ? r.rawRange : barRange(bar);
    const order = compareRanges(range(a, barA), range(b, barB)) ??
      compareRanges(barRange(barA, primary ? link.digits : undefined), barRange(barB, primary ? link.digits : undefined)) ??
      barOrder(barA, barB);
    const values = [printedValue(a, barA, primary ? link.unit : link.comparison.unit),
      printedValue(b, barB, primary ? link.unit : link.comparison.unit)].filter(Boolean);
    const proof = values.length === 2 ? '막대에 표시된 ' + values.join(', ') :
      (primary && a.symbol && b.symbol && a.band !== b.band ? '지도 기호와 범례 ' + a.band + ', ' + b.band : '두 막대의 높이와 축 눈금');
    return { left, right, order, proof };
  };

  const checks = choices.map((c, i) => {
    const result = (text, correct, evidence, readable, readability) => ({ number: i + 1, text, correct, evidence, readable, readability });
    switch (c.kind) {
      case 'chartRank': {
        const r = get(c.region);
        if (!r.plotted || c.rank > plotted.length) throw new Error('그래프에 나타난 지역과 가능한 순위를 지정하세요.');
        const rank = 1 + plotted.filter(v => v.shown > r.shown).length;
        let lowest = 1, highest = 1;
        for (const p of plotted.filter(p => p !== r)) {
          const relation = compareRanges(barRange(p.bar), barRange(r.bar)) ?? barOrder(p.bar, r.bar) ??
            (link.digits === undefined && p.symbol && r.symbol ? compareRanges(p.rawRange, r.rawRange) : null);
          if (relation === 1) lowest++;
          if (relation === 1 || relation === null) highest++;
        }
        const readable = lowest === highest || c.rank < lowest || c.rank > highest;
        const rankText = lowest === highest ? lowest + '위' : lowest + '~' + highest + '위';
        return result('막대 높이로 볼 때 ' + r.label + '의 순위는 ' + c.rank + '위이다.', rank === c.rank,
          { name: r.name, displayedValue: r.shown, rank }, readable,
          '인쇄된 막대에서 판별되는 ' + r.label + '의 순위 범위는 ' + rankText + '입니다.' +
          (readable ? '' : ' 가까운 막대에 값을 표시하거나 그래프 지역 수를 줄이세요.'));
      }
      case 'bandCount': {
        if (!bands.get(c.band)) throw new Error('자료에 있는 수치 범례를 지정하세요.');
        const count = rows.filter(r => r.band === c.band).length;
        return result('지도에서 ‘' + c.band + '’ 구간에 속하는 지역은 ' + c.count + '곳이다.', count === c.count,
          { band: c.band, count }, true, '지도에서 ‘' + c.band + '’ 무늬의 지역을 세면 ' + count + '곳입니다.');
      }
      case 'sameBand': {
        const [a, b] = pair(c);
        const same = a.band === b.band;
        const readable = same ? a.possibleBands.length === 1 && b.possibleBands.length === 1 :
          !a.possibleBands.some(v => b.possibleBands.includes(v));
        return result(a.label + '·' + b.label + ' 두 지역은 지도에서 같은 범례 구간에 속한다.', same,
          { leftValue: a.raw, leftBand: a.band, rightValue: b.raw, rightBand: b.band }, readable,
          readable ? [a, b].map(r => r.label + '의 가능한 범례는 ‘' + r.possibleBands.join('’, ‘') + '’').join(', ') + '입니다.' :
            '두 지역에 지도 기호를 붙이거나 범례 경계의 어느 쪽인지 구별할 수 있는 막대 값을 표시하세요.');
      }
      case 'coversThreshold': {
        if (!ranges.some(r => r.low === c.threshold)) throw new Error('지도에서 판독할 수 있는 범례 경계를 지정하세요.');
        const eligible = rows.filter(r => r.raw >= c.threshold);
        if (!eligible.length) throw new Error('기준을 충족하는 지역이 없습니다.');
        const represented = eligible.filter(r => r.plotted).length;
        const yes = plotted.filter(r => r.threshold(c.threshold) === true).length;
        const possible = plotted.filter(r => r.threshold(c.threshold) !== false).length;
        const omitted = rows.find(r => r.symbol && !r.plotted && r.threshold(c.threshold) === true);
        const complete = rows.length === plotted.length;
        const readable = complete || yes === eligible.length || possible < eligible.length || Boolean(omitted);
        const proof = '지도에서 기준 이상인 지역은 ' + eligible.length + '곳이고 그래프에는 ' + plotted.length + '곳이 있습니다.';
        return result('지도에서 ' + c.threshold + ' 이상인 지역은 모두 막대그래프에 제시되어 있다.',
          represented === eligible.length, { total: eligible.length, represented, omittedExample: eligible.find(r => !r.plotted)?.name },
          readable, proof + (complete ? ' 모든 자료 지역이 그래프에 제시되었습니다.' : omitted ? ' 지도 기호 ' + omitted.symbol + '가 그래프에 없습니다.' :
            ' 막대에서 기준 이상으로 판별되는 곳은 최소 ' + yes + '곳, 최대 ' + possible + '곳입니다.') +
            (readable ? '' : ' 기준선 근처 막대에 값을 표시하거나 지도에 해당 지역 기호를 붙이세요.'));
      }
      case 'daytimeSurplus': {
        if (!daytime) throw new Error('주간인구지수 자료에서만 주간 인구와 상주 인구의 관계를 판정할 수 있습니다.');
        const r = get(c.region), cutoff = 100 + c.percent;
        const correct = r.raw >= cutoff, readable = r.threshold(cutoff) === correct;
        const proof = r.symbol && atLeast(r.rawRange, cutoff) === correct ? '지도 기호 ' + r.label + '의 범례 ‘' + r.band + '’' :
          printedValue(r, r.bar, link.unit) || '막대 끝과 인쇄된 축 눈금';
        return result(r.label + '의 주간 인구는 상주 인구보다 ' + c.percent + '% 이상 많다.', correct,
          { name: r.name, index: r.raw, thresholdIndex: cutoff }, readable,
          readable ? proof + '에서 기준 지수 ' + cutoff + ' 이상인지 판별할 수 있습니다.' :
            '기준 지수 ' + cutoff + ' 전후를 구분할 수 있게 지도 기호와 범례 경계 또는 충분한 자릿수의 막대 값을 표시하세요.');
      }
      case 'indicatorCompare': {
        const [a, b] = pair(c);
        const { left, right, order, proof } = metricComparison(a, b, c.indicator);
        const target = c.direction === 'greater' ? 1 : -1;
        const correct = Math.sign(left - right) === target;
        const readable = order !== null && (order === target) === correct;
        return result(c.indicator + '는 ' + a.label + '의 값이 ' + b.label + '의 값보다 ' + (target === 1 ? '크다.' : '작다.'),
          correct, { indicator: c.indicator, left, right }, readable,
          readable ? proof + '에서 비교할 수 있습니다.' : '두 지역의 ' + c.indicator + ' 값을 구별할 수 있는 자릿수로 표시하세요.');
      }
      case 'higherPair': {
        if (!link.comparison) throw new Error('주간 인구 지수와 순유입 인구가 함께 제시된 자료가 필요합니다.');
        const [a, b] = pair(c);
        if (![c.higherIndex, c.higherNet].every(key => key === a.label || key === b.label)) {
          throw new Error('두 지역 중 지표가 더 큰 곳의 이름이나 기호를 지정하세요.');
        }
        const comparisons = [[link.indicator, c.higherIndex], [link.comparison.indicator, c.higherNet]].map(([indicator, higher]) => {
          const { left, right, order, proof } = metricComparison(a, b, indicator);
          const target = higher === a.label ? 1 : -1;
          const correct = Math.sign(left - right) === target;
          return { indicator, left, right, higher, correct, readable: order !== null && (order === target) === correct, proof };
        });
        const readable = comparisons.every(v => v.readable);
        return result(a.label + '·' + b.label + ' 중 주간 인구 지수는 ' + c.higherIndex +
          ' 쪽이 더 높고, 순유입 인구는 ' + c.higherNet + ' 쪽이 더 많다.', comparisons.every(v => v.correct),
          { comparisons }, readable, comparisons.map(v => v.indicator + '는 ' +
            (v.readable ? v.proof + '에서 판별됩니다.' : '두 지역의 막대 값을 구별할 수 있게 표시하세요.')).join(' '));
      }
    }
  });
  if (new Set(checks.map(c => c.text)).size !== 5) throw new Error('서로 다른 선지 다섯 개가 필요합니다.');
  const correct = checks.filter(c => c.correct), ambiguous = checks.filter(c => !c.readable);
  const answer = correct.length === 1 && !ambiguous.length ? correct[0].number : null;
  const reason = [correct.length !== 1 && '원자료 검산에서 옳은 선지는 ' + correct.length + '개입니다.',
    ...ambiguous.map(c => c.number + '번: ' + c.readability)].filter(Boolean).join(' ');
  return { stem: '다음 자료에 대한 설명으로 옳은 것은?', caption: [figure.title || link.indicator,
      ...(daytime ? ['주간 인구 지수 = (주간 인구 ÷ 상주 인구) × 100'] : [])].join('   |   '),
    checks, correctCount: correct.length, answer, ...(reason ? { reason } : {}) };
}
