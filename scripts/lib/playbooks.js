/**
 * Playbooks — surgical instructions for repeated tasks.
 *
 * A memory says what a topic is; a playbook says what to do for a recurring
 * request ("cadastrar skin de arma"): which files, at which anchor, what to
 * insert and how to verify. Line numbers are never stored — each step carries
 * an anchor (text) that is resolved against the file when the playbook is
 * loaded, so the agent gets the current line. A step whose file or anchor no
 * longer exists marks the playbook stale and the caller falls back to memories.
 *
 * Every task also gets a kind (config | fix | mechanic | create) that selects
 * how memories are loaded when no playbook applies.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const retrieval = require("./memory-retrieval");

const KINDS = ["config", "fix", "mechanic", "create"];
const PLAYBOOKS_DIR = "playbooks";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ANCHOR_LINES = 5;
const PITFALLS_TOKENS = 300;

/** How memories are loaded per kind when no playbook applies. */
const KIND_PROFILES = {
  config: { budget: 1200, priority: ["files", "recipe", "pitfalls"], dfs: false },
  fix: { budget: 1500, priority: ["files", "pitfalls", "recipe"], dfs: false },
  mechanic: { budget: 2200, priority: ["recipe", "files", "pitfalls", "example"], dfs: true },
  create: { budget: 1200, priority: ["files", "recipe", "pitfalls"], dfs: false },
};

const KIND_GUIDE = {
  config: "data/config entry: use the memory Files+Recipe to find the exact table and edit it; no design, no broad search.",
  fix: "defect: reproduce first, then cause; memory Pitfalls/symbols point at the suspects; run the twin check.",
  mechanic: "behavior change: write INTENT (code / check / spec) before editing; read the whole flow and its callers.",
  create: "new resource: follow .fxmind/modes/create.md (design, approval, build per slice).",
};

// ── Kind classification ─────────────────────────────────────────────────────

const KIND_SIGNALS = {
  fix: [
    [/\b(erro|erros|bug|bugs|bugado|bugada|bugou|quebrou|quebrado|quebrada|crash|crashou|falha|falhando|exception|error|failed|nil value|attempt to|script error|stack trace|travando|travou)\b/, 3],
    [/\bnao (esta |ta )?(funcion\w*|abre|abrindo|carrega\w*|aparece\w*|salva\w*|salvando|mostra\w*|sincroniza\w*|atualiza\w*|consegue|da|vai|pega|entra)\b/, 3],
    [/\b(corrig\w*|corrij\w*|conserta\w*|consertar|arrum\w*|resolv\w*|fix\w*|debug\w*)\b/, 2],
    [/\b(sumiu|sumindo|duplic\w*|dupando|dupou|desync\w*)\b/, 2],
  ],
  create: [
    [/\b(cri\w*|desenvolv\w*|fazer|faca|monte|montar|build|make)\b.{0,30}\b(resource|resources|recurso|sistema|script|modulo|plugin)\b/, 4],
    [/\b(nova|novo) (resource|recurso|sistema|script|modulo)\b/, 4],
  ],
  mechanic: [
    [/\b(faca com que|fazer com que|para que|de forma que|passe a|passar a|deve passar)\b/, 3],
    [/\b(quando|ao|se)\b.{0,50}\b(deve|deveria|precisa|tem que|tem de|entao|passa)\b/, 2],
    [/\b(mudar|alterar|trocar|modificar|ajustar|melhorar|refatorar)\b.{0,20}\b(como|regra|logica|mecanica|comportamento|funcionamento|fluxo|sistema|calculo)\b/, 3],
    [/\b(regra|mecanica|comportamento|logica|fluxo)\b/, 1],
  ],
  config: [
    [/\b(cadastr\w*|registr\w*|liber\w*|habilit\w*|desabilit\w*|ativar|desativar)\b/, 2],
    [/\b(adicion\w*|inclu\w*|colo[ck]\w*|insir\w*|add)\b.{0,30}\b(item|itens|skin|skins|arma|armas|veiculo|veiculos|carro|preco|valor|receita|loja|permissao|grupo|vip|blip|local|ponto|categoria|emprego|cargo|lista|produto|kit|pack)\b/, 4],
    [/\b(mudar|alterar|trocar|ajustar|atualizar|aumentar|diminuir|reduzir)\b.{0,20}\b(preco|valor|quantidade|limite|nome|cooldown|tempo|salario|chance|taxa|peso)\b/, 3],
    [/\b(config\w*)\b/, 1],
  ],
};

