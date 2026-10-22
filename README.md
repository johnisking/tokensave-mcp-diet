# tokensave-mcp-diet

A small MCP proxy that keeps oversized tool results out of your AI's context. Part of [TokenSave](https://tokensave.app), which measures where AI tokens go.

Put it in front of **Playwright MCP**, **Chrome DevTools MCP**, **MCP for Blender** or another MCP server. Every tool passes through unchanged. When a tool returns a large page snapshot or a long text, the proxy sends back a shorter version instead and keeps the full result in memory, so the model can still read any part of it.

## Why

We measured both servers with Claude Code (Opus 5.5) on 2026-10-22, 94 runs in total:

| | Playwright MCP 0.0.83 | Chrome DevTools MCP 1.11.0 |
|---|---:|---:|
| One full snapshot of a long Wikipedia article | 504,168 characters, about 205,600 Claude tokens | 427,400 characters, about 208,900 Claude tokens |
| Same snapshot through tokensave-mcp-diet 0.2 (table of contents) | about 1,140 Claude tokens (−99%) | about 1,120 Claude tokens (−99%) |
| Hacker News front page snapshot, tokens added to the request | 18,407 → 6,770 (−63%) | 14,115 → 8,047 (−43%) |
| Whole task "list the top 5 stories", API cost (average of 5 runs) | $0.298 → $0.208 (−30%) | $0.271 → $0.226 (−17%) |
| Whole task "find two facts in the long Wikipedia article", API cost (5 runs) | $0.181 → $0.173 (−4%) | $0.230 → $0.178 (−23%) |

Full method, raw logs and limitations: https://tokensave.app/data/browser-mcp-token-cost (dataset DOI [10.5281/zenodo.23555401](https://doi.org/10.5281/zenodo.23555401), CC BY 4.0)

Claude Code already refuses tool results that are too large and saves them to a file. Version 0.1 sent a 9,000-token outline in that case and lost money inside Claude Code (+3% to +44% per task). Version 0.2 sends a table of contents of about 1,100 tokens instead, which costs about the same as Claude Code's refusal note and lets the model open just the section it needs. In clients that pass large results straight into the context, one long page can cost more than 200,000 tokens.

### Blender (version 0.3)

MCP for Blender in Claude Code, 2026-10-22, 72 runs: everyday tasks cost $0.16 to $0.23 and a racing scene with a chase camera $0.47, with small results, so the proxy changes little there (−4% to −8%, within noise). The one expensive case is a long script output: printing every property of 580 objects cost $0.873, and $0.166 through the proxy (−81%). Data: https://tokensave.app/data/blender-mcp-token-cost

## What it does

1. **Compact** (snapshot fits the budget): the same tree with the noise removed: link targets, `[cursor=pointer]`, separators, empty layout wrappers and deep indentation. Every `ref` / `uid` stays, so clicks and typing work as before.
2. **Outline** (still too big): headings, form fields, buttons and links only, long text cut, long runs of links collapsed.
3. **Table of contents** (very large pages): page title, headings with their refs, the form fields and buttons, and a link count. Usually under 1,500 tokens.
4. **`snapshot_detail` tool**: reads any part of the last full snapshot by `ref` / `uid` (a heading ref returns its whole section), or by a text `query`, instead of taking another full snapshot.

5. **Long text results** (version 0.3, any server): text over `--max-text` characters keeps its first 2,000 and last 1,000 characters plus a summary of the hidden lines (how many, and their most common shapes). A new **`result_detail`** tool returns any part by line range or text search. Long string fields in `structuredContent` are shortened the same way, because some clients (Claude Code) show those instead of the text.
6. **Smaller images** (version 0.3): tools with a `max_size` argument (MCP for Blender's `look`) get 512-pixel images unless the model asks for more than 1,000.

Images and short results are passed through untouched.

## Install

Needs Node.js 18 or later. No npm account or API key.

**Claude Code** (`.mcp.json` or `claude mcp add`):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "github:johnisking/tokensave-mcp-diet", "--", "npx", "-y", "@playwright/mcp@latest"]
    }
  }
}
```

For Chrome DevTools MCP, replace the part after `--` with `npx -y chrome-devtools-mcp@latest`. For MCP for Blender, use `uvx mcp-for-blender`. On Windows, use `"command": "cmd"` and put `"/c"` in front of the arguments.

The same setup should work in other MCP clients that start servers with a command (Claude Desktop, Cursor, Codex); we have only measured it in Claude Code.

## Options

| Option | Default | Meaning |
|---|---:|---|
| `--max-chars` | 8000 | Snapshots shorter than this are passed through unchanged |
| `--budget` | 20000 | Largest compact snapshot to send; above this the outline is sent |
| `--toc-over` | 60000 | Snapshots longer than this get only a table of contents |
| `--keep-links` | 12 | In the outline, how many links of a long run to keep |
| `--max-text` | 8000 | Other text results longer than this keep only their head and tail (0 turns this off) |
| `--image-size` | 512 | Default `max_size` for image tools that take one (0 turns this off) |
| `--max-previews` | 3 | Upper limit for a `previews` argument (asset thumbnails) |
| `--drop-user-prompt` | off | Remove the `user_prompt` argument some servers ask for (MCP for Blender uses it for its opt-in telemetry) and hide their telemetry tools |

Example: `npx -y github:johnisking/tokensave-mcp-diet --budget 12000 -- npx -y @playwright/mcp@latest`

## Limits

- Tested with Playwright MCP 0.0.83 and Chrome DevTools MCP 1.11.0 on Windows with Claude Code 2.1.295. Snapshot formats change between versions.
- The outline drops plain text. The model has to call `snapshot_detail` to read it, which adds a step.
- Tested with MCP for Blender (add-on 1.8, Blender 5.2.2) for version 0.3.
- Shortened text keeps the head and tail only; the model has to call `result_detail` for the middle.
- The proxy keeps snapshots and long results in memory only. Nothing is written to disk or sent anywhere.

## License

MIT. Made by [TokenSave](https://tokensave.app), which measures where AI tokens go.
