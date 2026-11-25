const INDEX = '주간 인구 지수';
const INFLOW = '유입 인구-계';
const OUTFLOW = '유출 인구-계';
const NET = '순유입 인구';
const TABLE_URL = 'https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1PA2020';
const COMPARISON_ERROR = '주간 인구 지수와 순유입 인구 그래프의 단위·기호·표시값이 원자료와 일치해야 합니다.';

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkedCount(row, field, unit) {
  const count = row.values?.[field];
  const units = row.unit ?? unit;
  const declared = typeof units === 'object' && units !== null ? units[field] : units;
  // DT_1PA2020 leaves its unit fields empty. The two total flow columns count persons.
  if (!isCount(count) || (declared && declared !== '명')) {
    throw new Error(row.mapName + '의 ' + field + ' 원자료(명)가 필요합니다. 같은 자료 ID에 유입·유출 인구의 계를 포함하세요.');
  }
  return count;
}

export function withDaytimeComparison(figure, data) {
  const { link } = figure;
  if (link.indicator !== INDEX || link.unit !== '지수' || link.metadata.sourceUrl !== TABLE_URL ||
      !/^\d{4}$/.test(link.metadata.period)) {
    throw new Error('같은 연도 KOSIS 주간 인구 표의 주간 인구 지수와 유입·유출 인구 계를 지정하세요.');
  }
  const sourceRows = new Map(data.rows.map(row => [row.mapName, row]));
  const regions = link.regions.map(region => {
    const row = sourceRows.get(region.mapName);
    if (!row || (row.year != null && String(row.year) !== link.metadata.period)) throw new Error(region.mapName + '의 자료 기간을 확인하세요.');
    const inflow = checkedCount(row, INFLOW, data.unit);
    const outflow = checkedCount(row, OUTFLOW, data.unit);
    return { ...region, inflow, outflow, netInflow: inflow - outflow };
  });
  const byName = new Map(regions.map(r => [r.mapName, r]));
  const plotted = link.chartRegions.map(name => byName.get(name));
  const map = figure.parts[link.mapPart].map;
  const chart = { ...figure.parts[link.chartPart].chart, valueLabels: 'all', width: Math.max(45, plotted.length * 12) };
  const labels = { ...map.labels };
  if (plotted.length <= 5) plotted.forEach((r, i) => { labels[r.mapName] = chart.categories[i]; });
  if (new Set(Object.values(labels)).size !== Object.keys(labels).length) throw new Error('지도 기호가 중복됩니다. 지역별 기호를 확인하세요.');
  const netChart = { ...chart, categories: [...chart.categories], unit: '명',
    series: [{ name: NET, values: plotted.map(r => r.netInflow) }] };
  // Both panels use their own unit and scale. The zero baseline also supports net outflows.
  if (netChart.series[0].values.every(value => value < 0)) netChart.max = 0;
  const result = {
    ...figure,
    parts: [
      { caption: INDEX + ' 분포', map: { ...map, width: 58, labels } },
      { caption: INDEX, chart },
      { caption: NET, chart: netChart },
    ],
    notes: ['순유입 인구 = 유입 인구(통근·통학) − 유출 인구(통근·통학)'],
    link: { ...link, regions, comparison: { kind: 'daytimeNetInflow', chartPart: 2, indicator: NET, unit: '명' } },
  };
  validateDaytimeComparison(result);
  return result;
}

// Check both panels before a saved spec is used for grading or tabulation.
export function validateDaytimeComparison(figure) {
  const { link, parts } = figure;
  const info = link.comparison;
  const primary = parts?.[link.chartPart]?.chart;
  const secondary = parts?.[info?.chartPart]?.chart;
  const labels = parts?.[link.mapPart]?.map?.labels ?? {};
  if (info?.kind !== 'daytimeNetInflow' || info.indicator !== NET || info.unit !== '명' ||
      link.indicator !== INDEX || link.unit !== '지수' || link.metadata?.sourceUrl !== TABLE_URL ||
      !/^\d{4}$/.test(link.metadata.period) || !Array.isArray(link.regions) || !Array.isArray(link.chartRegions)) {
    throw new Error(COMPARISON_ERROR);
  }
  const n = link.chartRegions.length;
  for (const [chart, indicator, unit] of [[primary, INDEX, '지수'], [secondary, NET, '명']]) {
    if (chart?.type !== 'bar' || chart.unit !== unit || chart.valueLabels !== 'all' ||
        chart.series?.length !== 1 || chart.series[0].name !== indicator ||
        chart.series[0].values?.length !== n || chart.categories?.length !== n) throw new Error(COMPARISON_ERROR);
  }
  const regions = new Map(link.regions.map(r => [r.mapName, r]));
  if (!n || new Set(link.chartRegions).size !== n || regions.size !== link.regions.length ||
      link.regions.some(r => !Number.isFinite(r.value) || !isCount(r.inflow) || !isCount(r.outflow) ||
        r.netInflow !== r.inflow - r.outflow)) throw new Error(COMPARISON_ERROR);
  for (const [i, mapName] of link.chartRegions.entries()) {
    const r = regions.get(mapName);
    if (!r || primary.categories[i] !== (labels[mapName] || r.name) || secondary.categories[i] !== primary.categories[i] ||
        primary.series[0].values[i] !== (link.digits === undefined ? r.value : Number(r.value.toFixed(link.digits))) ||
        secondary.series[0].values[i] !== r.netInflow) throw new Error(COMPARISON_ERROR);
  }
}
