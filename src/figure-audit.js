import { z } from 'zod';
import { CLASS_FILLS, SERIES_FILLS } from './scene.js';

const label = z.string().trim().min(1).max(120);
const solidOrHatch = z.object({
  k: z.enum(['solid', 'hatch']),
  p: z.string().optional(),
  gray: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});
export const auditObservations = z.strictObject({
  fills: z.array(z.strictObject({ entity: label, where: label, fill: solidOrHatch })).max(300).optional(),
  counts: z.array(z.strictObject({ where: label, value: z.number() })).max(300).optional(),
});

const average = /평균|average|\bmean\b/i;
const isCountLabel = label => !average.test(label) && /^(?:건|.*[（(]\s*건\s*[)）])$/.test(label.trim());

function fillCode(fill) {
  const color = (fill.gray ?? '#FFFFFF').toUpperCase();
  return fill.k === 'hatch' ? 'hatch:' + (fill.p || 'slash') + ':' + color : fill.k + ':' + color;
}

export function auditFigureData(figures, observations = {}) {
  const issues = [];
  const auditFills = entries => {
    const byEntity = new Map();
    for (const { entity, where, fill } of entries) {
      const code = fillCode(fill);
      if (!byEntity.has(entity)) byEntity.set(entity, new Map());
      const styles = byEntity.get(entity);
      if (!styles.has(code)) styles.set(code, where);
    }
    for (const [entity, styles] of byEntity) {
      if (styles.size > 1) issues.push({ code: 'entityFillMismatch', entity,
        styles: [...styles].map(([fill, where]) => ({ fill, where })) });
    }
  };
  const auditCounts = entries => {
    for (const { where, value } of entries) {
      if (value == null) continue; // Missing values are checked independently of count precision.
      if (!Number.isSafeInteger(value) || value < 0) issues.push({ code: 'invalidCount', where, value });
    }
  };
  if (observations.fills) auditFills(observations.fills);
  if (observations.counts) auditCounts(observations.counts);
  for (const [i, figure] of figures.entries()) {
    const fills = [];
    for (const [j, part] of (figure.parts || [figure]).entries()) {
      const location = '그림 ' + (i + 1) + ' 자료 ' + (j + 1) + (part.caption ? ' ' + part.caption : '');
      const map = part.map;
      for (const [region, entity] of Object.entries(map?.entityIds ?? {})) {
        const fill = CLASS_FILLS[map.classes?.[region]];
        if (entity && fill) fills.push({ entity, where: location + ' / ' + region, fill });
      }
      const chart = part.chart;
      if (!chart) continue;
      if (['bar', 'stacked', 'deviation'].includes(chart.type)) {
        for (const [k, series] of (chart.series ?? []).entries()) {
          const entity = series.entityId || (figure.audit?.entityFills === true ? series.name : '');
          if (entity && entity !== '기타' && series.values?.some(v => Number.isFinite(v) && v !== 0)) {
            fills.push({ entity, where: location, fill: series.fill || SERIES_FILLS[k % SERIES_FILLS.length] });
          }
          const inferred = chart.type !== 'deviation' && !average.test(series.name ?? '') &&
            isCountLabel(String(series.unit ?? chart.unit ?? ''));
          if (series.measure === 'count' || (series.measure === undefined && inferred)) {
            auditCounts((series.values ?? []).map((value, m) => ({
              where: location + ' / ' + (series.name || '') + ' / ' + (chart.categories?.[m] ?? m + 1), value,
            })));
          }
        }
      }
      if (['scatter', 'bubble'].includes(chart.type)) {
        for (const axis of ['x', 'y']) {
          if (chart.countAxis !== axis && !isCountLabel(String(chart[axis + 'Label'] ?? ''))) continue;
          auditCounts((chart.points ?? []).map((point, m) => ({
            where: location + ' / ' + axis + ' / ' + (point.label || m + 1), value: point[axis],
          })));
        }
      }
    }
    auditFills(fills);
  }
  return { issueCount: issues.length, issues };
}

export function requireCleanFigureData(figures) {
  const { issueCount, issues } = auditFigureData(figures);
  if (!issueCount) return;
  const description = issues.slice(0, 4).map(issue => issue.code === 'invalidCount'
    ? issue.where + '의 건수 ' + issue.value + ' (0 이상의 정수 필요)'
    : issue.entity + '의 색·무늬가 자료별로 다름');
  throw new Error('그림 검산 오류 ' + issueCount + '건 · ' + description.join(' / ') + '. check_figure를 호출해 확인하세요.');
}
