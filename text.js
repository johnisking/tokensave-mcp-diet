// Shortening of long plain-text tool results (script output, logs, property dumps).
// Keeps the head and the tail, and describes the hidden middle by its most common line shapes,
// so the model knows what was left out and can ask for any part with `result_detail`.

const shape = (line) => line.trim().replace(/-?\d+(\.\d+)?(e-?\d+)?/gi, "#").replace(/\s+/g, " ").slice(0, 80);

function numRange(lines) {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const l of lines) for (const m of l.matchAll(/-?\d+\.\d+/g)) { const v = Number(m[0]); if (v < lo) lo = v; if (v > hi) hi = v; n++; }
  return n ? ` (decimal values from ${+lo.toFixed(4)} to ${+hi.toFixed(4)})` : "";
}

export function shorten(text, { head = 2000, tail = 1000 } = {}) {
  const lines = text.split("\n");
  let h = 0, hc = 0;
  while (h < lines.length && hc + lines[h].length + 1 <= head) hc += lines[h++].length + 1;
  let t = lines.length, tc = 0;
  while (t > h && tc + lines[t - 1].length + 1 <= tail) tc += lines[--t].length + 1;
  if (h === 0 && t === lines.length) { // one huge line: cut by characters
    return text.slice(0, head) + `\n[... ${(text.length - head - tail).toLocaleString("en-US")} characters hidden ...]\n` + text.slice(-tail);
  }
  const mid = lines.slice(h, t);
  const counts = new Map();
  for (const l of mid) { const s = shape(l); counts.set(s, (counts.get(s) || 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([s, c]) => `  ${c.toLocaleString("en-US")} lines like: ${s}`).join("\n");
  const midChars = mid.reduce((a, l) => a + l.length + 1, 0);
  return lines.slice(0, h).join("\n") +
    `\n[... ${mid.length.toLocaleString("en-US")} lines (${midChars.toLocaleString("en-US")} characters) hidden, lines ${h + 1} to ${t}${numRange(mid)}. Most common:\n${top}\n...]\n` +
    lines.slice(t).join("\n");
}

// Return part of a stored result: by line range, by search, or the next chunk.
export function part(text, { lines, query, max_chars = 4000 } = {}) {
  const all = text.split("\n");
  let out;
  if (query) {
    const q = String(query).toLowerCase();
    const hits = [];
    all.forEach((l, i) => { if (l.toLowerCase().includes(q)) hits.push(`${i + 1}: ${l}`); });
    out = hits.length ? `${hits.length} matching lines:\n` + hits.join("\n") : `No line contains "${query}".`;
  } else {
    const m = String(lines || "1-80").match(/(\d+)\s*-\s*(\d+)/);
    const a = m ? Math.max(1, +m[1]) : 1, b = m ? Math.min(all.length, +m[2]) : Math.min(all.length, 80);
    out = all.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join("\n") + `\n(${all.length.toLocaleString("en-US")} lines in total)`;
  }
  return out.length > max_chars ? out.slice(0, max_chars) + `\n[... cut at ${max_chars} characters; ask for a smaller range]` : out;
}
