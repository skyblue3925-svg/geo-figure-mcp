// Native HWPX tables. Split at row boundaries so each page begins with the column headings.
const BODY_SIZE = 9;
const NOTE_SIZE = 9;
const CELL_PAD_X = 280;
const CELL_PAD_Y = 175;

const glyphWidth = (ch) => /[ -~]/.test(ch) ? 0.8 : 1.1;
const linesOf = (value) => String(value ?? '').split(/\r\n|[\r\n]/);
const textLength = (line) => [...line].reduce((sum, ch) => sum + glyphWidth(ch), 0);

function lineCount(value, width, size) {
  // Break using the same per-character wrapping as the appendix paragraph style.
  const capacity = width / (size * 100);
  return linesOf(value).reduce((total, line) => {
    let lines = 1;
    let used = 0;
    for (const ch of line) {
      const next = glyphWidth(ch);
      if (used > 0 && used + next > capacity) {
        lines++;
        used = 0;
      }
      used += next;
    }
    return total + lines;
  }, 0);
}

function columnWidths(columns, rows, width) {
  const weights = columns.map((column, i) => {
    const longest = [column, ...rows.map((row) => row[i])]
      .reduce((max, value) => Math.max(max, ...linesOf(value).map(textLength)), 0);
    // Preserve space for short headings even if another column has lengthy values.
    return Math.min(24, Math.max(5, longest + 1));
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((value) => Math.floor(width * value / total));
  widths[widths.length - 1] += width - widths.reduce((sum, value) => sum + value, 0);
  return widths;
}

function rowHeight(row, widths) {
  const lines = Math.max(...widths.map((width, i) =>
    lineCount(row[i], width - 2 * CELL_PAD_X, BODY_SIZE)));
  return lines * BODY_SIZE * 150 + 2 * CELL_PAD_Y;
}

const margin = `left="${CELL_PAD_X}" right="${CELL_PAD_X}" top="${CELL_PAD_Y}" bottom="${CELL_PAD_Y}"`;

function tableXml(rows, heights, widths, { width, next, plain, cellPara, cellText }) {
  const height = heights.reduce((sum, value) => sum + value, 0);
  const table = `<hp:tbl id="${next()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rows.length}" colCnt="${widths.length}" cellSpacing="0" borderFillIDRef="3" noAdjust="0">`
    + `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>`
    + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
    + `<hp:inMargin ${margin}/>`;
  const grid = rows.map((row, ri) => {
    const isHeader = ri === 0;
    const cells = widths.map((w, ci) => {
      const value = row[ci] ?? '';
      const align = isHeader ? 'CENTER' : typeof value === 'number' ? 'RIGHT' : 'LEFT';
      return `<hp:tc name="" header="${isHeader ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="3">`
        + '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
        + plain(cellText(value), BODY_SIZE, isHeader, cellPara(align))
        + '</hp:subList>'
        + `<hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/>`
        + `<hp:cellSz width="${w}" height="${heights[ri]}"/><hp:cellMargin ${margin}/></hp:tc>`;
    });
    return `<hp:tr>${cells.join('')}</hp:tr>`;
  });
  return table + grid.join('') + '</hp:tbl>';
}

export function tableAppendix(tables, { width, usable, next, P, charPr, paraPr, esc, firstSection = '' }) {
  const text = (value) => linesOf(value).map((line) => esc(line
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\p{Surrogate}]/gu, '�'))).join('<hp:lineBreak/>');
  const plain = (content, size, bold, pp, pageBreak = false, beforeText = '') =>
    P(`<hp:run charPrIDRef="${charPr(size, bold)}">${beforeText}<hp:t>${content}</hp:t></hp:run>`, pp, pageBreak);
  const cellPara = (align) => paraPr(align, 125, 0, 0, true);
  const notePara = () => paraPr('LEFT', 135, 200, 0, true);
  const result = [];

  for (const { title, columns, rows, notes = [] } of tables) {
    const widths = columnWidths(columns, rows, width);
    const headerHeight = rowHeight(columns, widths);
    const firstNoteHeight = notes.length ? lineCount(notes[0], width, NOTE_SIZE) * NOTE_SIZE * 150 + 200 : 0;
    // Keep room for the title, the paragraph holding the inline table, and the first note.
    const limit = usable - lineCount(`${title} (계속)`, width, 11) * 1700 - 2400
      - Math.min(firstNoteHeight, 6500);
    let chunk = [columns];
    let heights = [headerHeight];
    let total = headerHeight;
    let page = 0;
    const flush = () => {
      const label = page++ === 0 ? title : `${title} (계속)`;
      const section = result.length === 0 ? firstSection : '';
      result.push(plain(text(label), 11, true, paraPr('LEFT', 130, 450, 0, true), !section, section));
      result.push(P(`<hp:run charPrIDRef="${charPr(BODY_SIZE, false)}">`
        + tableXml(chunk, heights, widths, { width, next, plain, cellPara, cellText: text })
        + '<hp:t/></hp:run>', paraPr('LEFT', 100, 480)));
      chunk = [columns];
      heights = [headerHeight];
      total = headerHeight;
    };
    for (const row of rows) {
      const height = rowHeight(row, widths);
      if (chunk.length > 1 && total + height > limit) flush();
      chunk.push(row);
      heights.push(height);
      total += height;
    }
    flush();
    notes.forEach((note) => result.push(plain(text(note), NOTE_SIZE, false, notePara())));
  }
  return result;
}
