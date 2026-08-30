/**
 * Knowledge graph staleness — compare knowledge-graph.json mtime vs memory sources.
 */
const fs = require("fs");
const path = require("path");

const { resolveDataRoot, resolveMemoryDir } = require("../global-store");
const { resolveLocal, resolveInDataRoot } = require("./layout");

function graphJsonPath(projectRoot) {
  return resolveInDataRoot(resolveDataRoot(projectRoot), "graphJson");
}

function isGraphStale(projectRoot) {
  const resolved = path.resolve(projectRoot);
  const jsonPath = graphJsonPath(resolved);
  if (!fs.existsSync(jsonPath)) {
    return true;
  }

  const graphMtime = fs.statSync(jsonPath).mtimeMs;
  const memoryDir = resolveMemoryDir(resolved);

  if (fs.existsSync(memoryDir)) {
    for (const entry of fs.readdirSync(memoryDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "_index.md") {
        continue;
      }
      const filePath = path.join(memoryDir, entry.name);
      if (fs.statSync(filePath).mtimeMs > graphMtime) {
        return true;
      }
    }
  }

  const catalogPath = resolveLocal(resolved, "topicCatalog");
  if (fs.existsSync(catalogPath) && fs.statSync(catalogPath).mtimeMs > graphMtime) {
    return true;
  }

  return false;
}

const DEBOUNCE_MS = 10 * 60 * 1000;

function graphNoAuto() {
  const value = process.env.FXMIND_GRAPH_NO_AUTO;
  return Boolean(value && value !== "0" && String(value).toLowerCase() !== "false");
}

function shouldDebounceRebuild(projectRoot, options = {}) {
  if (options.force) return false;
  if (graphNoAuto()) return true;
  const jsonPath = graphJsonPath(projectRoot);
  if (!fs.existsSync(jsonPath)) return false;
  const graphMtime = fs.statSync(jsonPath).mtimeMs;
  return Date.now() - graphMtime < DEBOUNCE_MS;
}

function ensureGraphFresh(projectRoot, options = {}) {
  if (!isGraphStale(projectRoot)) {
    return { stale: false, rebuilt: false };
  }
  if (shouldDebounceRebuild(projectRoot, options)) {
    return { stale: true, rebuilt: false, debounced: true };
  }

  const { buildGraphData, writeGraph } = require("../build-graph");
  const updateHtml = options.updateHtml === true;
  const useCache = options.useCache !== false;
  const data = buildGraphData(projectRoot, { useCache });
  const paths = writeGraph(projectRoot, data, { updateHtml });

  return { stale: true, rebuilt: true, paths, counts: data.meta?.counts };
}

function scheduleGraphRebuildBackground(projectRoot, options = {}) {
  if (graphNoAuto()) return;
  const resolved = path.resolve(projectRoot);
  setImmediate(() => {
    try {
      if (!isGraphStale(resolved)) return;
      ensureGraphFresh(resolved, {
        updateHtml: false,
        useCache: true,
        ...options,
      });
    } catch {
      /* fail-open */
    }
  });
}

module.exports = {
  graphJsonPath,
  isGraphStale,
  ensureGraphFresh,
  shouldDebounceRebuild,
  scheduleGraphRebuildBackground,
  DEBOUNCE_MS,
};
