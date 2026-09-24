const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tools = require("../fxmind-tools");
const retrieval = require("./memory-retrieval");

/** Realistic FiveM memory set: every memory shares generic words (player, server, vrp). */
const MEMORIES = {
  inventory: {
    triggers: "inventory, item drop, player items",
    paths: "resources/vrp_inventory/server.lua",
    symbols: "dropItem, giveInventoryItem",
    body: "Inventory weight and item drop for player. Server validates item amount.",
  },
  garage: {
    triggers: "garage, spawn vehicle, player vehicles",
    paths: "resources/vrp_garages/client.lua",
    symbols: "spawnVehicle",
    body: "Garage opens NUI with player vehicles; server checks ownership.",
  },
  bank: {
    triggers: "bank, deposit, withdraw, player money",
    paths: "resources/vrp_bank/server.lua",
    symbols: "tryWithdraw",
    body: "Bank deposit and withdraw use player money wallet.",
  },
  wardrobe: {
    triggers: "wardrobe, clothes, outfit presets",
    paths: "resources/wardrobe/server.lua",
    symbols: "saveOutfit",
    body: "Wardrobe saves outfit presets per player with cacheaside.",
  },
  robbery: {
    triggers: "robbery, heist, store robbery, police alert",
    paths: "resources/robberys/server.lua",
    symbols: "startRobbery",
    body: "Store robbery requires police count; alerts via cerberus.",
  },
  phone: {
    triggers: "phone, smartphone, messages",
    paths: "resources/smartphone/server.lua",
    symbols: "sendMessage",
    body: "Phone messages are stored in smartphone_messages table.",
  },
  crafting: {
    triggers: "crafting, craft recipe, workbench",
    paths: "resources/craft/server.lua",
    symbols: "craftItem",
    body: "Crafting consumes items from player inventory at a workbench.",
  },
  hud: {
    triggers: "hud, hunger, thirst, status bars",
    paths: "resources/hud/client.lua",
    symbols: "setStatus",
    body: "HUD shows hunger and thirst of the player; NUI updates every 1s.",
  },
};

const CASES = [
  ["como corrigir o bug do inventario quando o player dropa item", "inventory"],
  ["garagem nao abre", "garage"],
  ["o player nao consegue sacar dinheiro no banco", "bank"],
  ["salvar roupa no guarda roupa", "wardrobe"],
  ["assalto a loja nao avisa a policia", "robbery"],
  ["mensagem do celular nao chega", "phone"],
  ["fabricar item na bancada", "crafting"],
  ["barra de fome e sede travada", "hud"],
  ["fix inventory drop", "inventory"],
  ["spawnVehicle returns nil", "garage"],
  ["crafting recipe broken", "crafting"],
];

function writeMemory(dir, slug, spec) {
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---
topic: ${slug}
updated: 2026-09-01
framework: vrp
lang: en-compact
paths: [${spec.paths}]
symbols: [${spec.symbols}]
triggers: [${spec.triggers}]
---

# ${slug}

${spec.body}

Files:
- server: \`${spec.paths}\`

Pitfalls:
- validate on server
`,
    "utf8",
  );
}

describe("memory retrieval", () => {
  let root;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxretrieval-"));
    const mem = path.join(root, ".fxmind", "memory");
    fs.mkdirSync(mem, { recursive: true });
    for (const [slug, spec] of Object.entries(MEMORIES)) writeMemory(mem, slug, spec);
    tools.buildGraph(root, { updateHtml: false });
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const [question, expected] of CASES) {
    it(`"${question}" → ${expected}`, () => {
      const result = tools.queryGraph(root, question, { rebuild: false });
      assert.equal(result.ok, true);
      assert.equal(result.memories[0]?.slug, expected, JSON.stringify(result.memories.map((m) => [m.slug, m.score])));
    });
  }

  it("a word shared by every memory does not load unrelated memories", () => {
    const result = tools.queryGraph(root, "player", { rebuild: false });
    assert.equal(result.ok, true);
    assert.ok(result.memories.length <= 3);
    const unrelated = tools.queryGraph(root, "garagem do player", { rebuild: false });
    assert.deepEqual(unrelated.memories.map((m) => m.slug), ["garage"]);
  });

  it("filler-only questions match nothing", () => {
    const result = tools.queryGraph(root, "como fazer isso funcionar", { rebuild: false });
    assert.equal(result.memories.length, 0);
  });

  it("returns repository-relative paths and lists related topics without loading them", () => {
    const result = tools.queryGraph(root, "garagem", { rebuild: false });
    assert.equal(result.memories[0].path, ".fxmind/memory/garage.md");
    assert.ok(fs.existsSync(result.memories[0].file));
    assert.ok(Array.isArray(result.related));
    assert.ok(result.related.every((r) => !result.memories.some((m) => m.slug === r.slug)));
  });

  it("keeps the matching section when the memory exceeds the budget", () => {
    const memory = {
      slug: "big",
      topic: "big",
      triggers: [],
      symbols: [],
      exports: [],
      events: [],
      resources: [],
      paths: ["resources/big/server.lua"],
    };
    const content = `---\ntopic: big\n---\n# big\n\nIntro line.\n\n## Garage spawn\n${"spawn rule. ".repeat(20)}\n\n## Bank\n${"bank rule. ".repeat(400)}\n`;
    const doc = retrieval.buildDoc(memory, content);
    const concepts = retrieval.questionConcepts("garagem spawn");
    for (const concept of concepts) concept.idf = 1;
    const fitted = retrieval.fitMemory(doc, concepts, 150);
    assert.equal(fitted.truncated, true);
    assert.match(fitted.content, /Garage spawn/);
    assert.doesNotMatch(fitted.content, /bank rule/);
    assert.deepEqual(fitted.omittedSections, ["Bank"]);
    assert.ok(retrieval.estimateTokens(fitted.content) <= 150);
  });

  it("formats results as compact Markdown", () => {
    const result = tools.queryGraph(root, "garagem", { rebuild: false });
    const text = retrieval.formatQueryResult(result);
    assert.match(text, /^fxmind_query: 1 memory/);
    assert.match(text, /## garage — \.fxmind\/memory\/garage\.md/);
    assert.doesNotMatch(text, /\\n/);
  });
});
