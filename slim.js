// Snapshot shortening for Playwright MCP (YAML with [ref=eN]) and Chrome DevTools MCP (uid=N_M lines).

const REF = /\[ref=(e\d+)\]|\buid=([\d_]+)/;
const INTERACTIVE = /\b(heading|button|textbox|searchbox|combobox|checkbox|radio|switch|slider|spinbutton|tab|menuitem|option|link)\b/;

export function isSnapshot(text) {
  const head = text.slice(0, 20000);
  return (head.match(/\[ref=e\d+\]/g) || []).length > 20 || (head.match(/\buid=\d+_\d+/g) || []).length > 20;
}

const indentOf = (l) => l.match(/^\s*/)[0].length;

function clean(line, maxText) {
  let l = line
    .replace(/ \[cursor=pointer\]/g, "")
    .replace(/ url="[^"]*"/g, "")
    .replace(/ description="[^"]*"/g, "")
    .replace(/ keyshortcuts="[^"]*"/g, "");
  if (maxText) l = l.replace(new RegExp(`"([^"]{${maxText}})[^"]*"`, "g"), '"$1…"');
  return l;
}

// Outline: keep headings and interactive elements; collapse long runs of links (navigation, references).
export function outline(text, { keepLinks = 12 } = {}) {
  const lines = text.split("\n");
  const out = [];
  // keep the page header lines (URL, title) that come before the tree
  for (const l of lines.slice(0, 8)) if (/Page URL|Page Title|^#/.test(l)) out.push(l.trim());
  let run = [];
  const flush = () => {
    if (run.length > keepLinks) {
      out.push(...run.slice(0, keepLinks));
      out.push(`  … ${run.length - keepLinks} more links here (use snapshot_detail with a query to find one)`);
    } else out.push(...run);
    run = [];
  };
  for (const l of lines) {
    if (!REF.test(l) || !INTERACTIVE.test(l)) continue;
    if (/- \/url:/.test(l)) continue;
    const isLink = /\blink\b/.test(l) && !/\bheading\b/.test(l);
    const c = clean(l, isLink ? 40 : 80).trim();
    if (isLink) {
      if (/link( \[ref=e\d+\])?:?$|link\s*$/.test(c)) continue; // links with no text
      run.push(c);
    } else {
      flush();
      out.push(c);
    }
  }
  flush();
  return out.join("\n");
}

function subtree(lines, i) {
  const base = indentOf(lines[i]);
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length && indentOf(lines[j]) > base; j++) out.push(lines[j]);
  return out;
}

