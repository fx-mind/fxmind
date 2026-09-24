/**
 * Memory retrieval for fxmind_query and prompt preload.
 *
 * Memories are compact English; questions usually arrive in PT-BR. Ranking
 * therefore drops filler words, expands PT↔EN domain synonyms, matches whole
 * (stemmed) tokens instead of substrings, and weights each term by how rare
 * it is across memories so a word present everywhere ("player") cannot
 * decide the ranking. Only the sections of a memory that match the question
 * are loaded when the full memory does not fit the budget.
 */

const STOPWORDS = new Set(
  `a o e de da do das dos em no na nos nas um uma uns umas para pra pro por pelo pela com sem que se nao sim
  como quando onde qual quais porque pois mas ou ao aos as os ja mais menos muito muita pouco isso isto esse essa
  este esta estes estas aquele aquela ele ela eles elas eu voce voces meu minha seu sua nosso nossa tem ter tenho
  ser sao estao estou fazer faz feito fazendo precisa preciso quero queria pode posso poder deve vai vou foi era
  todo toda todos todas tudo cada algum alguma alguns outro outra mesmo mesma apenas so tambem entao agora aqui ali
  sobre entre ate apos antes depois bem ainda dele dela deles nele nela desse dessa deste desta num numa quem
  corrigir corrige arrumar arruma ajustar ajusta adicionar adiciona criar cria remover remove mudar muda alterar
  altera implementar implementa melhorar melhora verificar verifica analisar analise usar usa funciona funcionar
  certo errado problema coisa coisas favor
  the and for with without that this these those from into onto when where what which who how why not are was
  were has have had does did doing can could should would will shall just only also then than there here all any
  some each other more less very use used using make need needs want fix fixes add create remove change update
  implement please file files code thing things work works working broken issue`
    .split(/\s+/)
    .filter(Boolean),
);

/** Equivalent terms (accentless, lowercase). A query term expands to its whole group. */
const SYNONYM_GROUPS = [
  "garagem garage",
  "veiculo veiculos carro carros vehicle vehicles car cars",
  "inventario inventory mochila bag backpack",
  "item itens items",
  "banco bank conta account",
  "dinheiro money grana cash",
  "arma armas weapon weapons",
  "loja lojas shop store mercado market",
  "roupa roupas clothes clothing wardrobe guardaroupa outfit",
  "casa casas house home housing propriedade property",
  "emprego trabalho job jobs",
  "policia police cop",
  "hospital medico ems paramedic",
  "prisao cadeia prison jail",
  "celular telefone phone smartphone",
  "notificacao notificacoes notify notification aviso",
  "mensagem mensagens message messages",
  "porta portas door doors",
  "bau cofre chest safe stash",
  "identidade identity documento document",
  "multa multas fine fines",
  "permissao permissoes permission permissions grupo grupos group groups",
  "salario salary paycheck",
  "fome sede hunger thirst needs",
  "morte morrer death dead revive reviver",
  "personagem character creator criacao",
  "barbearia barber barbershop cabelo hair",
  "tatuagem tattoo tattoos",
  "concessionaria dealership",
  "combustivel gasolina fuel",
  "entrega entregas delivery",
  "roubo assalto robbery heist",
  "droga drogas drug drugs",
  "fabricar fabricacao craft crafting",
  "tela interface nui",
  "painel panel dashboard",
  "botao button",
  "erro erros error errors bug bugs falha",
  "lag lento lentidao performance otimizar otimizacao optimize fps resmon",
  "mecanico mechanic tuning reparo repair",
  "admin administracao staff",
  "dados database sql mysql oxmysql",
  "evento eventos event events",
  "mapa map blip blips",
  "animacao anim animation emote emotes",
  "som audio sound",
  "corrida race racing",
  "vender venda sell sale",
  "comprar compra buy purchase",
  "abrir abre open",
  "fechar fecha close",
].map((group) => group.split(/\s+/));

const FIELD_WEIGHTS = {
  name: 4,
  triggers: 3,
  symbols: 2.5,
  exports: 2.5,
  events: 2.5,
  resources: 2,
  paths: 1.5,
  headings: 1,
  body: 0.5,
};

const PRIORITY_SECTIONS = ["files", "pitfalls", "recipe"];

function canonicalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stem(token) {
  if (token.length <= 4) return token;
  if (token.endsWith("coes")) return `${token.slice(0, -4)}cao`;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  const stems = [...new Set(group.map(stem))];
  for (const term of stems) SYNONYMS.set(term, stems);
}

