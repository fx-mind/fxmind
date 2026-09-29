const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const playbooks = require("./playbooks");
const tools = require("../fxmind-tools");
const promptContext = require("../prompt-context");

const WEAPONS = [
  "ConfigWeapons = {}",
  "ConfigWeapons.Items = {}",
  "ConfigWeapons.Items.general = {",
  "    ['OldSkin'] = { meta = { weaponModel = 'WEAPON_OLD', originalModel = 'WEAPON_PISTOL' } },",
  "}",
  "ConfigWeapons.Items.police = {",
  "}",
].join("\n");

const PLAYBOOK = `---
id: add-weapon-skin
kind: config
title: Cadastrar skin de arma
triggers: [cadastrar skin de arma, adicionar skin, nova skin]
memories: [skins-armas]
status: draft
updated: 2026-09-29
---

Inputs:
- skinId — chave em ConfigWeapons (= skinid no DB)
- scope — general ou police

Steps:
1. \`resources/boxes/weapons.lua\` @ \`ConfigWeapons.Items.{{scope}} = {\` — inserir a entrada depois desta linha
   \`\`\`lua
   ['{{skinId}}'] = { meta = { weaponModel = '...', originalModel = '...' } },
   \`\`\`
2. \`resources/inventory/itemlist.lua\` — conferir que originalModel existe

Verify:
- ensure boxes sem erro no console
- equipar a skin troca o modelo

Notes:
- chave nao pode ser renomeada depois
`;

const MEMORY = `---
topic: skins-armas
updated: 2026-09-01
lang: en-compact
paths: [resources/boxes/weapons.lua]
triggers: [skinchanger, ConfigWeapons]
---

# skins-armas

Files:
- config: \`resources/boxes/weapons.lua\`

Pitfalls:
- Config key = skinid in DB; rename breaks existing skins.
`;

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