export function detail(text, { ref, query } = {}, maxChars = 4000) {
  const lines = text.split("\n");
  let picked = [];
  if (ref) {
    const r = String(ref).trim();
    const i = lines.findIndex((l) => l.includes(`[ref=${r}]`) || new RegExp(`\\buid=${r.replace(/[^\w]/g, "")}\\b`).test(l));
    if (i < 0) return `No element with ref ${r} in the last snapshot.`;
    picked = subtree(lines, i);
    if (/\bheading\b/.test(lines[i])) {
      // a heading: return its section, up to the next heading of the same or a higher level
      const lv = Number((lines[i].match(/\[level=(\d)\]|level="(\d)"/) || []).slice(1).find(Boolean) || 6);
      picked = [lines[i]];
      for (let j = i + 1; j < lines.length; j++) {
        const m = /\bheading\b/.test(lines[j]) && (lines[j].match(/\[level=(\d)\]|level="(\d)"/) || []).slice(1).find(Boolean);
        if (m && Number(m) <= lv) break;
        picked.push(lines[j]);
      }
    }
  } else if (query) {
    const norm = (x) => x.replace(/\u00a0/g, " ").toLowerCase();
    const q = norm(String(query));
    const hits = [];
    lines.forEach((l, i) => { if (norm(l).includes(q)) hits.push(i); });
    if (!hits.length) {
      // text split across lines (Chrome DevTools puts text runs on separate lines): match on the visible text of 3 lines
      const vis = (l) => norm((l.match(/"([^"]*)"/) || [, ""])[1]);
      for (let i = 0; i < lines.length; i++) if ([0, 1, 2].map((k) => vis(lines[i + k] || "")).join(" ").replace(/\s+/g, " ").includes(q)) hits.push(i);
    }
    if (!hits.length) return `"${query}" was not found in the last snapshot.`;
    const parent = (i) => { for (let k = i - 1; k >= 0; k--) if (indentOf(lines[k]) < indentOf(lines[i])) return k; return 0; };
    const shown = new Set();
    for (const i of hits.slice(0, 5)) {
      // two levels up (e.g. the table row around a cell); if that block is large, show nearby lines instead
      const p = parent(parent(i));
      const block = subtree(lines, p);
      const useBlock = block.length <= 40 && p + block.length > i; // block must contain the match
      const key = useBlock ? p : i;
      if (shown.has(key)) continue;
      shown.add(key);
      picked.push(...(useBlock ? block : lines.slice(Math.max(0, i - 3), i + 9)), "---");
    }
  } else return "Pass ref or query.";
  let s = picked.filter((l) => !/- \/url:/.test(l)).map((l) => clean(l, 0)).join("\n");
  if (s.length > maxChars) s = s.slice(0, maxChars) + `\n… (cut at ${maxChars} characters; ask for a narrower ref or query)`;
  return s;
}

// Compact: same tree with the noise removed (link targets, cursor marks, separators, empty wrappers, deep indents).
export function compact(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    if (/^\s*- \/url:/.test(raw)) continue;
    if (/^\s*- text: "?[|·•,;:]?"?\s*$/.test(raw)) continue;
    if (/^\s*- (generic|cell|row|rowgroup|table|list|listitem|group|region|paragraph|separator|img|LayoutTable|LayoutTableRow|LayoutTableCell|none|ignored) \[ref=e\d+\]:?\s*$/.test(raw)) continue;
    if (/^\s*uid=[\d_]+ (generic|none|ignored|LayoutTable\w*|InlineTextBox)\s*$/.test(raw)) continue;
    let l = clean(raw, 120);
    l = l.replace(/^(\s+)/, (m) => " ".repeat(Math.floor(m.length / 2)));
    out.push(l);
  }
  return out.join("\n");
}

// Table of contents for very large pages: title, headings with refs, and a count of controls. Usually well under 1,000 tokens.
export function toc(text, { maxHeadings = 60, maxControls = 10 } = {}) {
  const lines = text.split("\n");
  const out = [];
  for (const l of lines.slice(0, 8)) if (/Page URL|Page Title/.test(l)) out.push(l.trim());
  const heads = [], controls = [];
  let links = 0;
  for (const l of lines) {
    if (!REF.test(l)) continue;
    if (/\bheading\b/.test(l)) {
      const lv = (l.match(/\[level=(\d)\]|level="(\d)"/) || []).slice(1).find(Boolean);
      if (!lv || Number(lv) <= 3) heads.push(clean(l, 70).trim().replace(/^- /, ""));
    } else if (/\b(textbox|searchbox|combobox|button)\b/.test(l)) controls.push(clean(l, 40).trim().replace(/^- /, ""));
    else if (/\blink\b/.test(l)) links++;
  }
  out.push(`Headings (${heads.length}${heads.length > maxHeadings ? `, first ${maxHeadings}` : ""}):`);
  out.push(...heads.slice(0, maxHeadings).map((h) => "  " + h));
  out.push(`Form fields and buttons (${controls.length}${controls.length > maxControls ? `, first ${maxControls}` : ""}):`);
  out.push(...controls.slice(0, maxControls).map((c) => "  " + c));
  out.push(`Links: ${links} (not listed)`);
  return out.join("\n");
}
