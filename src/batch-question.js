import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { makeFigure } from './build.js';
import { auditFigureData } from './figure-audit.js';
import { buildHwpx } from './hwpx.js';
import { checkClimateQuestion, climateChoices } from './climate-question.js';
import { checkRegionalQuestion, regionalChoices } from './regional-question.js';
import { checkChartQuestion, chartChoices } from './chart-question.js';

export const BATCH_TOOL = 'check_questions_batch';
export const MAX_QUESTIONS = 12;
export const questionTypes = {
  climate: { name: 'check_climate_question', schema: climateChoices, check: checkClimateQuestion },
  regional: { name: 'check_regional_question', schema: regionalChoices, check: checkRegionalQuestion },
  chart: { name: 'check_chart_question', schema: chartChoices, check: checkChartQuestion },
};

export const batchItems = z.array(z.strictObject({
  kind: z.enum(['climate', 'regional', 'chart', 'previous']),
  previewId: z.string().min(1),
  choices: z.array(z.record(z.string(), z.unknown())).length(5).optional()
    .describe('기존 기후·지역·막대 검산 도구와 같은 선지 다섯 개'),
  previousQuestionId: z.string().min(1).optional().describe('kind가 previous일 때 기존 문항 ID'),
})).min(1).max(MAX_QUESTIONS);

export function questionDocument({ stem, caption, checks }) {
  return { stem, caption, choices: checks.map(check => check.text) };
}

const ALL_CHOICES = [1, 2, 3, 4, 5];

function findRevisions(review) {
  const correct = review.checks.filter(check => check.correct).map(check => check.number);
  if (!correct.length) return ALL_CHOICES;
  return review.checks.filter(check => check.readable === false ||
    (correct.length > 1 && check.correct)).map(check => check.number);
}

export async function exportCheckedBatch(items, { references, outDir, publish }) {
  const figures = new Map();
  // Resolve references and grade every item before rendering any export.
  const checked = items.map((item, index) => {
    try {
      let preview = figures.get(item.previewId);
      if (!preview) {
        const ref = references.previews.get(item.previewId);
        if (ref?.figures.length !== 1 || ref.compareIndex >= 0) {
          throw new Error('그림이 한 개인 일반 시안의 유효한 ID가 필요합니다.');
        }
        preview = { figure: ref.figures[0], style: ref.st, audit: auditFigureData(ref.figures) };
        figures.set(item.previewId, preview);
      }
      let type = questionTypes[item.kind];
      let choices;
      if (item.kind === 'previous') {
        if (item.choices || !item.previousQuestionId) throw new Error('이전 문항 ID만 지정하세요.');
        const previous = references.questions.get(item.previousQuestionId);
        type = Object.values(questionTypes).find(candidate => candidate.name === previous?.tool);
        if (!type) throw new Error('이전 검산 문항 ID가 없거나 만료되었습니다.');
        choices = previous.choices;
      } else {
        if (item.previousQuestionId) throw new Error('이전 문항 재사용에는 kind: previous를 지정하세요.');
        const parsed = type.schema.safeParse(item.choices);
        if (!parsed.success) throw new Error('선지 다섯 개를 해당 검산 도구와 같은 형식으로 지정하세요.');
        choices = parsed.data;
      }
      if (preview.audit.issueCount) return { revise: ALL_CHOICES };
      const review = type.check(preview.figure, choices, preview.style);
      if (review.answer === null) return { revise: findRevisions(review) };
      return { preview, question: questionDocument(review), name: 'question-' + String(index + 1).padStart(2, '0') + '.hwpx' };
    } catch (error) {
      throw new Error((index + 1) + '번째 문항 · ' + error.message);
    }
  });

  // Render each distinct passing preview once, and serialize before publishing links.
  const ready = [];
  for (const item of checked) {
    if (item.revise) {
      ready.push(item);
      continue;
    }
    const { preview, question, name } = item;
    try {
      preview.drawing ??= await makeFigure(preview.figure, preview.style);
      ready.push({ name, data: buildHwpx([preview.drawing], { style: preview.style, question }) });
    } catch (error) {
      throw new Error(name + ' 저장 준비 실패 · ' + error.message);
    }
  }

  const dirs = [], files = [];
  let localDir;
  try {
    return ready.map(item => {
      if (item.revise) return { revise: item.revise };
      if (!publish && !localDir) {
        fs.mkdirSync(outDir, { recursive: true });
        localDir = fs.mkdtempSync(path.join(outDir, 'geo-questions-'));
        dirs.push(localDir);
      }
      const dir = publish ? publish.newDir() : localDir;
      if (publish) dirs.push(dir);
      const file = path.join(dir, item.name);
      files.push(file);
      fs.writeFileSync(file, item.data);
      return { hwpx: publish ? publish.url(file) : file };
    });
  } catch (error) {
    for (const file of files) fs.rmSync(file, { force: true });
    for (const dir of dirs) fs.rmdirSync(dir);
    throw error;
  }
}
