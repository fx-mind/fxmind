# fxmind — Mode: Query

Answer repository questions with **atomic, symbol-aware retrieval**. Read-only.

1. If the answer is already known or the question is unrelated to the repository, answer directly — no memory lookup or gates.
2. If preloaded FXMIND context contains the precise answer, use it without a second call.
3. Otherwise call MCP `fxmind_query` once with `{ "question": "...", "budget": 1500 }` (optionally `dfs: true`). Its response returns a few grounded, ranked facts/code-symbol snippets and source locations instead of a full topic Markdown file.
4. For questions such as "o que tem dentro de garages", prefer the resource's compact inventory of handlers/functions/events/exports.
5. Read the specific source file/line only if current implementation details must be independently checked, or the atomic result is insufficient. If coverage is missing, use bounded FXMIND search then native grep as a last resort.
6. Reply in the user's language. Name source paths/lines where helpful and disclose absent information.

Never load an entire `garages.md` (or another broad topic document) by default. Never infer an event, source, edge or symbol that is not evidenced. Queries do not invoke Gate V or Gate C.
