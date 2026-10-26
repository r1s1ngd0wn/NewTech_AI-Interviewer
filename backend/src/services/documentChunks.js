// Splits an uploaded CV or job description into search chunks that follow its sections.
//
// One large chunk that mixes contact details, a profile, work history and skills matches no
// question strongly, so broad questions ("what is my CV about", "where did I intern") scored just
// under the match threshold. Here every heading starts a new chunk, a long section is split on
// word boundaries (the heading is repeated so each part still says what it is about), and very
// short neighbouring sections are kept together instead of becoming one-line chunks.

const { chunkText } = require("./ragService");

const TARGET_CHARS = 1200;
const MIN_CHARS = 120;
const OVERLAP_CHARS = 100;

// "EXPERIENCE", "TECHNICAL SKILLS", "Education & Training" written in capitals, or a markdown heading.
function headingOf(line) {
  const text = line.trim();
  if (/^#{1,6}\s+\S/.test(text)) return text.replace(/^#{1,6}\s+/, "");
  if (text.length < 3 || text.length > 60 || /[a-z]/.test(text) || /[.:;,]$/.test(text)) return null;
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && /^[\p{Lu}\p{N}\s&/\-]+$/u.test(text) ? text : null;
}

function sections(text) {
  const result = [];
  let current = { heading: "", lines: [] };
  for (const line of String(text).split(/\r?\n/)) {
    const heading = headingOf(line);
    if (heading) {
      // Consecutive heading lines are one wrapped heading ("BACHELOR OF SOFTWARE" / "ENGINEERING").
      if (current.heading && !current.lines.join("").trim() && current.wrappable) current.heading = `${current.heading} ${heading}`;
      else {
        if (current.lines.join("").trim() || current.heading) result.push(current);
        current = { heading, lines: [], wrappable: true };
      }
    } else { current.lines.push(line); if (line.trim()) current.wrappable = false; }
  }
  if (current.lines.join("").trim() || current.heading) result.push(current);
  // Blank lines separate paragraphs (one project, one job); they are kept so a long section can be cut between them.
  return result.map((section) => {
    const raw = section.lines.join("\n").split(/\n\s*\n/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
    // A short paragraph without a full stop is a title ("FoodOrderingSystem ReactJS, Java ..."); it stays with the text below it.
    const paragraphs = [];
    for (let i = 0; i < raw.length; i++) {
      let paragraph = raw[i];
      while (i + 1 < raw.length && paragraph.length < 160 && !/[.!?:]$/.test(paragraph)) paragraph = `${paragraph} ${raw[++i]}`;
      paragraphs.push(paragraph);
    }
    return { heading: section.heading, paragraphs, body: paragraphs.join(" ") };
  }).filter((section) => section.body || section.heading);
}

function sectionChunks(text) {
  const parts = sections(text);
  // No headings at all (plain prose, or a file with no line breaks): fall back to size-based chunks.
  if (parts.length <= 1 && !parts[0]?.heading) return chunkText(String(text), TARGET_CHARS, OVERLAP_CHARS);
  const chunks = [];
  let pending = null;
  const flush = () => { if (pending) { chunks.push(pending); pending = null; } };
  for (const { heading, body, paragraphs } of parts) {
    const label = heading ? `${heading}: ` : "";
    const whole = `${label}${body}`.trim();
    if (whole.length <= TARGET_CHARS) {
      if (pending && pending.length < MIN_CHARS && pending.length + whole.length + 1 <= TARGET_CHARS) pending = `${pending} ${whole}`;
      else if (whole.length < MIN_CHARS) { flush(); pending = whole; }
      else { flush(); chunks.push(whole); }
      continue;
    }
    flush();
    // Pack whole paragraphs first so a project or job is not cut in half; only a paragraph that is
    // longer than a chunk on its own is split on word boundaries.
    const room = TARGET_CHARS - label.length;
    let group = "";
    const emit = () => { if (group) { chunks.push(`${label}${group}`); group = ""; } };
    for (const paragraph of paragraphs) {
      if (paragraph.length > room) { emit(); for (const piece of chunkText(paragraph, room, OVERLAP_CHARS)) chunks.push(`${label}${piece}`); continue; }
      if (group && group.length + paragraph.length + 1 > room) emit();
      group = group ? `${group} ${paragraph}` : paragraph;
    }
    emit();
  }
  flush();
  return chunks;
}

module.exports = { sectionChunks, TARGET_CHARS };
