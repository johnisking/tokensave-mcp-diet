#!/usr/bin/env node
// tokensave-mcp-diet: an MCP proxy that keeps browser page snapshots out of your context.
// It wraps an MCP server and passes every tool through, but keeps oversized results out of the context:
// - browser page snapshots (Playwright MCP, Chrome DevTools MCP) become a compact tree, an outline or a table of contents;
// - any other long text result (script output, logs, dumps) keeps its head and tail plus a summary of the hidden lines;
// - image tools that take a max_size (Blender MCP) are asked for smaller images by default.
// Full results stay in memory; the model reads any part with `snapshot_detail` or `result_detail`.
//
// Usage: tokensave-mcp-diet [--max-chars 8000] [--budget 20000] [--toc-over 60000] [--keep-links 12]
//          [--max-text 8000] [--image-size 512] [--max-previews 3] [--drop-user-prompt] -- <upstream command> [args...]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { outline, compact, toc, detail, isSnapshot } from "./slim.js";
import { shorten, part } from "./text.js";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) {
  console.error("usage: tokensave-mcp-diet [--max-chars N] [--keep-links N] -- <upstream command> [args...]");
  process.exit(2);
}
const opts = { maxChars: 8000, budget: 20000, tocOver: 60000, keepLinks: 12, maxText: 8000, imageSize: 512, maxPreviews: 3, dropUserPrompt: false };
for (let i = 0; i < sep; i++) {
  if (argv[i] === "--max-chars") opts.maxChars = Number(argv[++i]);
  else if (argv[i] === "--keep-links") opts.keepLinks = Number(argv[++i]);
  else if (argv[i] === "--budget") opts.budget = Number(argv[++i]);
  else if (argv[i] === "--toc-over") opts.tocOver = Number(argv[++i]);
  else if (argv[i] === "--max-text") opts.maxText = Number(argv[++i]);
  else if (argv[i] === "--image-size") opts.imageSize = Number(argv[++i]);
  else if (argv[i] === "--max-previews") opts.maxPreviews = Number(argv[++i]);
  else if (argv[i] === "--drop-user-prompt") opts.dropUserPrompt = true;
}
const [cmd, ...cmdArgs] = argv.slice(sep + 1);

const upstream = new Client({ name: "tokensave-mcp-diet", version: "0.3.0" });
await upstream.connect(new StdioClientTransport({ command: cmd, args: cmdArgs, stderr: "inherit" }));

let lastSnapshot = null; // full text of the most recent large snapshot

const DETAIL_TOOL = {
  name: "snapshot_detail",
  description:
    "Read part of the last page snapshot that tokensave-mcp-diet shortened. Pass `ref` (an element ref or uid from the outline, e.g. e123 or 1_45) " +
    "to get that element and everything inside it, or `query` to find text on the page with its surrounding section. Use this instead of taking a new full snapshot.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref or uid shown in the outline" },
      query: { type: "string", description: "Text to find on the page (case-insensitive)" },
      max_chars: { type: "number", description: "Maximum characters to return (default 4000)" },
    },
  },
};

const RESULT_TOOL = {
  name: "result_detail",
  description:
    "Read part of a long tool result that tokensave-mcp-diet shortened (script output, logs, dumps). Pass `id` from the note (e.g. r1), " +
    "and `lines` (e.g. \"200-260\") or `query` (text to find). Prefer this over running the command again.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Result id from the note, e.g. r1" },
      lines: { type: "string", description: "Line range like 200-260" },
      query: { type: "string", description: "Text to find (case-insensitive); returns matching lines with their numbers" },
      max_chars: { type: "number", description: "Maximum characters to return (default 4000)" },
    },
    required: ["id"],
  },
};
const results = new Map(); // id -> full text of shortened results
const schemas = new Map(); // tool name -> input properties
const HIDDEN = new Set(["disable_telemetry", "record_trajectory_feedback"]);

