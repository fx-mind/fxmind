const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const trello = require("./panel-trello");

describe("panel-trello", () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxtrello-"));
    originalHome = process.env.USERPROFILE || process.env.HOME;
    if (process.platform === "win32") {
      process.env.USERPROFILE = tmpHome;
    } else {
      process.env.HOME = tmpHome;
    }
  });

  afterEach(() => {
    if (process.platform === "win32") {
      process.env.USERPROFILE = originalHome;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("getTrelloSettings never returns raw secrets", () => {
    const configPath = path.join(tmpHome, ".fxmind", "panel.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        trello: {
          apiKey: "my-secret-api-key-12345",
          token: "my-secret-token-67890",
          boardId: "board123",
        },
      }),
      "utf8",
    );

    const settings = trello.getTrelloSettings();
    assert.equal(settings.hasKey, true);
    assert.equal(settings.hasToken, true);
    assert.equal(settings.boardId, "board123");
    assert.ok(!JSON.stringify(settings).includes("my-secret-api-key"));
    assert.ok(!JSON.stringify(settings).includes("my-secret-token"));
  });

  it("fetchTrelloInbox returns not configured without credentials", async () => {
    const inbox = await trello.fetchTrelloInbox();
    assert.equal(inbox.configured, false);
    assert.deepEqual(inbox.items, []);
  });

  it("fetchCombinedInbox merges portspace and trello", async () => {
    const inbox = await trello.fetchCombinedInbox("all");
    assert.ok("items" in inbox);
    assert.ok(inbox.sources);
  });
});
