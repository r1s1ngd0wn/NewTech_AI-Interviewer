// Builds a small synthetic two-column CV as a PDF, laid out the way design-tool exports are:
//   - two columns (narrow left, wide right) at different heights,
//   - section headings written to the file before the text under them,
//   - some words stored as two adjacent text pieces ("Co-d" + "eveloped") with no gap,
//   - the left column written last.
// A plain "join every piece with a space, in file order" extractor turns that into scrambled text
// with broken words, which is what real exports from Canva-style tools do. All content is fictional.

const WIDTHS = { " ": 278, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222,
  m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722,
  O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  ".": 278, ",": 278, ":": 278, ";": 278, "-": 333, "(": 333, ")": 333, "/": 278, "|": 260, "+": 584, "#": 556,
  "@": 1015, "&": 667, "'": 191 };
for (const digit of "0123456789") WIDTHS[digit] = 556;

const width = (text, size) => [...text].reduce((total, ch) => total + (WIDTHS[ch] ?? 556), 0) * size / 1000;
const escape = (text) => text.replace(/[\\()]/g, (ch) => `\\${ch}`);

function wrap(text, size, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next, size) > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Words cut in two on purpose, mimicking kerning splits in exported PDFs.
const SPLITS = { "Co-developed": 4, "Implemented": 4, "English": 1, "Object-Oriented": 6 };

const PROFILE = "Third-year Software Engineering student who builds backend systems and mobile apps. Skilled in C#, Java and the .NET ecosystem, with hands-on experience designing databases in PostgreSQL and Firebase.";
const EXPERIENCE = [
  ["SOFTWARE ENGINEER INTERN", "Lotus Software, Da Nang | July 2026 - September 2026"],
  ["bullet", "Built new modules for an invoicing system using C# and ASP.NET."],
  ["bullet", "Tuned SQL Server queries and cut report loading time by 30 percent."],
  ["bullet", "Reviewed pull requests with the engineering team every week."],
  ["ACADEMIC PROJECTS", "University Projects | Personal Projects"],
  ["bullet", "Co-developed an Android food discovery app in Java with Firebase and real-time location features."],
  ["bullet", "Implemented secure access rules for a small cloud project on AWS Academy."],
];
const EDUCATION = ["BACHELOR OF SOFTWARE ENGINEERING", "Example University of Technology and Engineering, Faculty of Information Technology", "2023 - Present"];
const SKILLS = ["Languages: C#, Java, Python, SQL", "Frameworks: .NET, ASP.NET MVC", "Tools: PostgreSQL, Firebase, Docker, Git"];
const LANGUAGES = ["Vietnamese: Native", "English: Professional"];
const INTERESTS = "Backend systems, database design, open source tools, hackathons with friends, mentoring first-year students, practising clear technical writing, reading about distributed systems and testing small ideas on weekends with side projects that solve real problems.";

function pieces(text, size, x, y, font = "F1") {
  // A line is written as one piece per word, except the words listed in SPLITS, which are cut in two.
  const out = [];
  let cursor = x;
  for (const word of text.split(" ")) {
    const stripped = word.replace(/[.,]$/, "");
    const cut = SPLITS[stripped];
    const parts = cut ? [word.slice(0, cut), word.slice(cut)] : [word];
    for (const [index, part] of parts.entries()) {
      // The second half uses its own font resource (as exported files do with separate font subsets; a different face here so readers do not merge them),
      // so a reader cannot merge the two halves back into one text run.
      out.push({ x: cursor, y, size, font: index === 1 ? "F3" : font, text: part });
      cursor += width(part, size);
    }
    cursor += width(" ", size);
  }
  return out;
}

function layout(rightX = 270, leftWidth = 200) {
  const items = [];
  const push = (list) => items.push(...list);
  push(pieces("TRAN MINH ANH", 20, 40, 800, "F2"));
  push(pieces("anh.tran@example.invalid | +84 900 000 000 | Da Nang", 9, 40, 782));
  // Headings first, away from their text.
  push(pieces("PROFILE", 13, 40, 750, "F2"));
  push(pieces("EXPERIENCE", 13, rightX, 640, "F2"));
  push(pieces("REFERENCES", 13, rightX, 250, "F2"));
  let y = 732;
  for (const line of wrap(PROFILE, 10, 515)) { push(pieces(line, 10, 40, y)); y -= 13; }
  // Right column.
  y = 618;
  for (const [kind, text] of EXPERIENCE) {
    if (kind === "bullet") {
      for (const [index, line] of wrap(text, 10, 265).entries()) { push(pieces(index === 0 ? `- ${line}` : `  ${line}`, 10, rightX, y)); y -= 13; }
    } else {
      y -= 6;
      push(pieces(kind, 10, rightX, y, "F2")); y -= 13;
      push(pieces(text, 9, rightX, y)); y -= 14;
    }
  }
  push(pieces("Available on request.", 10, rightX, 232));
  // Left column last, headings again before their text.
  push(pieces("EDUCATION", 13, 40, 640, "F2"));
  push(pieces("SKILLS", 13, 40, 520, "F2"));
  push(pieces("LANGUAGES", 13, 40, 400, "F2"));
  y = 622;
  for (const line of EDUCATION) { for (const part of wrap(line, 10, leftWidth)) { push(pieces(part, 10, 40, y)); y -= 13; } }
  y = 502;
  for (const line of SKILLS) { for (const part of wrap(line, 10, leftWidth)) { push(pieces(part, 10, 40, y)); y -= 13; } y -= 3; }
  y = 382;
  for (const line of LANGUAGES) { push(pieces(line, 10, 40, y)); y -= 13; }
  push(pieces("INTERESTS", 13, 40, 330, "F2"));
  y = 312;
  for (const part of wrap(INTERESTS, 10, leftWidth)) { push(pieces(part, 10, 40, y)); y -= 13; }
  return items;
}

