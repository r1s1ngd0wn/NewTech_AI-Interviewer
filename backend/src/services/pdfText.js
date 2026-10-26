// Turns the positioned text pieces of a PDF page into readable text.
//
// A PDF stores text as small pieces with coordinates, in whatever order the exporting tool wrote
// them. Design-tool exports (two-column CVs especially) write headings before their text, split
// words into pieces and write one column after the other. Reading the pieces in file order and
// joining them with spaces scrambles all of that. This module rebuilds lines from the coordinates:
//   1. pieces on the same baseline become one line; touching pieces are joined without a space,
//   2. a wide gap inside a line starts a new segment (that is the gutter between columns),
//   3. if the page has a clear vertical gutter, the left column is read before the right column,
//      and full-width segments (a profile paragraph under the name) keep their place between them.
// Single-column pages come out in plain top-to-bottom order.

const SAME_LINE = 0.45;        // baseline distance, in text heights, for two pieces to share a line
const JOIN_WITHOUT_SPACE = 0.12; // gaps under this many text heights are kerning, not a space
const COLUMN_GAP = 1.6;        // gaps over this many text heights split a line into segments
const MIN_GUTTER = 0.03;       // narrowest accepted gutter, as a share of the page width
const PARAGRAPH_GAP = 1.7;     // vertical distance (in text heights) that marks a new paragraph

function pieceOf(item) {
  const [, , , scaleY, x, y] = item.transform;
  const height = Math.abs(item.height || scaleY) || 10;
  return { text: item.str, x, y, width: item.width, height };
}

function buildSegments(items) {
  const pieces = items.map(pieceOf).filter((piece) => piece.text && piece.text.trim());
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const piece of pieces) {
    const line = lines.find((candidate) => Math.abs(candidate.y - piece.y) <= SAME_LINE * Math.max(candidate.height, piece.height));
    if (line) { line.pieces.push(piece); line.height = Math.max(line.height, piece.height); } else lines.push({ y: piece.y, height: piece.height, pieces: [piece] });
  }
  const segments = [];
  for (const line of lines) {
    line.pieces.sort((a, b) => a.x - b.x);
    let current = null;
    for (const piece of line.pieces) {
      const gap = current ? piece.x - current.x1 : 0;
      if (current && gap <= COLUMN_GAP * line.height) {
        const joined = gap < JOIN_WITHOUT_SPACE * line.height ? "" : " ";
        current.text = `${current.text.replace(/\s+$/, "")}${joined}${piece.text.replace(/^\s+/, "")}`;
        current.x1 = Math.max(current.x1, piece.x + piece.width);
      } else {
        if (current) segments.push(current);
        current = { text: piece.text.trim(), x0: piece.x, x1: piece.x + piece.width, y: line.y, height: line.height };
      }
    }
    if (current) segments.push(current);
  }
  return segments;
}

// The x position of a vertical gutter that splits the page into two columns, or null. A gutter is a
// band that (almost) no segment crosses; a stray long line reaching into it must not hide it.
function findGutter(segments, pageWidth) {
  const narrow = segments.filter((segment) => segment.x1 - segment.x0 < 0.6 * pageWidth);
  if (narrow.length < 6) return null;
  const BIN = 2;
  const bins = new Array(Math.ceil(pageWidth / BIN) + 1).fill(0);
  for (const segment of narrow) {
    for (let bin = Math.max(0, Math.floor(segment.x0 / BIN)); bin <= Math.min(bins.length - 1, Math.floor(segment.x1 / BIN)); bin++) bins[bin]++;
  }
  const allowed = Math.max(1, Math.floor(0.08 * narrow.length));
  let best = null;
  let start = null;
  for (let bin = 0; bin <= bins.length; bin++) {
    const open = bin < bins.length && bins[bin] <= allowed;
    if (open && start === null) start = bin;
    if (!open && start !== null) {
      const x0 = start * BIN;
      const x1 = bin * BIN;
      const middle = (x0 + x1) / 2;
      if (x1 - x0 >= MIN_GUTTER * pageWidth && middle > 0.2 * pageWidth && middle < 0.8 * pageWidth && (!best || x1 - x0 > best.gap)) best = { gap: x1 - x0, middle };
      start = null;
    }
  }
  if (!best) return null;
  const left = narrow.filter((segment) => segment.x1 <= best.middle + 2).length;
  const right = narrow.filter((segment) => segment.x0 >= best.middle - 2).length;
  return left >= 3 && right >= 3 ? best.middle : null;
}

// Segments row by row, top to bottom; pieces on (nearly) the same baseline read left to right.
function rowOrder(segments) {
  const rows = [];
  for (const segment of [...segments].sort((a, b) => b.y - a.y)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - segment.y) <= SAME_LINE * Math.max(candidate.height, segment.height));
    if (row) row.items.push(segment); else rows.push({ y: segment.y, height: segment.height, items: [segment] });
  }
  return rows.flatMap((row) => row.items.sort((a, b) => a.x0 - b.x0));
}

const isHeadingLike = (segment) => segment.text.length <= 40 && !/\p{Ll}/u.test(segment.text) && /\p{L}{3}/u.test(segment.text);

function readingOrder(segments, gutter, pageWidth) {
  if (gutter === null) return rowOrder(segments);
  // A narrow strip that holds only section headings next to the text under them (a "sidebar of
  // headings") must be read row by row, or every heading would come before all of its text.
  const side = segments.filter((segment) => (segment.x0 + segment.x1) / 2 < gutter);
  if (side.length >= 3 && side.filter(isHeadingLike).length / side.length >= 0.7) return rowOrder(segments);
  const byTop = [...segments].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const ordered = [];
  let left = [];
  let right = [];
  const flush = () => { ordered.push(...left, ...right); left = []; right = []; };
  for (const segment of byTop) {
    const wide = segment.x1 - segment.x0 >= 0.6 * pageWidth;
    if (wide && segment.x0 < gutter && segment.x1 > gutter) { flush(); ordered.push(segment); }
    else if ((segment.x0 + segment.x1) / 2 < gutter) left.push(segment);
    else right.push(segment);
  }
  flush();
  return ordered;
}

function pageToText(items, pageWidth) {
  const segments = buildSegments(items);
  const ordered = readingOrder(segments, findGutter(segments, pageWidth), pageWidth);
  const lines = [];
  let previous = null;
  for (const segment of ordered) {
    // A jump back up the page means the next column started; a big vertical gap means a new paragraph.
    const newBlock = previous && (segment.y > previous.y || previous.y - segment.y > PARAGRAPH_GAP * Math.max(previous.height, segment.height));
    if (newBlock) lines.push("");
    lines.push(segment.text);
    previous = segment;
  }
  return lines.join("\n");
}

module.exports = { pageToText };
