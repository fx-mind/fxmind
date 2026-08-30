/**
 * Git worktree lifecycle for panel tasks.
 *
 * Every command uses an argument array. In particular, no user supplied
 * branch, task id, or commit message is interpolated into a shell command.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { projectIdForRoot } = require("../global-store");
const { parsePatch, isFxmindNoisePath, filterTaskFiles, summarizeFiles } = require("./panel-git-diff");

function taskProjectsRoot() {
  return path.resolve(
    process.env.FXMIND_PANEL_TASK_ROOT ||
      path.join(os.homedir(), ".fxmind", "projects"),
  );
}

function taskStorageRoot(projectId) {
  return path.join(taskProjectsRoot(), String(projectId), "worktrees");
}

function isManagedWorktreePath(projectRoot, worktreePath) {
  if (!projectRoot || !worktreePath) return false;
  const projectId = projectIdForRoot(projectRoot);
  const root = taskStorageRoot(projectId);
  const target = path.resolve(worktreePath);
  const relative = path.relative(root, target);
  return (
    relative &&
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.includes(path.sep)
  );
}

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safeTaskId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return null;
  return id;
}

function safeRef(value) {
  const ref = String(value || "").trim();
  if (
    !ref ||
    ref.length > 240 ||
    ref.startsWith("-") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    !/^[A-Za-z0-9._/-]+$/.test(ref)
  ) {
    return null;
  }
  return ref;
}

function sanitizeCommitMessage(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function runGit(args, cwd) {
  try {
    return {
      ok: true,
      stdout: execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    const stdout = String(error?.stdout || "").trim();
    return {
      ok: false,
      error: (stderr || stdout || String(error?.message || error)).slice(0, 1000),
    };
  }
}

function repoRoot(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  if (!fs.existsSync(root)) return { ok: false, error: "project root missing" };
  try {
    if (!fs.statSync(root).isDirectory()) {
      return { ok: false, error: "project root is not a directory" };
    }
  } catch {
    return { ok: false, error: "project root is not accessible" };
  }

  const result = runGit(["rev-parse", "--show-toplevel"], root);
  if (!result.ok) return { ok: false, error: "not a git repository" };
  const actual = path.resolve(String(result.stdout || "").trim());
  if (!actual || actual.toLowerCase() !== root.toLowerCase()) {
    return { ok: false, error: "project root is not the git repository root" };
  }
  return { ok: true, root };
}

function currentBranch(root) {
  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], root);
  if (!result.ok) return null;
  const branch = String(result.stdout || "").trim();
  return branch && branch !== "HEAD" ? branch : "HEAD";
}

function branchForTask(taskId) {
  const safe = safeTaskId(taskId);
  if (!safe) return null;
  const compact = safe.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  return `fxmind/task-${compact || crypto.createHash("sha1").update(safe).digest("hex").slice(0, 12)}`;
}

function existingWorktree(worktreePath, branch, baseBranch) {
  if (!fs.existsSync(worktreePath)) return null;
  const result = runGit(["rev-parse", "--show-toplevel"], worktreePath);
  if (!result.ok) {
    return { ok: false, error: "worktree path already exists and is not a git worktree" };
  }
  const actual = path.resolve(String(result.stdout || "").trim());
  if (actual.toLowerCase() !== path.resolve(worktreePath).toLowerCase()) {
    return { ok: false, error: "existing worktree path resolves outside the task directory" };
  }
  return {
    ok: true,
    path: path.resolve(worktreePath),
    branch,
    baseBranch,
    reused: true,
  };
}

function linkFxmind(projectRoot, worktreePath) {
  const sourcePath = path.join(projectRoot, ".fxmind");
  const target = path.join(worktreePath, ".fxmind");
  if (!fs.existsSync(sourcePath) || fs.existsSync(target)) return { mode: "existing" };
  let source = sourcePath;
  try {
    source = fs.realpathSync(sourcePath);
  } catch {
    // Keep the resolved project path for the fallback below.
  }

  try {
    if (process.platform === "win32") fs.symlinkSync(source, target, "junction");
    else fs.symlinkSync(source, target, "dir");
    return { mode: "junction" };
  } catch {
    try {
      fs.cpSync(source, target, { recursive: true, force: true });
      return { mode: "copy" };
    } catch (error) {
      return { mode: "none", error: String(error?.message || error) };
    }
  }
}

function excludeFxmind(worktreePath) {
  const gitDirResult = runGit(["rev-parse", "--git-dir"], worktreePath);
  const commonDirResult = runGit(["rev-parse", "--git-common-dir"], worktreePath);
  if (!gitDirResult.ok || !commonDirResult.ok) return "unknown";
  const gitDir = path.resolve(worktreePath, String(gitDirResult.stdout).trim());
  const commonDir = path.resolve(worktreePath, String(commonDirResult.stdout).trim());
  if (gitDir.toLowerCase() === commonDir.toLowerCase()) return "shared";
  try {
    const exclude = path.join(gitDir, "info", "exclude");
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
    if (!/(^|\r?\n)\.fxmind\/(?:\r?\n|$)/.test(current)) {
      fs.writeFileSync(exclude, `${current}${current && !current.endsWith("\n") ? "\n" : ""}.fxmind/\n`, "utf8");
    }
    return "worktree";
  } catch {
    return "unknown";
  }
}

function buildWorktreeArgs(worktreePath, branch, baseBranch, branchExists = false) {
  return branchExists
    ? ["worktree", "add", worktreePath, branch]
    : ["worktree", "add", "-b", branch, worktreePath, baseBranch];
}

function createWorktree(projectRoot, taskId, baseBranch = null) {
  const repo = repoRoot(projectRoot);
  if (!repo.ok) return repo;
  const id = safeTaskId(taskId);
  if (!id) return { ok: false, error: "invalid task id" };

  const projectId = projectIdForRoot(repo.root);
  const branch = branchForTask(id);
  const base = safeRef(baseBranch || currentBranch(repo.root) || "HEAD");
  if (!branch || !base) return { ok: false, error: "invalid git branch name" };

  const root = taskStorageRoot(projectId);
  const worktreePath = path.join(root, id);
  if (!isWithin(worktreePath, root)) return { ok: false, error: "unsafe worktree path" };

  const reused = existingWorktree(worktreePath, branch, base);
  if (reused) {
    if (!reused.ok) return reused;
    const linked = linkFxmind(repo.root, worktreePath);
    return {
      ...reused,
      projectId,
      linkMode: linked.mode,
      excludeMode: excludeFxmind(worktreePath),
      ...(linked.error ? { linkError: linked.error } : {}),
    };
  }

  fs.mkdirSync(root, { recursive: true });
  const branchExists = runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repo.root).ok;
  const args = buildWorktreeArgs(worktreePath, branch, base, branchExists);
  const added = runGit(args, repo.root);
  if (!added.ok) return { ok: false, error: added.error };

  const linked = linkFxmind(repo.root, worktreePath);
  return {
    ok: true,
    projectId,
    path: worktreePath,
    branch,
    baseBranch: base,
    linkMode: linked.mode,
    excludeMode: excludeFxmind(worktreePath),
    ...(linked.error ? { linkError: linked.error } : {}),
  };
}

function statusFiles(status) {
  const files = [];
  for (const line of String(status || "").split(/\r?\n/)) {
    if (!line) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
    if (!file) continue;
    files.push({ code, path: file });
  }
  return files;
}

function collectTaskDiff(worktreePath, baseBranch = null) {
  const root = path.resolve(String(worktreePath || ""));
  const repo = repoRoot(root);
  if (!repo.ok) return { ...repo, files: [], summary: "" };
  const base = safeRef(baseBranch || currentBranch(root) || "HEAD");
  if (!base) return { ok: false, error: "invalid base branch", files: [], summary: "" };

  const patch = runGit(["diff", "--no-ext-diff", base], root);
  const status = runGit(["status", "--porcelain", "--untracked-files=all"], root);
  if (!patch.ok || !status.ok) {
    return {
      ok: false,
      error: patch.error || status.error || "could not collect task diff",
      files: [],
      summary: "",
    };
  }

  const files = filterTaskFiles(parsePatch(patch.stdout || ""));
  const tracked = new Set(files.map((file) => file.path));
  const untracked = [];
  for (const entry of statusFiles(status.stdout)) {
    if (entry.code === "??" && !tracked.has(entry.path) && !isFxmindNoisePath(entry.path)) {
      untracked.push(entry.path);
      files.push({
        path: entry.path,
        status: "untracked",
        additions: 0,
        deletions: 0,
        patch: "",
      });
    }
  }

  const meta = summarizeFiles(files);
  return {
    ok: true,
    baseBranch: base,
    summary: meta.summary,
    files,
    stats: meta.stats,
  };
}

function commitTask(worktreePath, message) {
  const root = path.resolve(String(worktreePath || ""));
  const repo = repoRoot(root);
  if (!repo.ok) return repo;
  const commitMessage = sanitizeCommitMessage(message);
  if (!commitMessage) return { ok: false, error: "commit message is required" };

  const added = runGit(["add", "-A"], root);
  if (!added.ok) return { ok: false, error: added.error };
  runGit(
    ["reset", "-q", "HEAD", "--", ".fxmind", ".agents", ".opencode", ".claude", ".codex", "opencode.json", ".mcp.json"],
    root,
  );
  const staged = runGit(["diff", "--cached", "--name-only"], root);
  if (!staged.ok) return { ok: false, error: staged.error };
  if (!String(staged.stdout || "").trim()) {
    return { ok: false, error: "no changes to commit", code: "no_changes" };
  }

  const committed = runGit(["commit", "-m", commitMessage], root);
  if (!committed.ok) return { ok: false, error: committed.error };
  const hash = runGit(["rev-parse", "HEAD"], root);
  if (!hash.ok) return { ok: false, error: hash.error };
  return {
    ok: true,
    hash: String(hash.stdout || "").trim(),
    message: commitMessage,
    branch: currentBranch(root),
  };
}

function resolvePushRemote(root) {
  const remotes = runGit(["remote"], root);
  if (!remotes.ok) return remotes;
  const names = String(remotes.stdout || "")
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.includes("origin")) return { ok: true, name: "origin" };
  if (names.length === 1) return { ok: true, name: names[0] };
  if (!names.length) {
    return {
      ok: false,
      code: "no_remote",
      error: "Nenhum remote Git configurado para este repositório.",
    };
  }
  return {
    ok: false,
    code: "ambiguous_remote",
    error: "Configure um remote chamado origin antes de publicar as alterações.",
  };
}

function pushTask(worktreePath, branch = null) {
  const root = path.resolve(String(worktreePath || ""));
  const repo = repoRoot(root);
  if (!repo.ok) return repo;
  const target = safeRef(branch || currentBranch(root));
  if (!target || target === "HEAD") return { ok: false, error: "task branch is unavailable" };
  const remote = resolvePushRemote(root);
  if (!remote.ok) return remote;
  const pushed = runGit(["push", "-u", remote.name, target], root);
  if (!pushed.ok) return { ok: false, error: pushed.error };
  return {
    ok: true,
    branch: target,
    remote: remote.name,
    output: String(pushed.stdout || "").trim().slice(0, 1000),
  };
}

function mergeTaskToCurrent(projectRoot, branch) {
  const repo = repoRoot(projectRoot);
  if (!repo.ok) return repo;
  const target = safeRef(branch);
  if (!target || target === "HEAD") return { ok: false, error: "task branch is unavailable" };
  const status = runGit(["status", "--porcelain"], repo.root);
  if (!status.ok) return { ok: false, error: status.error };
  if (String(status.stdout || "").trim()) {
    return { ok: false, error: "current project has uncommitted changes" };
  }
  const merged = runGit(["merge", "--no-ff", target], repo.root);
  if (!merged.ok) return { ok: false, error: merged.error };
  const hash = runGit(["rev-parse", "HEAD"], repo.root);
  return {
    ok: true,
    hash: hash.ok ? String(hash.stdout || "").trim() : null,
    branch: target,
    output: String(merged.stdout || "").trim().slice(0, 1000),
  };
}

function removeWorktree(worktreePath) {
  const target = path.resolve(String(worktreePath || ""));
  const relative = path.relative(taskProjectsRoot(), target);
  const parts = relative.split(path.sep);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    parts.length < 3 ||
    parts[1] !== "worktrees" ||
    parts.some((part) => !part || part === "..")
  ) {
    return { ok: false, error: "unsafe worktree path" };
  }
  if (!fs.existsSync(target)) return { ok: true, removed: false };

  const removedByGit = runGit(["worktree", "remove", "--force", target], target);
  if (fs.existsSync(target)) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }
  return {
    ok: true,
    removed: true,
    gitRemoved: removedByGit.ok,
    ...(removedByGit.ok ? {} : { warning: removedByGit.error }),
  };
}

module.exports = {
  taskProjectsRoot,
  taskStorageRoot,
  isManagedWorktreePath,
  safeTaskId,
  safeRef,
  sanitizeCommitMessage,
  branchForTask,
  buildWorktreeArgs,
  createWorktree,
  collectTaskDiff,
  commitTask,
  resolvePushRemote,
  pushTask,
  mergeTaskToCurrent,
  removeWorktree,
};
