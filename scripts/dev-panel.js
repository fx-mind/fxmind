#!/usr/bin/env node
/**
 * Dev: Vite (HMR) + fxmind API on separate ports.
 * Production still uses web/dist via fxmind serve.
 */

const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PANEL_ROOT = path.join(ROOT, "..", "panel");
const PREFERRED_API_PORT = Number(process.env.FXMIND_API_PORT || 3847);
const WEB_PORT = Number(process.env.FXMIND_WEB_PORT || 5173);

async function probeApi(port) {
  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health?quick=1`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok) return false;
    const data = await health.json();
    if (data.service !== "fxmind-panel") return false;
    if (!data.features?.subagents) return false;

    const queue = await fetch(`http://127.0.0.1:${port}/api/demand-queue`, {
      signal: AbortSignal.timeout(5000),
    });
    return queue.ok;
  } catch {
    return false;
  }
}

async function waitApi(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (await probeApi(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function spawnApi(port) {
  return spawn(
    process.execPath,
    [path.join(__dirname, "serve.js"), "--api-only", "--port", String(port)],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        FXMIND_DEV_CHILD: "1",
        FXMIND_TARGET: process.env.FXMIND_TARGET || process.cwd(),
      },
    },
  );
}

function spawnVite(apiPort) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["run", "dev"];
  const command = [npm, ...args].join(" ");
  const executable = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : npm;
  const spawnArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", command] : args;

  return spawn(executable, spawnArgs, {
    cwd: PANEL_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      FXMIND_API_PORT: String(apiPort),
      FXMIND_WEB_PORT: String(WEB_PORT),
    },
    windowsHide: true,
  });
}

async function resolveApiPort() {
  const reuse = process.env.FXMIND_REUSE_API === "1";
  const candidates = [PREFERRED_API_PORT, PREFERRED_API_PORT + 1, PREFERRED_API_PORT + 2];

  for (const port of candidates) {
    if (reuse && (await probeApi(port))) {
      console.log(`(reusing API on http://127.0.0.1:${port})`);
      return { port, child: null };
    }

    if (!reuse && (await probeApi(port))) {
      console.log(
        `(port ${port} busy — skipping; stop old serve or set FXMIND_REUSE_API=1 to keep it)`,
      );
      continue;
    }

    const child = spawnApi(port);
    const ready = await waitApi(port, 16);
    if (ready) {
      return { port, child };
    }
    child.kill();
  }

  throw new Error(
    `Could not start API (ports ${candidates.join(", ")}). Stop old fxmind serve processes and retry.`,
  );
}

async function main() {
  const { port: apiPort, child: api } = await resolveApiPort();
  const web = spawnVite(apiPort);

  console.log("");
  console.log(`  UI  → http://127.0.0.1:${WEB_PORT}/chat`);
  console.log(`  API → http://127.0.0.1:${apiPort}/api`);
  console.log("");

  const shutdown = () => {
    if (api) api.kill();
    web.kill();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (api) {
    api.on("exit", (code) => {
      if (code && code !== 0) web.kill();
    });
  }
  web.on("exit", (code) => {
    if (api) api.kill();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
