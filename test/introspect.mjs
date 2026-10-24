// Starts tokensave-mcp-diet in front of Playwright MCP and checks that it answers
// initialize and tools/list (no browser needed). Used by CI.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const upstream = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "playwright-mcp.cmd" : "playwright-mcp");
const p = spawn(process.execPath, [path.join(root, "index.js"), "--", upstream, "--headless"], {
  stdio: ["pipe", "pipe", "inherit"],
  shell: false,
});
const fail = (msg) => { console.error("FAIL:", msg); p.kill(); process.exit(1); };
const timer = setTimeout(() => fail("timed out after 60 s"), 60000);
const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
let buf = "";
p.on("exit", (code) => { if (code) fail(`proxy exited with code ${code}`); });
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.id === 1) {
      if (m.result?.serverInfo?.name !== "tokensave-mcp-diet") fail("unexpected serverInfo " + JSON.stringify(m.result?.serverInfo));
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    } else if (m.id === 2) {
      const names = (m.result?.tools ?? []).map((t) => t.name);
      for (const need of ["browser_snapshot", "snapshot_detail", "result_detail"]) {
        if (!names.includes(need)) fail(`missing tool ${need}`);
      }
      console.log(`OK: ${names.length} tools, including snapshot_detail and result_detail`);
      clearTimeout(timer);
      p.removeAllListeners("exit");
      p.kill();
      process.exit(0);
    }
  }
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci", version: "1" } } });
