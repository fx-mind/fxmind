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

function ensureGraphFresh(projectRoot, options = {}) {
  if (!isGraphStale(projectRoot)) {
    return { stale: false, rebuilt: false };
  }

  const { buildGraphData, writeGraph } = require("../build-graph");
  const updateHtml = options.updateHtml === true;
  const useCache = options.useCache !== false;
  const data = buildGraphData(projectRoot, { useCache });
  const paths = writeGraph(projectRoot, data, { updateHtml });

  return { stale: true, rebuilt: true, paths, counts: data.meta?.counts };
}

module.exports = {
  graphJsonPath,
  isGraphStale,
  ensureGraphFresh,
};