// A second layout: section headings in a narrow strip on the left, each at the height of the first
// line of its text, which sits in a wide column on the right. The headings are written first.
function sidebarLayout() {
  const items = [];
  const push = (list) => items.push(...list);
  const sections = [
    ["SUMMARY", 740, ["Final-year student with hands-on experience in backend development using Java and Node.js.", "Looking for a software engineering internship."]],
    ["EDUCATION", 670, ["Example University of Technology, Bachelor of Software Engineering.", "2023 - Present, GPA 3.2"]],
    ["SKILLS", 610, ["Backend: Java, Spring Boot, Node.js, REST APIs.", "Database: PostgreSQL, SQL Server."]],
    ["PROJECTS", 540, ["Campus Courses, a full-stack e-learning platform built with Node.js and PostgreSQL.", "Added course search, filtering and role-based access for students and teachers."]],
    ["CERTIFICATIONS", 450, ["Cloud Foundations training badge from AWS Academy."]],
  ];
  push(pieces("NGUYEN VAN BINH", 18, 155, 800, "F2"));
  push(pieces("binh.nguyen@example.invalid | Da Nang", 9, 155, 784));
  for (const [heading, y] of sections.map(([h, top]) => [h, top])) push(pieces(heading, 10, 45, y, "F2"));
  for (const [, top, lines] of sections) {
    let y = top;
    for (const line of lines) for (const part of wrap(line, 10, 395)) { push(pieces(part, 10, 155, y)); y -= 13; }
  }
  return items;
}

function buildTwoColumnCvPdf(items = layout()) {
  const stream = items.map((item) =>
    `BT /${item.font} ${item.size} Tf 1 0 0 1 ${item.x.toFixed(2)} ${item.y} Tm (${escape(item.text)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// A plain one-column CV with a short date at the right edge of each job line. It must not be mistaken
// for two columns (that would read all the job titles first and all the dates after them).
function singleColumnLayout() {
  const items = [];
  const jobs = [
    ["Software Engineer Intern", "Jul 2026", "Built invoicing modules with Node.js and cut report loading time by thirty percent for the finance team."],
    ["Teaching Assistant", "Sep 2025", "Ran weekly lab sessions on databases and marked coursework for sixty students in the second year."],
    ["Student Developer", "Jan 2025", "Maintained the faculty website and fixed accessibility problems found in an audit by the university."],
  ];
  items.push(...pieces("TRAN MINH ANH", 18, 40, 800, "F2"));
  items.push(...pieces("EXPERIENCE", 13, 40, 765, "F2"));
  let y = 742;
  for (const [title, date, text] of jobs) {
    items.push(...pieces(title, 11, 40, y));
    items.push(...pieces(date, 10, 480, y));
    y -= 15;
    for (const line of wrap(text, 10, 300)) { items.push(...pieces(line, 10, 40, y)); y -= 13; }
    y -= 14;
  }
  return items;
}

const buildSidebarCvPdf = () => buildTwoColumnCvPdf(sidebarLayout());
// The same CV with only about ten points between the columns, as in many designed templates.
const buildSingleColumnCvPdf = () => buildTwoColumnCvPdf(singleColumnLayout());
const buildNarrowGutterCvPdf = () => buildTwoColumnCvPdf(layout(254, 205));

module.exports = { buildTwoColumnCvPdf, buildSidebarCvPdf, buildNarrowGutterCvPdf, buildSingleColumnCvPdf };

if (require.main === module) {
  const target = process.argv[2] || "sample-cv-twocolumn.pdf";
  require("node:fs").writeFileSync(target, buildTwoColumnCvPdf());
  console.log(`wrote ${target}`);
}
