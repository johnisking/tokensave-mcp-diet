# tokensave-mcp-diet

A small MCP proxy that keeps huge browser page snapshots out of your AI's context. Part of [TokenSave](https://tokensave.app), which measures where AI tokens go.

Put it in front of **Playwright MCP** or **Chrome DevTools MCP**. Every tool passes through unchanged. When a tool returns a large page snapshot, the proxy sends back a shorter version instead and keeps the full snapshot in memory, so the model can still read any part of it.

## Why

We measured both servers with Claude Code (Opus 5.5) on 2026-10-22, 68 runs in total:

| | Playwright MCP 0.0.83 | Chrome DevTools MCP 1.11.0 |
|---|---:|---:|
| One full snapshot of a long Wikipedia article | 504,168 characters, about 205,600 Claude tokens | 427,400 characters, about 208,900 Claude tokens |
| Same snapshot through tokensave-mcp-diet (outline) | 19,309 characters, about 9,200 Claude tokens (−96%) | 17,896 characters, about 8,500 Claude tokens (−96%) |
| Hacker News front page snapshot, tokens added to the request | 18,407 → 6,792 (−63%) | 14,115 → 8,066 (−43%) |
| Whole task "list the top 5 stories", API cost (average of 5 runs) | $0.298 → $0.205 (−31%) | $0.271 → $0.224 (−18%) |

Full method, raw logs and limitations: https://tokensave.app/data/browser-mcp-token-cost

Claude Code already refuses tool results that are too large and saves them to a file, so in Claude Code the win is on medium pages like the one above. On pages Claude Code already refuses, the outline costs a little more than its refusal note (+3% to +44% per task in our runs). In clients that pass large results straight into the context, one long page can cost more than 200,000 tokens.

## What it does

1. **Compact** (snapshot fits the budget): the same tree with the noise removed: link targets, `[cursor=pointer]`, separators, empty layout wrappers and deep indentation. Every `ref` / `uid` stays, so clicks and typing work as before.
2. **Outline** (still too big): headings, form fields, buttons and links only, long text cut, long runs of links collapsed.
3. **`snapshot_detail` tool**: reads any part of the last full snapshot by `ref` / `uid`, or by a text `query`, instead of taking another full snapshot.

Results that are not page snapshots, screenshots and anything under `--max-chars` are passed through untouched.

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

For Chrome DevTools MCP, replace the part after `--` with `npx -y chrome-devtools-mcp@latest`. On Windows, use `"command": "cmd"` and put `"/c"` in front of the arguments.

The same setup should work in other MCP clients that start servers with a command (Claude Desktop, Cursor, Codex); we have only measured it in Claude Code.

## Options

| Option | Default | Meaning |
|---|---:|---|
| `--max-chars` | 8000 | Snapshots shorter than this are passed through unchanged |
| `--budget` | 20000 | Largest compact snapshot to send; above this the outline is sent |
| `--keep-links` | 12 | In the outline, how many links of a long run to keep |

Example: `npx -y github:johnisking/tokensave-mcp-diet --budget 12000 -- npx -y @playwright/mcp@latest`

## Limits

- Tested with Playwright MCP 0.0.83 and Chrome DevTools MCP 1.11.0 on Windows with Claude Code 2.1.295. Snapshot formats change between versions.
- The outline drops plain text. The model has to call `snapshot_detail` to read it, which adds a step.
- Only text results that look like page snapshots are changed. Everything else is untouched.
- The proxy keeps the last snapshot in memory only. Nothing is written to disk or sent anywhere.

## License

MIT. Made by [TokenSave](https://tokensave.app), which measures where AI tokens go.