/**
 * Heuristic task kind for a prompt. `kind` is null when nothing matches;
 * `confidence` is "high" when the winner leads the runner-up by 2+ points.
 * The agent confirms or corrects it at Gate A.
 */
function classifyKind(prompt) {
  const text = retrieval.canonicalize(prompt);
  if (!text) return { kind: null, confidence: "none", scores: {} };
  const scores = {};
  for (const kind of KINDS) {
    scores[kind] = KIND_SIGNALS[kind].reduce((sum, [re, weight]) => sum + (re.test(text) ? weight : 0), 0);
  }
  const ranked = KINDS.filter((k) => scores[k] > 0).sort((a, b) => scores[b] - scores[a]);
  if (!ranked.length) return { kind: null, confidence: "none", scores };
  const margin = scores[ranked[0]] - (ranked[1] ? scores[ranked[1]] : 0);
  return { kind: ranked[0], confidence: margin >= 2 ? "high" : "low", scores };
}

function normalizeKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return KINDS.includes(kind) ? kind : null;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

function playbooksDir(root) {
  return path.join(path.resolve(root), ".fxmind", PLAYBOOKS_DIR);
}

function parseFrontmatter(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: String(content) };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const list = line.match(/^([a-zA-Z0-9_]+):\s*\[(.*)\]\s*$/);
    if (list) {
      meta[list[1]] = list[2]
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }
    const scalar = line.match(/^([a-zA-Z0-9_]+):\s*(.+?)\s*$/);
    if (scalar) meta[scalar[1]] = scalar[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: String(content).slice(match[0].length) };
}

