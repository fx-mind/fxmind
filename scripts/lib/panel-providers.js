/**
 * Multi-provider API key management — the generic counterpart to the 3 fixed
 * BYOK keys in panel-cli.js (anthropic/openai/cursor, each tied 1:1 to a
 * specific CLI's own credential). This lets the user add any number of
 * *extra* OpenAI-compatible providers (OpenRouter, NVIDIA NIM, and anything
 * else) the same way OpenRouter itself works: one API key per provider,
 * managed through the panel's own API rather than editing files by hand.
 *
 * OpenCode already knows how to talk to these providers (its models.dev-based
 * catalog lists "openrouter/..." and "nvidia/..." models out of the box) —
 * what's missing is a place to store the user's own key for each. The
 * simplest, most portable way to hand a key to whichever CLI ends up needing
 * it is the env var convention those providers' own SDKs/tools already read
 * (OPENROUTER_API_KEY, NVIDIA_API_KEY, ...) — see providersEnv(), merged into
 * every CLI spawn's env by panel-cli.js:buildEnv() (best effort: a CLI that
 * doesn't read a given var simply ignores it).
 */

const { readPanelConfig, writePanelConfig, keyPrefix } = require("./panel-api");

/**
 * Seed catalog — providers OpenCode's own catalog already knows how to reach,
 * so adding one here only requires the user's key, not a hand-typed base URL.
 * Not exhaustive: putProvider() accepts any id/envKey/baseURL, so the user
 * can register a fully custom OpenAI-compatible provider the same way.
 */
const KNOWN_PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseURL: "https://openrouter.ai/api/v1",
    docs: "https://openrouter.ai/keys",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    envKey: "NVIDIA_API_KEY",
    baseURL: "https://integrate.api.nvidia.com/v1",
    docs: "https://build.nvidia.com",
  },
];

function knownProvider(id) {
  return KNOWN_PROVIDERS.find((p) => p.id === id) || null;
}

function readProviders() {
  const config = readPanelConfig();
  const raw = config.byok?.providers;
  return raw && typeof raw === "object" ? raw : {};
}

/**
 * Merges the seed catalog with whatever the user configured — including
 * fully custom providers not in KNOWN_PROVIDERS at all — into one list for
 * the Settings UI. Never returns the raw apiKey, only whether it's set and
 * its prefix (same masking convention as the fixed anthropic/openai/cursor
 * keys in panel-cli.js:getAgentSettings).
 */
function listProviders() {
  const configured = readProviders();
  const ids = new Set([...KNOWN_PROVIDERS.map((p) => p.id), ...Object.keys(configured)]);
  return [...ids].map((id) => {
    const known = knownProvider(id);
    const entry = configured[id] || {};
    return {
      id,
      name: entry.name || known?.name || id,
      envKey: entry.envKey || known?.envKey || "",
      baseURL: entry.baseURL || known?.baseURL || "",
      docs: known?.docs || null,
      known: Boolean(known),
      configured: Boolean(entry.apiKey),
      keyPrefix: entry.apiKey ? keyPrefix(entry.apiKey) : "",
    };
  });
}

/**
 * Upserts one provider. For a known id, name/envKey/baseURL default from the
 * catalog and only need overriding if the user wants something different;
 * for a fully custom id, name and envKey are required (there's no catalog
 * entry to fall back on). apiKey is optional on every call — omit it to only
 * change metadata (name/baseURL) without touching an already-saved key, the
 * same pattern as the fixed BYOK keys never round-tripping their own value.
 */
function putProvider(id, body = {}) {
  const providerId = String(id || "").trim();
  if (!providerId) return { ok: false, status: 400, error: "provider id required" };

  const known = knownProvider(providerId);
  const config = readPanelConfig();
  config.byok = config.byok && typeof config.byok === "object" ? config.byok : {};
  const providers = { ...(config.byok.providers && typeof config.byok.providers === "object" ? config.byok.providers : {}) };
  const prev = providers[providerId] || {};

  const name = body.name !== undefined ? String(body.name || "").trim() : prev.name || known?.name;
  const envKey =
    body.envKey !== undefined ? String(body.envKey || "").trim() : prev.envKey || known?.envKey;
  if (!known && !name) return { ok: false, status: 400, error: "name required for a custom provider" };
  if (!known && !envKey) return { ok: false, status: 400, error: "envKey required for a custom provider" };

  const next = { ...prev };
  if (name) next.name = name;
  if (envKey) next.envKey = envKey;
  next.baseURL = body.baseURL !== undefined ? String(body.baseURL || "").trim() : prev.baseURL || "";
  if (!next.baseURL) delete next.baseURL;
  if (body.apiKey !== undefined && String(body.apiKey).trim()) {
    next.apiKey = String(body.apiKey).trim();
  }
  if (body.clearApiKey) delete next.apiKey;

  providers[providerId] = next;
  config.byok.providers = providers;
  writePanelConfig(config);
  return { ok: true, providers: listProviders() };
}

/**
 * Removes a provider entirely. For a known catalog id this just clears the
 * user's key/overrides (it reappears in listProviders() as "not configured",
 * same as it was before ever being added); for a custom id it drops the
 * entry completely since there's no catalog fallback to revert to.
 */
function deleteProvider(id) {
  const providerId = String(id || "").trim();
  if (!providerId) return { ok: false, status: 400, error: "provider id required" };
  const config = readPanelConfig();
  const providers = { ...(config.byok?.providers || {}) };
  if (!Object.prototype.hasOwnProperty.call(providers, providerId)) {
    return { ok: true, providers: listProviders() };
  }
  delete providers[providerId];
  config.byok = { ...(config.byok || {}), providers };
  writePanelConfig(config);
  return { ok: true, providers: listProviders() };
}

/**
 * Env vars for every configured provider, merged into panel-cli.js:buildEnv()
 * ahead of any CLI spawn. Best effort on the base URL: {ENV_KEY%_API_KEY}_BASE_URL
 * isn't a universal convention the way *_API_KEY is, but it's harmless to set
 * for a CLI that doesn't read it, and it's exactly the pattern already used
 * for the OpenAI key's own baseURL override.
 */
function providersEnv() {
  const configured = readProviders();
  const env = {};
  for (const [id, entry] of Object.entries(configured)) {
    if (!entry?.apiKey || !entry?.envKey) continue;
    env[entry.envKey] = entry.apiKey;
    const baseURL = entry.baseURL || knownProvider(id)?.baseURL;
    if (baseURL && /_API_KEY$/.test(entry.envKey)) {
      env[entry.envKey.replace(/_API_KEY$/, "_BASE_URL")] = baseURL;
    }
  }
  return env;
}

module.exports = {
  KNOWN_PROVIDERS,
  listProviders,
  putProvider,
  deleteProvider,
  providersEnv,
};
