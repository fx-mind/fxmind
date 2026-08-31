const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const taskGit = require("./panel-task-git");

describe("panel-task-git", () => {
  it("builds worktree arguments without shell interpolation", () => {
    assert.deepEqual(
      taskGit.buildWorktreeArgs("C:\\tasks\\one", "fxmind/task-one", "main"),
      ["worktree", "add", "-b", "fxmind/task-one", "C:\\tasks\\one", "main"],
    );
    assert.deepEqual(
      taskGit.buildWorktreeArgs("C:\\tasks\\one", "fxmind/task-one", "main", true),
      ["worktree", "add", "C:\\tasks\\one", "fxmind/task-one"],
    );
  });

  it("rejects traversal ids and sanitizes commit messages", () => {
    assert.equal(taskGit.safeTaskId("../outside"), null);
    assert.equal(taskGit.safeTaskId("task-01"), "task-01");
    assert.equal(
      taskGit.sanitizeCommitMessage("  fix\nthing\u0000 now  "),
      "fix thing now",
    );
  });

  it("does not remove paths outside the managed task directory", () => {
    const result = taskGit.removeWorktree("C:\\Users\\test\\repo");
    assert.equal(result.ok, false);
    assert.match(result.error, /unsafe/i);
  });

  it("uses the only configured remote when it is not named origin", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fxtask-remote-"));
    try {
      execFileSync("git", ["init", "-q", repo], { windowsHide: true });
      execFileSync("git", ["-C", repo, "remote", "add", "ecco", "https://example.test/ecco.git"], {
        windowsHide: true,
      });
      assert.deepEqual(taskGit.resolvePushRemote(repo), { ok: true, name: "ecco" });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("resolves push target from upstream tracking branch", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fxtask-upstream-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main", repo], { windowsHide: true });
      fs.writeFileSync(path.join(repo, "README.md"), "base\n", "utf8");
      execFileSync("git", ["-C", repo, "add", "README.md"], { windowsHide: true });
      execFileSync(
        "git",
        [
          "-C",
          repo,
          "-c",
          "user.name=FxMind Test",
          "-c",
          "user.email=fxmind@example.test",
          "commit",
          "-qm",
          "base",
        ],
        { windowsHide: true },
      );
      execFileSync("git", ["-C", repo, "remote", "add", "ecco", "https://example.test/ecco.git"], {
        windowsHide: true,
      });
      execFileSync("git", ["-C", repo, "config", "branch.main.remote", "ecco"], {
        windowsHide: true,
      });
      execFileSync("git", ["-C", repo, "config", "branch.main.merge", "refs/heads/main"], {
        windowsHide: true,
      });
      assert.deepEqual(taskGit.resolvePushTarget(repo), {
        ok: true,
        localBranch: "main",
        remote: "ecco",
        branch: "main",
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("creates, diffs, commits, and removes an isolated temporary worktree", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fxtask-repo-"));
    const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fxtask-store-"));
    const previousTaskRoot = process.env.FXMIND_PANEL_TASK_ROOT;
    process.env.FXMIND_PANEL_TASK_ROOT = taskRoot;
    try {
      execFileSync("git", ["init", "-q", repo], { windowsHide: true });
      fs.writeFileSync(path.join(repo, "README.md"), "base\n", "utf8");
      execFileSync("git", ["-C", repo, "add", "README.md"], { windowsHide: true });
      execFileSync(
        "git",
        [
          "-C",
          repo,
          "-c",
          "user.name=FxMind Test",
          "-c",
          "user.email=fxmind@example.test",
          "commit",
          "-qm",
          "base",
        ],
        { windowsHide: true },
      );

      const created = taskGit.createWorktree(repo, "task-test", "HEAD");
      assert.equal(created.ok, true);
      fs.writeFileSync(path.join(created.path, "change.txt"), "change\n", "utf8");
      const diff = taskGit.collectTaskDiff(created.path, created.baseBranch);
      assert.equal(diff.ok, true);
      assert.equal(diff.stats.untracked, 1);
      const commit = taskGit.commitTask(created.path, "add change");
      assert.equal(commit.ok, true);
      assert.equal(taskGit.removeWorktree(created.path).ok, true);
      assert.equal(fs.existsSync(created.path), false);
    } finally {
      if (previousTaskRoot === undefined) delete process.env.FXMIND_PANEL_TASK_ROOT;
      else process.env.FXMIND_PANEL_TASK_ROOT = previousTaskRoot;
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(taskRoot, { recursive: true, force: true });
    }
  });
});