/** Body → { label: lines[] }, fence-aware ("Label:" or "## Label" headings). */
function splitBody(body) {
  const sections = {};
  let current = "intro";
  let fenced = false;
  sections[current] = [];
  for (const line of String(body).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = !fenced && (line.match(/^#{1,6}\s+(.+?)\s*$/) || line.match(/^([A-Za-z][A-Za-z ]{0,30}):\s*$/));
    if (heading) {
      current = retrieval.canonicalize(heading[1]).replace(/\s+/g, " ");
      sections[current] = sections[current] || [];
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

const STEP_RE = /^\s*(?:\d+[.)]|[-*])\s+`([^`]+)`(?:\s+@\s+`([^`]+)`)?(?:\s+[—–-]+\s*(.*))?\s*$/;

function parseSteps(lines) {
  const steps = [];
  let step = null;
  let snippet = null;
  for (const line of lines) {
    const fence = line.match(/^(\s*)```(\w*)\s*$/);
    if (snippet) {
      if (fence) {
        step.snippet = dedent(snippet.lines, snippet.indent);
        step.snippetLang = snippet.lang;
        snippet = null;
      } else {
        snippet.lines.push(line);
      }
      continue;
    }
    if (fence && step) {
      snippet = { lang: fence[2] || "", indent: fence[1].length, lines: [] };
      continue;
    }
    const match = line.match(STEP_RE);
    if (match) {
      step = { file: match[1].trim(), anchor: (match[2] || "").trim(), instruction: (match[3] || "").trim() };
      steps.push(step);
    } else if (step && line.trim()) {
      step.instruction = `${step.instruction} ${line.trim()}`.trim();
    }
  }
  return steps;
}

/** Strip only the fence's own indentation, so the snippet keeps its relative indentation (tabs included). */
function dedent(lines, indent) {
  return lines
    .map((l) => {
      let i = 0;
      while (i < indent && i < l.length && (l[i] === " " || l[i] === "\t")) i += 1;
      return l.slice(i);
    })
    .join("\n")
    .replace(/\s+$/, "");
}

function bulletLines(lines) {
  return lines
    .map((l) => l.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

function parseInputs(lines) {
  return bulletLines(lines).map((text) => {
    const match = text.match(/^`?([A-Za-z_][\w-]*)`?\s*(?:[—–-]+\s*(.*))?$/);
    return match ? { name: match[1], hint: (match[2] || "").trim() } : { name: text, hint: "" };
  });
}

function parsePlaybook(content, file = "") {
  const { meta, body } = parseFrontmatter(content);
  const sections = splitBody(body);
  const slug = path.basename(file).replace(/\.md$/i, "");
  return {
    id: meta.id || slug,
    slug,
    file,
    kind: normalizeKind(meta.kind),
    title: meta.title || meta.id || slug,
    triggers: Array.isArray(meta.triggers) ? meta.triggers : [],
    memories: Array.isArray(meta.memories) ? meta.memories : [],
    status: meta.status === "verified" ? "verified" : "draft",
    updated: meta.updated || "",
    lastVerified: meta.last_verified || "",
    inputs: parseInputs(sections.inputs || []),
    steps: parseSteps(sections.steps || []),
    verify: bulletLines(sections.verify || []),
    notes: (sections.notes || sections.pitfalls || []).join("\n").trim(),
  };
}

function loadPlaybooks(root) {
  const dir = playbooksDir(root);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.startsWith("_")) continue;
    try {
      out.push(parsePlaybook(fs.readFileSync(path.join(dir, entry.name), "utf8"), path.join(".fxmind", PLAYBOOKS_DIR, entry.name).replace(/\\/g, "/")));
    } catch {
      // unreadable playbook: skipped, `fxmind playbooks check` reports it
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function getPlaybook(root, id) {
  const wanted = String(id || "").trim().toLowerCase();
  return loadPlaybooks(root).find((pb) => pb.id.toLowerCase() === wanted || pb.slug.toLowerCase() === wanted) || null;
}

// ── Anchor resolution ───────────────────────────────────────────────────────

function anchorRegex(anchor) {
  const parts = anchor.split(/\{\{[^}]*\}\}/).map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(parts.join(".+?"));
}

function readLines(root, file, cache) {
  if (cache.has(file)) return cache.get(file);
  let lines = null;
  try {
    const abs = path.resolve(root, file);
    const rel = path.relative(path.resolve(root), abs);
    const stat = fs.statSync(abs);
    if (!rel.startsWith("..") && !path.isAbsolute(rel) && stat.isFile() && stat.size <= MAX_FILE_BYTES) {
      lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    }
  } catch {
    lines = null;
  }
  cache.set(file, lines);
  return lines;
}

/** Steps with `resolved` = { ok, lines[], count, reason }. */
function resolveSteps(root, playbook) {
  const cache = new Map();
  const steps = playbook.steps.map((step) => {
    const lines = readLines(root, step.file, cache);
    if (!lines) return { ...step, resolved: { ok: false, lines: [], count: 0, reason: `file not found: ${step.file}` } };
    if (!step.anchor) return { ...step, resolved: { ok: true, lines: [], count: 0, reason: "" } };
    const re = anchorRegex(step.anchor);
    const found = [];
    let count = 0;
    lines.forEach((text, index) => {
      if (!re.test(text)) return;
      count += 1;
      if (found.length < MAX_ANCHOR_LINES) found.push(index + 1);
    });
    return {
      ...step,
      resolved: count
        ? { ok: true, lines: found, count, reason: "" }
        : { ok: false, lines: [], count: 0, reason: `anchor not found in ${step.file}: ${step.anchor}` },
    };
  });
  const problems = steps.filter((s) => !s.resolved.ok).map((s) => s.resolved.reason);
  return { steps, stale: problems.length > 0, problems };
}

// ── Matching ────────────────────────────────────────────────────────────────

const FILLER = new Set(
  "de da do das dos em no na nos nas um uma uns umas para pra pro por pelo pela com que novo nova novos novas o a os as e the an to for of".split(" "),
);

const ACTION_GROUPS = [
  "cadastrar cadastra cadastre cadastro registrar registra registre adicionar adiciona adicione incluir inclui inclua criar cria crie colocar coloca coloque inserir insere insira add create register",
  "remover remove remova tirar tira tire excluir exclui exclua apagar apaga apague delete",
  "alterar altera altere mudar muda mude trocar troca troque editar edita edite atualizar atualiza atualize ajustar ajusta ajuste change edit update",
].map((group) => group.split(" ").map(retrieval.stem));

const ACTION_VARIANTS = new Map();
for (const group of ACTION_GROUPS) for (const term of group) ACTION_VARIANTS.set(term, group);

function tokens(text) {
  return retrieval
    .canonicalize(text)
    .split(" ")
    .filter((t) => t.length >= 3 && !FILLER.has(t))
    .map(retrieval.stem);
}

function tokenPresent(term, promptTokens) {
  const variants = new Set([...(ACTION_VARIANTS.get(term) || []), ...retrieval.expandTerm(term)]);
  variants.add(term);
  for (const variant of variants) {
    if (promptTokens.has(variant)) return true;
    if (variant.length < 5) continue;
    for (const candidate of promptTokens) {
      if (candidate.length >= 5 && Math.abs(candidate.length - variant.length) <= 3 && (candidate.startsWith(variant) || variant.startsWith(candidate))) return true;
    }
  }
  return false;
}

/**
 * Best playbook for a prompt: one of its triggers must have every significant
 * term (≥2) present in the prompt, synonyms and PT action verbs included. A bug
 * report never selects a non-fix playbook. Longer trigger wins, then verified.
 */
function matchPlaybook(playbooks, prompt, classification = classifyKind(prompt)) {
  const promptTokens = new Set(tokens(prompt));
  let best = null;
  for (const pb of playbooks) {
    if (!pb.kind || !pb.steps.length) continue;
    if (classification.kind === "fix" && classification.confidence === "high" && pb.kind !== "fix") continue;
    for (const trigger of pb.triggers) {
      const terms = [...new Set(tokens(trigger))];
      if (terms.length < 2 || !terms.every((term) => tokenPresent(term, promptTokens))) continue;
      const score = terms.length + (pb.status === "verified" ? 0.5 : 0);
      if (!best || score > best.score) best = { playbook: pb, trigger, score };
    }
  }
  return best;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function readMemoryPitfalls(root, slug, maxTokens = PITFALLS_TOKENS) {
  try {
    const file = path.join(path.resolve(root), ".fxmind", "memory", `${slug}.md`);
    const doc = retrieval.splitSections(retrieval.splitFrontmatter(fs.readFileSync(file, "utf8")));
    const text = doc.filter((s) => s.label.startsWith("pitfalls")).map((s) => s.text).join("\n");
    return text.slice(0, maxTokens * 4);
  } catch {
    return "";
  }
}

function anchorNote(step) {
  const r = step.resolved;
  if (!step.anchor) return `\`${step.file}\``;
  const where = r.count > 1 ? `lines ${r.lines.join(", ")}${r.count > r.lines.length ? ", …" : ""}` : `line ${r.lines[0]}`;
  return `\`${step.file}\` ${where} (anchor \`${step.anchor}\`)`;
}

function renderPlaybook(root, playbook, resolved) {
  const lines = [
    `# fxmind — playbook \`${playbook.id}\` (${playbook.kind}, ${playbook.status})`,
    playbook.title,
    "",
  ];
  if (playbook.inputs.length) {
    lines.push("Inputs — take them from the request, ask only what is missing:");
    for (const input of playbook.inputs) lines.push(`- ${input.name}${input.hint ? ` — ${input.hint}` : ""}`);
    lines.push("");
  }
  lines.push("Steps:");
  resolved.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${anchorNote(step)}${step.instruction ? ` — ${step.instruction}` : ""}`);
    if (step.snippet) lines.push("```" + step.snippetLang, step.snippet, "```");
  });
  if (playbook.verify.length) {
    lines.push("", "Verify:");
    for (const v of playbook.verify) lines.push(`- ${v}`);
  }
  const pitfalls = playbook.memories.map((slug) => readMemoryPitfalls(root, slug)).filter(Boolean);
  if (playbook.notes) pitfalls.unshift(playbook.notes);
  if (pitfalls.length) lines.push("", "Pitfalls:", pitfalls.join("\n"));
  lines.push(
    "",
    "This playbook is the discovery: skip fxmind_query and repository search. Read only ~25 lines around each listed line, then edit.",
    "If a file or anchor contradicts it, stop editing, say so and continue with the memory flow (the playbook is then stale).",
    `Start the task with fxmind_start_task { kind: "${playbook.kind}", playbook: "${playbook.id}" }.`,
  );
  return lines.join("\n");
}

// ── Planning (used by hook + panel) ─────────────────────────────────────────

/**
 * Decide how to load context for a prompt.
 * → { kind, confidence, source, profile, playbook, playbookText, stale }
 * `playbook` is set only when it matched and every anchor resolved.
 */
function planTask(root, prompt, options = {}) {
  const classification = classifyKind(prompt);
  const plan = {
    kind: classification.kind,
    confidence: classification.confidence,
    source: classification.kind ? "heuristic" : "none",
    profile: classification.kind ? KIND_PROFILES[classification.kind] : null,
    playbook: null,
    playbookText: "",
    stale: null,
  };
  if (options.playbooks === false) return plan;

  const match = matchPlaybook(loadPlaybooks(root), prompt, classification);
  if (!match) return plan;
  const pb = match.playbook;
  plan.kind = pb.kind;
  plan.confidence = "high";
  plan.source = "playbook";
  plan.profile = KIND_PROFILES[pb.kind];
  const resolved = resolveSteps(root, pb);
  if (resolved.stale) {
    plan.stale = { id: pb.id, problems: resolved.problems };
    return plan;
  }
  plan.playbook = { id: pb.id, status: pb.status, trigger: match.trigger };
  plan.playbookText = renderPlaybook(root, pb, resolved);
  return plan;
}

/** One line telling the agent the detected kind and how to load context. */
function kindLine(plan) {
  if (!plan.kind) return "";
  const how = plan.source === "playbook" ? "matched a playbook" : `${plan.confidence} confidence heuristic — confirm or correct it at Gate A`;
  return `Task kind: ${plan.kind} (${how}). ${KIND_GUIDE[plan.kind]}`;
}

function staleLine(plan) {
  if (!plan.stale) return "";
  return `Playbook \`${plan.stale.id}\` matched but is stale (${plan.stale.problems.join("; ")}). Use the memory flow, then fix or re-teach it (\`.fxmind/modes/teach.md\`).`;
}

// ── Validation / lifecycle ──────────────────────────────────────────────────

function checkPlaybook(root, playbook) {
  const errors = [];
  const warnings = [];
  if (!playbook.kind) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  if (!playbook.triggers.length) errors.push("triggers[] is empty");
  for (const trigger of playbook.triggers) {
    if (new Set(tokens(trigger)).size < 2) warnings.push(`trigger "${trigger}" has <2 significant terms and never matches`);
  }
  if (!playbook.steps.length) errors.push("no steps (Steps: section with - `path` @ `anchor` — instruction)");
  if (!playbook.verify.length) warnings.push("no Verify: section");
  for (const slug of playbook.memories) {
    if (!fs.existsSync(path.join(path.resolve(root), ".fxmind", "memory", `${slug}.md`))) warnings.push(`memory not found: ${slug}`);
  }
  for (const problem of resolveSteps(root, playbook).problems) errors.push(problem);
  return { ok: errors.length === 0, errors, warnings };
}

/** draft → verified after a task that used it passed Gate V and C. Returns true when the file changed. */
function markVerified(root, id) {
  const pb = getPlaybook(root, id);
  if (!pb || pb.status === "verified") return false;
  const file = path.join(path.resolve(root), pb.file);
  const today = new Date().toISOString().slice(0, 10);
  let content = fs.readFileSync(file, "utf8");
  const set = (text, key, value) =>
    new RegExp(`^${key}:.*$`, "m").test(text)
      ? text.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`)
      : text.replace(/^---\r?\n/, `---\n${key}: ${value}\n`);
  content = set(set(content, "status", "verified"), "last_verified", today);
  fs.writeFileSync(file, content, "utf8");
  return true;
}

function summarize(playbook) {
  return {
    id: playbook.id,
    kind: playbook.kind,
    title: playbook.title,
    status: playbook.status,
    triggers: playbook.triggers,
    steps: playbook.steps.length,
    file: playbook.file,
  };
}

module.exports = {
  KINDS,
  KIND_PROFILES,
  classifyKind,
  normalizeKind,
  playbooksDir,
  parsePlaybook,
  loadPlaybooks,
  getPlaybook,
  resolveSteps,
  matchPlaybook,
  renderPlaybook,
  planTask,
  kindLine,
  staleLine,
  checkPlaybook,
  markVerified,
  summarize,
};
