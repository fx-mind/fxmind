const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const panelProviders = require("./panel-providers");

describe("panel-providers", () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxproviders-"));
    if (process.platform === "win32") {
      process.env.USERPROFILE = tmpHome;
    } else {
      process.env.HOME = tmpHome;
    }
  });

  afterEach(() => {
    if (process.platform === "win32") {
      delete process.env.USERPROFILE;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("lists the seed catalog as unconfigured before any key is added", () => {
    const providers = panelProviders.listProviders();
    const openrouter = providers.find((p) => p.id === "openrouter");
    const nvidia = providers.find((p) => p.id === "nvidia");
    assert.ok(openrouter && nvidia, "seed catalog includes openrouter and nvidia");
    assert.equal(openrouter.known, true);
    assert.equal(openrouter.configured, false);
    assert.equal(openrouter.envKey, "OPENROUTER_API_KEY");
  });

  it("putProvider on a known id only needs an apiKey", () => {
    const result = panelProviders.putProvider("nvidia", { apiKey: "nv-secret-key-12345" });
    assert.equal(result.ok, true);
    const nvidia = result.providers.find((p) => p.id === "nvidia");
    assert.equal(nvidia.configured, true);
    assert.ok(!JSON.stringify(result).includes("nv-secret-key-12345"), "raw key never round-trips");
  });

  it("providersEnv exposes the configured key under its provider's env var", () => {
    panelProviders.putProvider("openrouter", { apiKey: "or-secret-999" });
    const env = panelProviders.providersEnv();
    assert.equal(env.OPENROUTER_API_KEY, "or-secret-999");
    assert.equal(env.OPENROUTER_BASE_URL, "https://openrouter.ai/api/v1");
  });

  it("rejects a custom provider with no name/envKey", () => {
    const result = panelProviders.putProvider("my-custom-thing", { apiKey: "x" });
    assert.equal(result.ok, false);
  });

  it("accepts a fully custom provider given name + envKey", () => {
    const result = panelProviders.putProvider("groq", {
      name: "Groq",
      envKey: "GROQ_API_KEY",
      apiKey: "gsk-test-123",
    });
    assert.equal(result.ok, true);
    const groq = result.providers.find((p) => p.id === "groq");
    assert.equal(groq.known, false);
    assert.equal(groq.configured, true);
    assert.equal(groq.envKey, "GROQ_API_KEY");
  });

  it("deleteProvider on a known id reverts it to unconfigured instead of erroring", () => {
    panelProviders.putProvider("nvidia", { apiKey: "nv-secret" });
    const result = panelProviders.deleteProvider("nvidia");
    assert.equal(result.ok, true);
    const nvidia = result.providers.find((p) => p.id === "nvidia");
    assert.equal(nvidia.known, true);
    assert.equal(nvidia.configured, false);
  });

  it("deleteProvider on a custom id drops it entirely", () => {
    panelProviders.putProvider("groq", { name: "Groq", envKey: "GROQ_API_KEY", apiKey: "x" });
    const result = panelProviders.deleteProvider("groq");
    assert.equal(result.ok, true);
    assert.ok(!result.providers.some((p) => p.id === "groq"));
  });
});
