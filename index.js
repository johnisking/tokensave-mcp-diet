#!/usr/bin/env node
// tokensave-mcp-diet: an MCP proxy that keeps browser page snapshots out of your context.
// It wraps a browser MCP server (Playwright MCP, Chrome DevTools MCP), passes every tool through,
// and when a tool returns a very large page snapshot it sends back a short outline instead.
// The full snapshot stays in memory; the model can read any part of it with `snapshot_detail`.
//
// Usage: tokensave-mcp-diet [--max-chars 8000] [--budget 20000] [--toc-over 60000] [--keep-links 12] -- <upstream command> [args...]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { outline, compact, toc, detail, isSnapshot } from "./slim.js";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) {
  console.error("usage: tokensave-mcp-diet [--max-chars N] [--keep-links N] -- <upstream command> [args...]");
  process.exit(2);
}
const opts = { maxChars: 8000, budget: 20000, tocOver: 60000, keepLinks: 12 };
for (let i = 0; i < sep; i++) {
  if (argv[i] === "--max-chars") opts.maxChars = Number(argv[++i]);
  else if (argv[i] === "--keep-links") opts.keepLinks = Number(argv[++i]);
  else if (argv[i] === "--budget") opts.budget = Number(argv[++i]);
  else if (argv[i] === "--toc-over") opts.tocOver = Number(argv[++i]);
}
const [cmd, ...cmdArgs] = argv.slice(sep + 1);

const upstream = new Client({ name: "tokensave-mcp-diet", version: "0.2.0" });
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

const server = new Server({ name: "tokensave-mcp-diet", version: "0.2.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await upstream.listTools();
  return { tools: [...tools, DETAIL_TOOL] };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  if (name === DETAIL_TOOL.name) {
    if (!lastSnapshot) return { content: [{ type: "text", text: "No shortened snapshot yet. Take a snapshot first." }] };
    return { content: [{ type: "text", text: detail(lastSnapshot, args, args.max_chars || 4000) }] };
  }
  const res = await upstream.callTool({ name, arguments: args });
  if (Array.isArray(res.content)) {
    res.content = res.content.map((c) => {
      if (c.type !== "text" || c.text.length <= opts.maxChars || !isSnapshot(c.text)) return c;
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