describe("playbooks", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxplaybook-"));
    write(root, "resources/boxes/weapons.lua", WEAPONS);
    write(root, "resources/inventory/itemlist.lua", "WEAPON_PISTOL = {}\n");
    write(root, ".fxmind/memory/skins-armas.md", MEMORY);
    write(root, ".fxmind/playbooks/add-weapon-skin.md", PLAYBOOK);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("classifyKind", () => {
    const cases = [
      ["cadastrar uma skin de arma nova", "config"],
      ["adicionar o item pistola no preço de 500", "config"],
      ["mudar o valor da multa para 2000", "config"],
      ["a garagem não abre e dá erro no console", "fix"],
      ["attempt to index a nil value em inventory", "fix"],
      ["corrigir bug do banco", "fix"],
      ["fazer com que o salário seja pago a cada 30 minutos", "mechanic"],
      ["mudar a lógica de como o craft consome item", "mechanic"],
      ["criar um novo sistema de corrida", "create"],
      ["cria uma resource de leaderboard", "create"],
    ];
    for (const [prompt, kind] of cases) {
      it(`"${prompt}" → ${kind}`, () => {
        assert.equal(playbooks.classifyKind(prompt).kind, kind);
      });
    }

    it("returns no kind when nothing matches", () => {
      assert.equal(playbooks.classifyKind("oi tudo bem").kind, null);
    });
  });

  describe("parsing", () => {
    it("reads frontmatter, inputs, steps with anchors and snippets, verify", () => {
      const [pb] = playbooks.loadPlaybooks(root);
      assert.equal(pb.id, "add-weapon-skin");
      assert.equal(pb.kind, "config");
      assert.equal(pb.status, "draft");
      assert.deepEqual(pb.memories, ["skins-armas"]);
      assert.deepEqual(pb.inputs.map((i) => i.name), ["skinId", "scope"]);
      assert.equal(pb.steps.length, 2);
      assert.equal(pb.steps[0].file, "resources/boxes/weapons.lua");
      assert.equal(pb.steps[0].anchor, "ConfigWeapons.Items.{{scope}} = {");
      assert.match(pb.steps[0].snippet, /^\['\{\{skinId\}\}'\]/);
      assert.equal(pb.steps[0].snippetLang, "lua");
      assert.equal(pb.steps[1].anchor, "");
      assert.equal(pb.verify.length, 2);
    });
  });

  describe("snippets", () => {
    it("keeps the snippet's own indentation and only strips the fence indent", () => {
      const pb = playbooks.parsePlaybook(
        "---\nid: x\nkind: config\ntriggers: [a b]\n---\nSteps:\n1. `f.lua` @ `x` — y\n   ```lua\n       \"a\",\n   \t\"b\",\n   ```\n",
        "x.md",
      );
      assert.equal(pb.steps[0].snippet, '    "a",\n\t"b",');
    });
  });

  describe("anchors", () => {
    it("resolves anchors to current lines, wildcard for {{placeholders}}", () => {
      const [pb] = playbooks.loadPlaybooks(root);
      const resolved = playbooks.resolveSteps(root, pb);
      assert.equal(resolved.stale, false);
      assert.deepEqual(resolved.steps[0].resolved.lines, [3, 6]);
      assert.equal(resolved.steps[0].resolved.count, 2);
    });

    it("follows the file when lines move", () => {
      write(root, "resources/boxes/weapons.lua", `-- header\n-- header\n${WEAPONS}`);
      const [pb] = playbooks.loadPlaybooks(root);
      assert.deepEqual(playbooks.resolveSteps(root, pb).steps[0].resolved.lines, [5, 8]);
    });

    it("marks the playbook stale when an anchor or file is gone", () => {
      write(root, "resources/boxes/weapons.lua", "-- rewritten\n");
      let resolved = playbooks.resolveSteps(root, playbooks.loadPlaybooks(root)[0]);
      assert.equal(resolved.stale, true);
      assert.match(resolved.problems[0], /anchor not found/);

      fs.rmSync(path.join(root, "resources/inventory/itemlist.lua"));
      resolved = playbooks.resolveSteps(root, playbooks.loadPlaybooks(root)[0]);
      assert.match(resolved.problems.join("\n"), /file not found: resources\/inventory\/itemlist.lua/);
    });

    it("rejects steps that escape the project root", () => {
      const pb = playbooks.parsePlaybook("---\nid: x\nkind: config\ntriggers: [a b]\n---\nSteps:\n1. `../outside.lua` @ `x` — y\n", "x.md");
      assert.equal(playbooks.resolveSteps(root, pb).stale, true);
    });
  });

  describe("matching", () => {
    const match = (prompt) => playbooks.matchPlaybook(playbooks.loadPlaybooks(root), prompt);

    it("matches PT phrasing with action synonyms and conjugations", () => {
      assert.equal(match("cadastrar uma skin de arma pra mim")?.playbook.id, "add-weapon-skin");
      assert.equal(match("preciso adicionar a skin G36 na loja")?.playbook.id, "add-weapon-skin");
      assert.equal(match("cria uma skin nova")?.playbook.id, "add-weapon-skin");
      assert.equal(match("registre as skins do pack")?.playbook.id, "add-weapon-skin");
    });

    it("does not match unrelated or half-matching requests", () => {
      assert.equal(match("cadastrar item novo na loja"), null);
      assert.equal(match("a skin de arma nao aparece"), null);
      assert.equal(match("skin"), null);
    });

    it("never selects a non-fix playbook for a bug report", () => {
      assert.equal(match("adicionar skin deu erro no console e nao funciona"), null);
    });

    it("prefers the more specific trigger, then verified", () => {
      write(root, ".fxmind/playbooks/add-skin-generic.md", PLAYBOOK.replace("id: add-weapon-skin", "id: add-skin-generic").replace("[cadastrar skin de arma, adicionar skin, nova skin]", "[adicionar skin]"));
      assert.equal(match("cadastrar skin de arma")?.playbook.id, "add-weapon-skin");
    });
  });

  describe("planTask", () => {
    it("returns the playbook text with current lines and memory pitfalls", () => {
      const plan = playbooks.planTask(root, "cadastrar uma skin de arma");
      assert.equal(plan.source, "playbook");
      assert.equal(plan.kind, "config");
      assert.equal(plan.playbook.id, "add-weapon-skin");
      assert.match(plan.playbookText, /playbook `add-weapon-skin` \(config, draft\)/);
      assert.match(plan.playbookText, /`resources\/boxes\/weapons.lua` lines 3, 6 \(anchor/);
      assert.match(plan.playbookText, /Config key = skinid in DB/);
      assert.match(plan.playbookText, /skip fxmind_query/);
      assert.match(plan.playbookText, /fxmind_start_task \{ kind: "config", playbook: "add-weapon-skin" \}/);
    });

    it("reports a stale playbook and falls back to the heuristic kind profile", () => {
      write(root, "resources/boxes/weapons.lua", "-- rewritten\n");
      const plan = playbooks.planTask(root, "cadastrar uma skin de arma");
      assert.equal(plan.playbook, null);
      assert.equal(plan.stale.id, "add-weapon-skin");
      assert.equal(plan.kind, "config");
      assert.match(playbooks.staleLine(plan), /stale/);
    });

    it("uses the heuristic kind when no playbook matches", () => {
      const plan = playbooks.planTask(root, "a garagem nao abre");
      assert.equal(plan.kind, "fix");
      assert.equal(plan.source, "heuristic");
      assert.equal(plan.profile, playbooks.KIND_PROFILES.fix);
    });
  });

  describe("checkPlaybook", () => {
    it("passes a healthy playbook and reports problems", () => {
      const [pb] = playbooks.loadPlaybooks(root);
      assert.equal(playbooks.checkPlaybook(root, pb).ok, true);

      write(root, "resources/boxes/weapons.lua", "-- rewritten\n");
      const result = playbooks.checkPlaybook(root, pb);
      assert.equal(result.ok, false);
      assert.match(result.errors[0], /anchor not found/);
    });

    it("flags one-word triggers and unknown kinds", () => {
      const pb = playbooks.parsePlaybook("---\nid: x\nkind: nope\ntriggers: [skin]\n---\nSteps:\n1. `resources/boxes/weapons.lua` — y\n", "x.md");
      const result = playbooks.checkPlaybook(root, pb);
      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /kind must be one of/);
      assert.match(result.warnings.join("\n"), /<2 significant terms/);
    });
  });

  describe("session integration", () => {
    it("start_task with a draft playbook keeps A/B manual and records kind + playbook", () => {
      const data = tools.startTask(root, { kind: "config", playbook: "add-weapon-skin", sessionId: "s1" });
      assert.equal(data.kind, "config");
      assert.equal(data.playbook, "add-weapon-skin");
      assert.equal(data.gates.A, undefined);
    });

    it("a verified playbook auto-completes A and B but not V", () => {
      write(root, ".fxmind/playbooks/add-weapon-skin.md", PLAYBOOK.replace("status: draft", "status: verified"));
      const data = tools.startTask(root, { playbook: "add-weapon-skin", sessionId: "s2" });
      assert.equal(data.kind, "config");
      assert.equal(data.gates.A.complete, true);
      assert.equal(data.gates.B.complete, true);
      assert.equal(data.gates.V, undefined);
    });

    it("a stale playbook never auto-completes gates and warns", () => {
      write(root, ".fxmind/playbooks/add-weapon-skin.md", PLAYBOOK.replace("status: draft", "status: verified"));
      write(root, "resources/boxes/weapons.lua", "-- rewritten\n");
      const data = tools.startTask(root, { playbook: "add-weapon-skin", sessionId: "s3" });
      assert.equal(data.gates.A, undefined);
      assert.match(data.playbookWarning, /stale/);
    });

    it("an unknown playbook or kind is ignored with a warning", () => {
      const data = tools.startTask(root, { kind: "banana", playbook: "nope", sessionId: "s4" });
      assert.equal(data.kind, null);
      assert.match(data.playbookWarning, /not found/);
    });

    it("ui tasks never auto-complete from a playbook", () => {
      write(root, ".fxmind/playbooks/add-weapon-skin.md", PLAYBOOK.replace("status: draft", "status: verified"));
      const data = tools.startTask(root, { playbook: "add-weapon-skin", ui: true, sessionId: "s5" });
      assert.equal(data.gates.A, undefined);
    });

    it("markVerified promotes a draft once and stamps last_verified", () => {
      assert.equal(playbooks.markVerified(root, "add-weapon-skin"), true);
      const [pb] = playbooks.loadPlaybooks(root);
      assert.equal(pb.status, "verified");
      assert.match(pb.lastVerified, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(playbooks.markVerified(root, "add-weapon-skin"), false);
    });
  });

  describe("prompt preload", () => {
    it("injects the playbook instead of memories for a matching request", () => {
      const context = promptContext.buildPromptContext(root, "cadastrar uma skin de arma G36LoveCat");
      assert.match(context, /# fxmind — playbook `add-weapon-skin`/);
      assert.doesNotMatch(context, /preloaded project memories/);
    });

    it("falls back to memories with the kind line when nothing matches a playbook", () => {
      const context = promptContext.buildPromptContext(root, "o skinchanger nao salva a skin equipada, erro no console");
      assert.match(context, /preloaded project memories/);
      assert.match(context, /Task kind: fix/);
    });

    it("playbooks:false skips playbook selection", () => {
      const context = promptContext.buildPromptContext(root, "cadastrar uma skin de arma ConfigWeapons", { playbooks: false });
      assert.doesNotMatch(context, /# fxmind — playbook/);
    });
  });
});
