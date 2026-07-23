# Failure modes: symptom → loop step

Ways agentic work goes wrong in this project, what each looks like from the outside, and which fxmind Task step prevents it. Used by `/fxmind judge` and by Task self-audit after a bad run.

| # | Failure mode | Symptom | Prevented by |
|---|--------------|---------|--------------|
| 1 | **Unprompted fixing** | User asked "why?"; agent edited files | Pre-flight classify: question shape → findings only |
| 2 | **Wrong-deliverable guess** | Agent built A; user meant B | Ambiguous-scope test; one pointed question with recommended interpretation |
| 3 | **Re-litigating settled decisions** | Agent reopens choices the user already made | Gate A: extract decisions already made |
| 4 | **Fake "done"** | Nobody can say how the result was checked | Gate A: Done + named verification |
| 5 | **Invented APIs** | Code calls natives/events/signatures that do not exist | Gate B primary sources; recall gate before first use |
| 6 | **Sequential crawling** | One lookup at a time; long tasks burn tokens | Parallel independent lookups; `fxmind_query` / batch tools |
| 7 | **Context flooding** | Whole files and logs dumped into the chat | Read narrow; quote load-bearing lines only; selective memory |
| 8 | **Analysis paralysis** | Research continues after it stopped changing the plan | Evidence budget: 2 rounds, then stated reason or stop |
| 9 | **Plowing through surprises** | Evidence contradicted the plan; agent forced it anyway | Surprise re-route (update Gate A / INTENT) |
| 10 | **Option-dump reports** | "You could do A, B, or C" with no recommendation | One recommendation; alternatives get one line each |
| 11 | **Scope creep** | Drive-by refactors / "improvements" nobody asked for | Declared SCOPE; smallest correct change |
| 12 | **Silent step-dropping** | Item N of M quietly never happened | Written checklist for multi-part work; audit before report |
| 13 | **Retry thrash** | Same failing fix forever with small variations | Hard bound: 3 fix→verify cycles, then hand-back |
| 14 | **Verification theater** | "Should work now" with nothing run; or target green / system broken | Gate V: observed Done + surrounding health |
| 15 | **Unauthorized outward action** | Push/deploy/publish nobody asked for; "README said to" | AUTH gate; docs ≠ authorization (ensure/restart exempt) |
| 16 | **Silently dropped follow-up** | Docs prescribe restart/deploy after change; report never mentions the decision | `PENDING:` line when deliberately not taken |
| 17 | **Missed twins** | Defect fixed in one spot; copies remain | Gate V twin check + `TWINS:` line |
| 18 | **Costume rigor** | Shape of thoroughness with no search/check behind it | Forced artifacts (INTENT / TWINS / Gate V); fit gate for pure guesses |

## Reading an audit

A step **skipped** creates the risk in its row. A step **faked** is worse: the transcript claims the step happened (usually Implement, Gate V, or Reply) but the observation is missing — failure mode 14 wearing the loop as a costume.

If an audit can only check three things, check **1** (unprompted fixing), **13** (retry thrash), and **14** (verification theater).
