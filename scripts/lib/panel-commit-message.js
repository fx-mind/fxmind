/**
 * Commit subject from a finished panel run: prompt for the configured CLI,
 * parse its one-line reply, and a last-resort heuristic if the agent fails.
 */

const GENERIC_DIRS = new Set(["nui", "src", "css", "js", "ui", "client", "server", "web", "dist"]);
const MAX_TITLE = 72;

function clip(text, max) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function fallbackCommitTitle({ title, files } = {}) {
  const rels = (files || [])
    .map((file) => String(file.path || "").replace(/\\/g, "/"))
    .filter(Boolean);
  if (rels.length === 1) {
    const base = rels[0].split("/").pop() || rels[0];
    return `Atualiza ${base}`;
  }
  if (rels.length > 1) {
    const segs = rels.map((path) => path.split("/").filter(Boolean));
    for (let depth = 2; depth <= 5; depth += 1) {
      const keys = segs.map((parts) => (parts.length >= depth ? parts[parts.length - depth] : ""));
      const folder = keys[0];
      if (folder && !GENERIC_DIRS.has(folder.toLowerCase()) && keys.every((key) => key === folder)) {
        return `Atualiza ${folder}`;
      }
    }
    return `Atualiza ${rels.length} arquivos`;
  }
  const rawTitle = String(title || "").trim().replace(/\s+/g, " ");
  if (!rawTitle) return "Atualiza demanda";
  return rawTitle.length <= 40 ? rawTitle : `${rawTitle.slice(0, 37).trim()}…`;
}

function buildCommitTitlePrompt({ title, userPrompt, assistant, files } = {}) {
  const blocks = (files || []).slice(0, 8).map((file) => {
    const path = String(file.path || "").replace(/\\/g, "/");
    const head = `${file.status || "modified"} ${path} (+${file.additions || 0} −${file.deletions || 0})`;
    const patch = String(file.patch || "").trim();
    if (!patch) return head;
    const clipped = patch.length > 1400 ? `${patch.slice(0, 1400).trim()}\n…` : patch;
    return `${head}\n${clipped}`;
  });

  return [
    "Write the git commit subject for the work below.",
    "Reply with ONE line only — that line is the entire response.",
    "Rules:",
    "- Maximum 72 characters",
    "- Direct: say what changed in the product/code, not the folder or file name",
    "- Same language as the user request",
    "- No quotes, no conventional-commit prefix (feat:/fix:), no trailing period",
    "- Do not use tools. Do not read files. The diff is already in this prompt.",
    "",
    `Task title: ${clip(title, 160) || "(none)"}`,
    "",
    "## User request",
    clip(userPrompt, 1400) || "(none)",
    "",
    "## Agent summary",
    clip(assistant, 1800) || "(none)",
    "",
    "## Diff",
    blocks.join("\n\n") || "(no files)",
  ].join("\n");
}

function looksLikeNoise(line) {
  const value = String(line || "").trim();
  if (!value) return true;
  if (/^[{[]/.test(value)) return true;
  if (/^(tool|mcp|fxmind_|<\/?[a-z])/i.test(value)) return true;
  if (/sessionID|timestamp|\"type\":/i.test(value)) return true;
  return false;
}

function parseCommitTitle(raw) {
  let text = String(raw || "").trim();
  if (!text) return "";
  text = text.replace(/^```[a-zA-Z0-9_-]*\s*/u, "").replace(/\s*```$/u, "").trim();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !looksLikeNoise(line));
  const line = lines[0] || "";
  if (!line) return "";
  let title = line.replace(/^["'`]+|["'`]+$/g, "");
  title = title.replace(/^(commit\s*(title|message)?|t[íi]tulo(\s+do\s+commit)?)\s*[:\-–]\s*/i, "");
  title = title.replace(/^(feat|fix|chore|refactor|docs|style|test|perf|build|ci)(\([^)]+\))?:\s*/i, "");
  title = title.replace(/\s+/g, " ").trim().replace(/[.。]+$/u, "");
  if (!title) return "";
  if (title.length <= MAX_TITLE) return title;
  const sliced = title.slice(0, MAX_TITLE);
  const cut = sliced.replace(/\s+\S*$/u, "").trim();
  return cut || sliced.trim();
}

module.exports = {
  MAX_TITLE,
  clip,
  fallbackCommitTitle,
  buildCommitTitlePrompt,
  parseCommitTitle,
};
