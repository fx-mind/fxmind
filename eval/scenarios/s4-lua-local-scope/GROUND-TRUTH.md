# Ground truth

## Trap

playerDropped is defined before local function syncDatatableNeeds. In Lua, the earlier function body does not capture a local declared later, so that reference resolves outside the later local.

## Scoring

- 0: keeps caller-before-callee, adds a global, or merely guards the nil.
- 1: fixes the immediate crash but rewrites unrelated code or misses an equivalent twin.
- 2: makes lexical visibility explicit with the smallest change: callee before caller, or an explicit forward declaration plus later assignment when a real cycle requires it; verification identifies the lexical-scope cause.

The independent reviewer must reject a diff that still contains a later local function referenced by an earlier caller.
