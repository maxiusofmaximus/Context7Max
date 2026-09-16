import { spawn } from "node:child_process";

const env = {
  ...process.env,
  CTX7MAX_API_URL: "https://context7max.vercel.app",
  CTX7MAX_API_KEY: "ctx7mk-4ebe795a94b66b53152cb7716b1b7996",
};

const server = spawn("node", ["packages/mcp/dist/server.js"], {
  env,
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
server.stdout.on("data", (d) => {
  buffer += d.toString();
});

server.stderr.on("data", (d) => {
  console.error("[stderr]", d.toString().slice(0, 200));
});

// initialize handshake (JSON-RPC over stdio)
server.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1" },
    },
  }) + "\n",
);

await new Promise((r) => setTimeout(r, 4000));
server.kill();

const lines = buffer.split("\n").filter(Boolean);
const init = lines
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .find((m) => m?.id === 1);

if (init?.result?.serverInfo?.name === "context7max") {
  console.log(
    `✓ MCP handshake OK → ${init.result.serverInfo.name} v${init.result.serverInfo.version}`,
  );
  console.log(`  tools: ${init.result.capabilities?.tools ? "habilitadas" : "no"}`);
  process.exit(0);
} else {
  console.error("✖ handshake falló. Buffer:", buffer.slice(0, 400));
  process.exit(1);
}