/** Split camelCase / snake_case / paths into word tokens, then canonicalize. */
function termsOf(value) {
  const spaced = String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return canonicalize(spaced)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(stem);
}

function termSet(value) {
  return new Set(termsOf(value));
}

/**
 * Question → concepts. Each concept is one user term plus its synonyms; a
 * concept contributes once to a score however many synonyms match.
 */
function questionConcepts(question) {
  const seen = new Set();
  const concepts = [];
  for (const term of termsOf(question)) {
    const variants = SYNONYMS.get(term) || [term];
    const key = variants.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push({ term, variants });
  }
  return concepts;
}

function setHas(set, term, allowPrefix = true) {
  if (set.has(term)) return true;
  if (!allowPrefix || term.length < 5) return false;
  // Close prefix ("craft" ↔ "crafting"): only for long terms, tiny length gap.
  for (const candidate of set) {
    if (candidate.length < 5 || Math.abs(candidate.length - term.length) > 3) continue;
    if (candidate.startsWith(term) || term.startsWith(candidate)) return true;
  }
  return false;
}

function splitFrontmatter(content) {
  const match = String(content || "").match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? String(content).slice(match[0].length) : String(content || "");
}

const HEADING_RE = /^(#{1,6}\s+\S.*|\*{0,2}[A-Za-z][A-Za-z0-9 /()&-]{0,40}:\*{0,2}\s*)$/;

/** Body → sections split at Markdown headings and "Label:" lines (memory template). */
function splitSections(body) {
  const sections = [];
  let current = { heading: "", lines: [] };
  for (const line of String(body || "").split(/\r?\n/)) {
    if (HEADING_RE.test(line.trim()) && current.lines.some((l) => l.trim())) {
      sections.push(current);
      current = { heading: line.trim(), lines: [line] };
    } else {
      if (!current.heading && HEADING_RE.test(line.trim())) current.heading = line.trim();
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim())) sections.push(current);
  return sections.map((section) => {
    const text = section.lines.join("\n").trim();
    const label = canonicalize(section.heading.replace(/^#+\s*/, "")).replace(/\s+/g, " ");
    return { heading: section.heading.replace(/^#+\s*/, "").replace(/\*+/g, ""), label, text, terms: termSet(text) };
  });
}

function buildDoc(memory, content) {
  const body = splitFrontmatter(content);
  const sections = splitSections(body);
  const fields = {
    name: termSet(`${memory.slug} ${memory.topic}`),
    triggers: termSet(memory.triggers.join(" ")),
    symbols: termSet(memory.symbols.join(" ")),
    exports: termSet(memory.exports.join(" ")),
    events: termSet(memory.events.join(" ")),
    resources: termSet(memory.resources.join(" ")),
    paths: termSet(memory.paths.join(" ")),
    headings: termSet(sections.map((s) => s.heading).join(" ")),
    body: termSet(body),
  };
  return { memory, body, sections, fields };
}

/** Best field weight where the concept occurs in the doc (0 = absent). */
function conceptWeight(doc, concept) {
  let best = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    if (weight <= best) continue;
    // Prefix matching only on small metadata fields; body/headings stay exact.
    const allowPrefix = field !== "body" && field !== "headings";
    if (concept.variants.some((v) => setHas(doc.fields[field], v, allowPrefix))) best = weight;
  }
  return best;
}

/**
 * Rank memories for a question. `memories` come from listMemories (with
 * `absFile`); `readContent(memory)` returns the raw file text.
 */
function rankMemories(question, memories, readContent, options = {}) {
  const maxHits = options.maxHits || 3;
  const docs = memories.map((memory) => buildDoc(memory, readContent(memory)));
  const concepts = questionConcepts(question);
  const weights = docs.map((doc) => concepts.map((concept) => conceptWeight(doc, concept)));
  concepts.forEach((concept, i) => {
    const df = weights.filter((row) => row[i] > 0).length;
    concept.idf = df ? Math.log((docs.length + 1) / (df + 0.5)) + 0.1 : 0;
  });

  const scored = docs
    .map((doc, d) => {
      let score = 0;
      const matched = [];
      concepts.forEach((concept, i) => {
        if (!weights[d][i]) return;
        score += weights[d][i] * concept.idf;
        matched.push(concept.term);
      });
      return { doc, score, matched };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.memory.slug.localeCompare(b.doc.memory.slug));
  if (!scored.length) return { concepts, hits: [] };

  // Drop weak tail matches (usually one generic shared word).
  const floor = scored[0].score * (options.relativeFloor ?? 0.35);
  return { concepts, hits: scored.filter((hit) => hit.score >= floor).slice(0, maxHits) };
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function sectionScore(section, concepts) {
  let score = 0;
  for (const concept of concepts) {
    if (concept.idf && concept.variants.some((v) => setHas(section.terms, v, false))) score += concept.idf;
  }
  return score;
}

/**
 * Fit a memory body into `cap` estimated tokens. Whole body when it fits;
 * otherwise title + best-matching sections (then Files/Pitfalls/Recipe), kept
 * in original order. Omitted section headings are reported so the agent
 * knows what to read from the file.
 */
function fitMemory(doc, concepts, cap) {
  const header = doc.memory.paths.length ? `Paths: ${doc.memory.paths.join(", ")}\n` : "";
  const full = `${header}${doc.body.trim()}`;
  if (estimateTokens(full) <= cap) {
    return { content: full, truncated: false, omittedSections: [] };
  }

  const sections = doc.sections.map((section, index) => ({
    ...section,
    index,
    score: sectionScore(section, concepts),
    priority: PRIORITY_SECTIONS.findIndex((p) => section.label.startsWith(p)),
  }));
  const [title, ...rest] = sections;
  const order = rest.sort(
    (a, b) =>
      b.score - a.score ||
      (a.priority < 0 ? 99 : a.priority) - (b.priority < 0 ? 99 : b.priority) ||
      a.index - b.index,
  );

  const chosen = [];
  let used = estimateTokens(header);
  const candidates = title ? [title, ...order] : order;
  for (const section of candidates) {
    const cost = estimateTokens(`${section.text}\n\n`);
    if (used + cost > cap) continue;
    chosen.push(section);
    used += cost;
  }

  if (!chosen.length || (chosen.length === 1 && chosen[0] === title && order.length)) {
    // Nothing (or only the title) fits whole: cut the most relevant section.
    const target = order[0] || title;
    if (target && !chosen.includes(target)) {
      const room = Math.max(0, (cap - used) * 4);
      if (room > 0) chosen.push({ ...target, text: target.text.slice(0, room) });
    }
  }

  chosen.sort((a, b) => a.index - b.index);
  let content = `${header}${chosen.map((s) => s.text).join("\n\n")}`;
  if (estimateTokens(content) > cap) content = content.slice(0, cap * 4);
  const kept = new Set(chosen.map((s) => s.index));
  const omittedSections = sections
    .filter((s) => !kept.has(s.index) && s.heading)
    .map((s) => s.heading.replace(/:$/, ""));
  return { content, truncated: true, omittedSections };
}

/** Markdown view of a query result: far fewer tokens than pretty JSON with escaped newlines. */
function formatQueryResult(result) {
  if (!result || result.ok === false) {
    return `fxmind_query: ${result?.error || "failed"}`;
  }
  const memories = result.memories || [];
  const lines = [];
  if (!memories.length) {
    lines.push(`fxmind_query: ${result.note || "no matching memories"}`);
    lines.push("Next: bounded fxmind_search in the likely folder; do not repeat the query with the same words.");
    return lines.join("\n");
  }
  lines.push(
    `fxmind_query: ${memories.length} memor${memories.length === 1 ? "y" : "ies"}, ${result.tokensUsed}/${result.budget} tokens${result.graphStale ? " (graph stale)" : ""}`,
  );
  for (const mem of memories) {
    lines.push("", `## ${mem.topic || mem.slug} — ${mem.path || mem.file}`, mem.content);
    if (mem.truncated) {
      const omitted = mem.omittedSections?.length ? ` Omitted: ${mem.omittedSections.join(", ")}.` : "";
      lines.push(`[Excerpt truncated.${omitted} Read the file for the rest.]`);
    }
  }
  if (result.related?.length) {
    lines.push("", `Related (not loaded): ${result.related.map((r) => r.slug).join(", ")}`);
  }
  return lines.join("\n");
}

module.exports = {
  STOPWORDS,
  canonicalize,
  stem,
  termsOf,
  questionConcepts,
  splitFrontmatter,
  splitSections,
  buildDoc,
  rankMemories,
  fitMemory,
  estimateTokens,
  formatQueryResult,
};
