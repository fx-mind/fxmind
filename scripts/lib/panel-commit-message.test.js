const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  fallbackCommitTitle,
  buildCommitTitlePrompt,
  parseCommitTitle,
} = require("./panel-commit-message");

describe("panel-commit-message", () => {
  it("parses a bare one-line title and strips prefixes", () => {
    assert.equal(parseCommitTitle("Corrige borda dos modais no CEF"), "Corrige borda dos modais no CEF");
    assert.equal(parseCommitTitle('"Corrige borda dos modais no CEF."'), "Corrige borda dos modais no CEF");
    assert.equal(parseCommitTitle("fix: Corrige borda dos modais no CEF"), "Corrige borda dos modais no CEF");
    assert.equal(parseCommitTitle("Título: Fallback de borda nos popups"), "Fallback de borda nos popups");
  });

  it("ignores json/tool noise and keeps the first real line", () => {
    assert.equal(
      parseCommitTitle('{"type":"tool"}\nCorrige fallback de borda nos modais'),
      "Corrige fallback de borda nos modais",
    );
    assert.equal(parseCommitTitle('{"type":"error","sessionID":"ses_abc"}'), "");
  });

  it("builds a prompt that forbids tools and includes the diff", () => {
    const prompt = buildCommitTitlePrompt({
      title: "modais",
      userPrompt: "os modais somem no CEF",
      assistant: "Ajustei border inset/outset no style.css",
      files: [
        {
          path: "resources/[Nation]/nation_creator/nui/style.css",
          status: "modified",
          additions: 8,
          deletions: 2,
          patch: "+ border-top-style: inset;",
        },
      ],
    });
    assert.match(prompt, /Do not use tools/);
    assert.match(prompt, /os modais somem no CEF/);
    assert.match(prompt, /border-top-style: inset/);
    assert.match(prompt, /style\.css/);
  });

  it("falls back to a short folder/file title when the agent is unavailable", () => {
    assert.equal(
      fallbackCommitTitle({
        files: [
          { path: "resources/[Nation]/nation_creator/nui/style.css" },
          { path: "resources/[Nation]/nation_creator/nui/figma.css" },
        ],
      }),
      "Atualiza nation_creator",
    );
    assert.equal(
      fallbackCommitTitle({ files: [{ path: "nui/style.css" }] }),
      "Atualiza style.css",
    );
  });
});
