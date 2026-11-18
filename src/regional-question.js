import { z } from 'zod';
import { sourceTable } from './source-table.js';

const label = z.string().trim().min(1).max(100);
const positive = z.number().int().positive();
export const regionalChoices = z.array(z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('chartRank'), region: label, rank: positive }),
  z.strictObject({ kind: z.literal('bandCount'), band: label, count: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('sameBand'), left: label, right: label }),
  z.strictObject({ kind: z.literal('coversThreshold'), threshold: z.number().finite() }),
  z.strictObject({ kind: z.literal('daytimeSurplus'), region: label, percent: positive }),
])).length(5);

// Linked maps generate lower-inclusive, upper-exclusive numeric bands. Verify
// those boundaries independently of the assigned map classes before grading.
function parseBand(text) {
  if (text === '자료 없음') return null;
  const m = /^(?:(\S+) 이상(?:,? (\S+) 미만)?|(\S+) 미만)$/.exec(text);
  if (!m || m.slice(1).some(s => s !== undefined && !Number.isFinite(Number(s)))) {
    throw new Error('수치 경계를 확인할 수 있는 지도 범례가 필요합니다: ' + text);
  }
  return { low: Number(m[1] ?? -Infinity), high: Number(m[2] ?? m[3] ?? Infinity) };
}

export function checkRegionalQuestion(figure, choices) {
  const { link, parts } = figure;
  if (link?.version !== 1 || !Array.isArray(link.regions) || !Array.isArray(link.chartRegions)) {
    throw new Error('원자료가 연결된 지역 통계 지도와 막대그래프가 필요합니다.');
  }
  const map = parts?.[link.mapPart]?.map, chart = parts?.[link.chartPart]?.chart;
  const series = chart?.series?.[0];
  if (!Array.isArray(map?.legend) || chart?.type !== 'bar' || chart.series?.length !== 1 ||
      series.name !== link.indicator || chart.unit !== link.unit || !link.chartRegions.length ||
      series.values?.length !== link.chartRegions.length || chart.categories?.length !== link.chartRegions.length) {
    throw new Error('막대그래프와 원자료의 지표·범주를 확인하세요.');
  }
  const bands = new Map(map.legend.map(text => [text, parseBand(text)]));
  const ranges = [...bands.values()].filter(Boolean);
  if (bands.size !== map.legend.length || ranges[0]?.low !== -Infinity || ranges.at(-1)?.high !== Infinity ||
      ranges.some(({low, high}, i) => low >= high || (i > 0 && ranges[i - 1].high !== low))) {
    throw new Error('지도 범례의 수치 구간이 연속이어야 합니다.');
  }
  const plottedIndex = new Map(link.chartRegions.map((name, i) => [name, i]));
  const names = new Map(link.regions.map(r => [r.mapName, r.name]));
  if (names.size !== link.regions.length || plottedIndex.size !== link.chartRegions.length ||
      link.chartRegions.some(name => !names.has(name))) throw new Error('그래프와 원자료의 지역이 일치하지 않습니다.');
  const visible = new Map();
  const rows = sourceTable(figure, 'teacher').rows.map(([name, , raw, shown, band]) => {
    const limits = bands.get(band);
    if (!Number.isFinite(raw) || !limits || raw < limits.low || raw >= limits.high) {
      throw new Error(name + '의 원값과 지도 범례가 일치하지 않습니다.');
    }
    const index = plottedIndex.get(name);
    const symbol = map.labels?.[name];
    const label = symbol || (index !== undefined ? names.get(name) : undefined);
    if (index !== undefined && (chart.categories[index] !== label ||
        shown !== (link.digits === undefined ? raw : Number(raw.toFixed(link.digits))))) {
      throw new Error(name + '의 막대 기호 또는 표시값과 원자료가 일치하지 않습니다.');
    }
    const row = { name, label, raw, shown, band, plotted: index !== undefined };
    if (label) {
      if (visible.has(label)) throw new Error('자료에 중복된 지역 기호가 있습니다: ' + label);
      visible.set(label, row);
    }
    return row;
  });
  const get = key => {
    const row = visible.get(key);
    if (!row) throw new Error('자료에 표시된 이름이나 기호를 지정하세요: ' + key);
    return row;
  };
  const daytime = link.unit === '지수' && ['주간 인구 지수', '주간인구지수'].includes(link.indicator);
  const checks = choices.map((c, i) => {
    const result = (text, correct, evidence) => ({ number: i + 1, text, correct, evidence });
    switch (c.kind) {
      case 'chartRank': {
        const r = get(c.region);
        if (!r.plotted || c.rank > plottedIndex.size) throw new Error('그래프에 나타난 지역과 가능한 순위를 지정하세요.');
        const rank = 1 + rows.filter(v => v.plotted && v.shown > r.shown).length;
        return result('막대 높이로 볼 때 ' + r.label + '의 순위는 ' + c.rank + '위이다.', rank === c.rank,
          { name: r.name, displayedValue: r.shown, rank });
      }
      case 'bandCount': {
        if (!bands.get(c.band)) throw new Error('자료에 있는 수치 범례를 지정하세요.');
        const count = rows.filter(r => r.band === c.band).length;
        return result('지도에서 ‘' + c.band + '’ 구간에 속하는 지역은 ' + c.count + '곳이다.', count === c.count, { band: c.band, count });
      }
      case 'sameBand': {
        const a = get(c.left), b = get(c.right);
        if (a === b) throw new Error('서로 다른 두 지역을 지정하세요.');
        return result(a.label + '·' + b.label + ' 두 지역은 지도에서 같은 범례 구간에 속한다.',
          a.band === b.band, { leftValue: a.raw, leftBand: a.band, rightValue: b.raw, rightBand: b.band });
      }
      case 'coversThreshold': {
        if (!ranges.some(r => r.low === c.threshold)) throw new Error('지도에서 판독할 수 있는 범례 경계를 지정하세요.');
        const eligible = rows.filter(r => r.raw >= c.threshold);
        if (!eligible.length) throw new Error('기준을 충족하는 지역이 없습니다.');
        const represented = eligible.filter(r => r.plotted).length;
        return result('지도에서 ' + c.threshold + ' 이상인 지역은 모두 막대그래프에 제시되어 있다.',
          represented === eligible.length, { total: eligible.length, represented, omittedExample: eligible.find(r => !r.plotted)?.name });
      }
      case 'daytimeSurplus': {
        if (!daytime) throw new Error('주간인구지수 자료에서만 주간 인구와 상주 인구의 관계를 판정할 수 있습니다.');
        const r = get(c.region), cutoff = 100 + c.percent;
        const correct = r.raw >= cutoff, range = bands.get(r.band);
        if (!(range.low >= cutoff || range.high <= cutoff) && (!r.plotted || (r.shown >= cutoff) !== correct)) {
          throw new Error('그림에서 이 기준을 판별할 수 없습니다.');
        }
        return result(r.label + '의 주간 인구는 상주 인구보다 ' + c.percent + '% 이상 많다.', correct,
          { name: r.name, index: r.raw, thresholdIndex: cutoff });
      }
    }
  });
  if (new Set(checks.map(c => c.text)).size !== 5) throw new Error('서로 다른 선지 다섯 개가 필요합니다.');
  const correct = checks.filter(c => c.correct);
  return { stem: '다음 자료에 대한 설명으로 옳은 것은?', caption: [figure.title || link.indicator,
      ...(daytime ? ['주간 인구 지수 = (주간 인구 ÷ 상주 인구) × 100'] : [])].join('   |   '),
    checks, correctCount: correct.length, answer: correct.length === 1 ? correct[0].number : null };
}