const server = new Server({ name: "tokensave-mcp-diet", version: "0.3.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await upstream.listTools();
  for (const t of tools) schemas.set(t.name, t.inputSchema?.properties || {});
  let out = tools;
  if (opts.dropUserPrompt) {
    out = tools.filter((t) => !HIDDEN.has(t.name)).map((t) => {
      const props = { ...(t.inputSchema?.properties || {}) };
      if (!("user_prompt" in props)) return t;
      delete props.user_prompt;
      const required = (t.inputSchema.required || []).filter((r) => r !== "user_prompt");
      const description = (t.description || "").split("\n").filter((l) => !/user_prompt/.test(l)).join("\n");
      return { ...t, description, inputSchema: { ...t.inputSchema, properties: props, required } };
    });
  }
  const extra = [RESULT_TOOL];
  if (tools.some((t) => /snapshot/i.test(t.name))) extra.unshift(DETAIL_TOOL);
  return { tools: [...out, ...extra] };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  if (name === DETAIL_TOOL.name) {
    if (!lastSnapshot) return { content: [{ type: "text", text: "No shortened snapshot yet. Take a snapshot first." }] };
    return { content: [{ type: "text", text: detail(lastSnapshot, args, args.max_chars || 4000) }] };
  }
  if (name === RESULT_TOOL.name) {
    const full = results.get(String(args.id || ""));
    if (!full) return { content: [{ type: "text", text: `No shortened result with id ${args.id}. Ids so far: ${[...results.keys()].join(", ") || "none"}.` }] };
    return { content: [{ type: "text", text: part(full, args) }] };
  }
  const props = schemas.get(name) || {};
  const a = { ...args };
  // Smaller images by default: Claude bills an image by its pixels, and images stay in every later request.
  if ("max_size" in props && opts.imageSize > 0 && !(Number(a.max_size) > 1000)) a.max_size = Math.min(Number(a.max_size) || Infinity, opts.imageSize);
  if ("previews" in props && Number(a.previews) > opts.maxPreviews) a.previews = opts.maxPreviews;
  const res = await upstream.callTool({ name, arguments: a });
  if (Array.isArray(res.content)) {
    res.content = res.content.map((c) => {
      if (c.type !== "text") return c;
      if (!isSnapshot(c.text)) {
        if (!(opts.maxText > 0) || c.text.length <= opts.maxText) return c;
        const id = `r${results.size + 1}`;
        results.set(id, c.text);
        const n = c.text.length.toLocaleString("en-US");
        return { type: "text", text: `[tokensave-mcp-diet] This result was ${n} characters, so the middle is hidden (id ${id}). ` +
          `Call result_detail with id "${id}" and a line range or a query to read any part.\n\n` + shorten(c.text) };
      }
      if (c.text.length <= opts.maxChars) return c;
      lastSnapshot = c.text;
      // 1) compact: the full tree without noise; 2) over budget: an outline; 3) very large pages: a table of contents only
      const n = (x) => x.toLocaleString("en-US");
      let o, note;
      if (c.text.length > opts.tocOver) {
        o = toc(c.text);
        note = `[tokensave-mcp-diet] This page snapshot is very large (${n(c.text.length)} characters), so only a table of contents is shown. ` +
          `The full snapshot is kept: call snapshot_detail with a ref from the list below or with a text query to read the part you need.\n\n`;
      } else {
        const small = compact(c.text);
        if (small.length <= opts.budget) {
          o = small;
          note = `[tokensave-mcp-diet] Page snapshot compacted from ${n(c.text.length)} to ${n(o.length)} characters (link targets and layout noise removed; refs unchanged). ` +
            `Use snapshot_detail with a ref or query for the full text of any part.\n\n`;
        } else {
          o = outline(c.text, opts);
          note = `[tokensave-mcp-diet] The page snapshot was ${n(c.text.length)} characters, so only an outline is shown (${n(o.length)} characters): ` +
            `headings, form fields, buttons and links, with long text cut. Refs work as usual. To read a part of the page, call snapshot_detail with a ref or a text query.\n\n`;
        }
      }
      return { type: "text", text: note + o };
    });
  }
  return res;
});

await server.connect(new StdioServerTransport());
