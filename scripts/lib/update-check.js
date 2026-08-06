/**
 * Check for fxmind package / layout updates (network + semver, fail-open).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

/** Keep in sync with LAYOUT_VERSION in install.js */
const CURRENT_LAYOUT_VERSION = 2;
const SHARED_DIR = ".fxmind";

const REMOTE_PACKAGE_URL =
  "https://raw.githubusercontent.com/fx-mind/fxmind/main/package.json";
const FETCH_TIMEOUT_MS = 3000;
const THROTTLE_MS = 24 * 60 * 60 * 1000;

function candidatePackageRoots() {
  const roots = [];
  if (process.env.FXMIND_PACKAGE_ROOT) {
    roots.push(path.resolve(process.env.FXMIND_PACKAGE_ROOT));
  }
  try {
    const npmRoot = execSync("npm root -g", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    roots.push(path.join(npmRoot, "fxmind"));
  } catch {
    // no global npm root
  }
  roots.push(path.join(__dirname, "..", ".."));
  return roots;
}

function readPackageVersion(packageRoot) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
    if (pkg.name === "fxmind" && pkg.version) {
      return pkg.version;
    }
  } catch {
    // try next root
  }
  return null;
}

function statePath() {
  return path.join(os.homedir(), ".fxmind", "update-check.json");
}

function readState() {
  try {
    const raw = fs.readFileSync(statePath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function getLocalVersion() {
  for (const root of candidatePackageRoots()) {
    const version = readPackageVersion(root);
    if (version) return version;
  }
  return "0.0.0";
}

function parseSemver(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (va[i] > vb[i]) return 1;
    if (va[i] < vb[i]) return -1;
  }
  return 0;
}

function fetchRemoteVersionSync() {
  return new Promise((resolve) => {
    const req = https.get(REMOTE_PACKAGE_URL, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const pkg = JSON.parse(body);
          resolve(pkg.version || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

function readPacksManifest(projectRoot) {
  const filePath = path.join(path.resolve(projectRoot), SHARED_DIR, "packs.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isOptOut(projectRoot) {
  if (process.env.FXMIND_NO_UPDATE_CHECK === "1") {
    return true;
  }
  const manifest = readPacksManifest(projectRoot);
  return manifest?.autoUpdateCheck === false;
}

function isLayoutStale(projectRoot) {
  const manifest = readPacksManifest(projectRoot);
  if (!manifest) return false;
  const installed = Number(manifest.layoutVersion) || 0;
  return installed < CURRENT_LAYOUT_VERSION;
}

function notifyKey(remoteVersion, layoutStale) {
  return `${remoteVersion || "unknown"}-layout${layoutStale ? CURRENT_LAYOUT_VERSION : "ok"}`;
}

function buildMessage(result) {
  const parts = [];
  if (result.remoteVersion && compareSemver(result.remoteVersion, result.localVersion) > 0) {
    parts.push(
      `nova versão ${result.remoteVersion} disponível (instalada ${result.localVersion})`,
    );
  }
  if (result.layoutStale) {
    parts.push(
      `layout do projeto desatualizado (esperado layoutVersion ${CURRENT_LAYOUT_VERSION})`,
    );
  }
  return parts.join("; ");
}

async function checkForUpdate(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const force = Boolean(options.force);
  const markNotified = Boolean(options.markNotified);

  const result = {
    ok: true,
    updateAvailable: false,
    shouldNotify: false,
    localVersion: getLocalVersion(),
    remoteVersion: null,
    layoutStale: false,
    skipped: false,
    skipReason: null,
    message: null,
    currentLayoutVersion: CURRENT_LAYOUT_VERSION,
  };

  if (isOptOut(projectRoot)) {
    result.skipped = true;
    result.skipReason = "opt-out";
    return result;
  }

  result.layoutStale = isLayoutStale(projectRoot);

  const state = readState();
  const now = Date.now();
  let remoteVersion = state.lastRemoteVersion || null;

  const shouldFetch =
    force || !state.lastCheckedAt || now - state.lastCheckedAt >= THROTTLE_MS;

  if (shouldFetch) {
    const fetched = await fetchRemoteVersionSync();
    state.lastCheckedAt = now;
    if (fetched) {
      remoteVersion = fetched;
      state.lastRemoteVersion = fetched;
    }
    writeState(state);
  } else {
    result.skipped = true;
    result.skipReason = "throttle";
  }

  result.remoteVersion = remoteVersion;

  const versionNewer =
    remoteVersion && compareSemver(remoteVersion, result.localVersion) > 0;
  result.updateAvailable = Boolean(versionNewer || result.layoutStale);

  if (result.updateAvailable) {
    result.message = buildMessage(result);
    const key = notifyKey(remoteVersion, result.layoutStale);
    result.shouldNotify = force || state.lastNotifiedVersion !== key;
    if (markNotified && result.shouldNotify) {
      state.lastNotifiedVersion = key;
      writeState(state);
    }
  }

  return result;
}

function buildAgentContext(result) {
  if (!result.shouldNotify || !result.message) {
    return null;
  }
  const remote = result.remoteVersion || "mais recente";
  const local = result.localVersion;
  return (
    `fxmind: ${result.message}. Avise o usuário no chat e use AskQuestion perguntando se deseja atualizar agora. ` +
    `Se sim, rode \`fxmind --update -y\` (ou \`npx --yes github:fx-mind/fxmind --update -y\`) na raiz do projeto; ` +
    `memories e knowledge-graph.json são preservados. Depois lembre de reiniciar o IDE/CLI. ` +
    `Não entre em Task/Learn durante o update. (Remoto: ${remote}, local: ${local}.)`
  );
}

module.exports = {
  CURRENT_LAYOUT_VERSION,
  compareSemver,
  getLocalVersion,
  checkForUpdate,
  buildAgentContext,
  isOptOut,
  isLayoutStale,
  parseSemver,
};
