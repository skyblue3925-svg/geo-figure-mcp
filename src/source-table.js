import { validateDaytimeComparison } from './paired-daytime.js';

function detail(label, value) {
  return value == null || value === '' ? '' : label + ' ' + value;
}

function regionTable(figure, teacher) {
  const { link } = figure;
  const paired = Boolean(link.comparison);
  if (paired) validateDaytimeComparison(figure);
  const map = figure.parts?.[link.mapPart]?.map;
  const chart = figure.parts?.[link.chartPart]?.chart;
  const plottedValues = chart?.series?.[0]?.values;
  if (!Array.isArray(link.regions) || !Array.isArray(link.chartRegions) || !map || !Array.isArray(plottedValues)) return undefined;

  const metadata = link.metadata ?? {};
  const hasLabels = Object.keys(map.labels ?? {}).length > 0;
  const chartIndex = new Map(link.chartRegions.map((name, i) => [name, i]));
  const regions = [...link.regions].sort((a, b) => b.value - a.value);
  const suffix = link.unit ? ' (' + link.unit + ')' : '';
  const notes = [
    detail('지표', link.indicator),
    detail('자료 시기', metadata.period),
    detail('출처', metadata.cite ?? figure.source),
    detail('원자료', metadata.sourceUrl),
    '순위는 원값이 큰 순서입니다. 원값이 같으면 같은 순위를 표시합니다.',
  ].filter(Boolean);
  if (Number.isInteger(link.digits)) notes.push((paired ? '지수 그래프 값' : '그래프 값') + '은 소수 ' + link.digits + '자리까지 반올림한 값입니다.');
  if (paired) notes.push('순유입 인구는 같은 지역·연도의 통근·통학 유입 인구에서 유출 인구를 뺀 값입니다.');
  if (hasLabels) notes.push('기호 없음은 지도나 그래프에 지역 기호가 표시되지 않은 경우입니다.');

  let rank = 0;
  const rows = regions.map((region, i) => {
    if (i === 0 || region.value !== regions[i - 1].value) rank = i + 1;
    const index = chartIndex.get(region.mapName);
    const included = index !== undefined;
    const mapLabel = Object.hasOwn(map.labels ?? {}, region.mapName) ? map.labels[region.mapName] : '';
    const label = mapLabel || (hasLabels ? '기호 없음' : chart.categories?.[index] || region.mapName);
    const classLabel = map.legend?.[map.classes?.[region.mapName]] ?? '';
    return [...(teacher ? [region.mapName, mapLabel || '기호 없음'] : [label]),
      region.value, included ? plottedValues[index] ?? '' : '', classLabel, rank, included ? '포함' : '미포함',
      ...(paired ? [region.inflow, region.outflow, region.netInflow] : [])];
  });
  return {
    title: '그림에 사용한 자료 · 지역 통계',
    columns: [...(teacher ? ['지역명', '지도 기호'] : [hasLabels ? '지역 기호' : '지역']),
      (paired ? '주간 인구 지수 원값' : '원값') + suffix, (paired ? '주간 인구 지수 그래프 값' : '그래프 값') + suffix,
      '지도 범례', paired ? '지수 순위' : '순위', '그래프 포함',
      ...(paired ? ['유입 인구-계 (명)', '유출 인구-계 (명)', '순유입 인구 (명)'] : [])],
    rows,
    notes,
  };
}

function climateTable(figure, teacher) {
  const { link } = figure;
  if (!Array.isArray(link.stations)) return undefined;
  const chartStations = figure.parts?.[link.chartPart]?.chart?.stations;
  if (!Array.isArray(chartStations)) return undefined;

  const period = link.period ?? link.metadata?.period;
  const columns = [...(teacher ? ['지도 기호', '그래프 기호', '실제 지점'] : ['그래프 기호']),
    '월', '월평균 기온 (℃)', '월 강수량 (mm)', ...(teacher ? ['자료 출처 번호'] : [])];
  const rows = [];
  const notes = [detail('자료 기준 기간', period)].filter(Boolean);
  if (teacher) {
    for (const [index, station] of link.stations.entries()) {
      const sourceNumber = index + 1;
      for (let month = 0; month < 12; month++) {
        rows.push([station.mapLabel, station.chartLabel, station.name, month + 1, station.temp[month], station.precip[month], sourceNumber]);
      }
      const provenance = [
        station.name, station.station, detail('관측소 ID', station.stationId),
        station.dataType, detail('자료 기준 기간', station.period ?? period),
        detail('최소 집계 연수', station.observationYears), station.cite, station.sourceUrl, station.warn,
      ].filter(Boolean);
      notes.push(sourceNumber + '. ' + provenance.join(' · '));
    }
  } else {
    for (const station of chartStations) {
      for (let month = 0; month < 12; month++) {
        rows.push([station.label, month + 1, station.temp[month], station.precip[month]]);
      }
    }
    notes.push('지점별 월평균 기온과 월 강수량입니다.');
  }
  return { title: '그림에 사용한 자료 · 월별 기후', columns, rows, notes };
}

export function sourceTable(figure, audience) {
  if (audience !== 'teacher' && audience !== 'student') throw new Error('audience에는 teacher 또는 student를 지정하세요.');
  const linked = figure?.link;
  const table = linked?.version === 1 && (linked.kind === 'climate'
    ? climateTable(figure, audience === 'teacher') : regionTable(figure, audience === 'teacher'));
  if (!table) throw new Error('이 그림에는 원자료 연결이 없습니다. 통계 dataId로 시안을 먼저 만드세요.');
  return table;
}

function csvCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = value == null ? '' : String(value);
  // Quoting alone does not prevent Excel from evaluating a text cell as a formula.
  const safe = /^(?:[\s\u200B\uFEFF]*[=+\-@＝＋－＠]|[\t\r\n])/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function tableCsv(table, figure, audience) {
  const { link } = figure;
  const teacher = audience === 'teacher';
  const columns = [...table.columns, '자료 기간'];
  const period = link.metadata?.period || link.period || '';
  let rows;
  if (link.kind === 'climate' && teacher) {
    columns.push('관측소·격자 이름', '관측소 ID', '자료 유형', '출처', '원자료 URL', '참고');
    rows = table.rows.map(row => {
      const station = link.stations[row.at(-1) - 1];
      return [...row, station.period || period, station.station, station.stationId, station.dataType,
        station.cite, station.sourceUrl, station.warn];
    });
  } else {
    columns.push('출처', '원자료 URL');
    rows = table.rows.map(row => [...row, period, link.metadata?.cite || figure.source, link.metadata?.sourceUrl || '']);
  }
  return '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
