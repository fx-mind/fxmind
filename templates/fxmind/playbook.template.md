---
id: {{ID}}
kind: config
title: {{TITLE}}
triggers: [{{TRIGGERS}}]
memories: []
status: draft
updated: {{DATE}}
---

Inputs:
- inputName — where the value comes from / constraint

Steps:
1. `path/relative/to/project.lua` @ `anchor text on an existing line` — what to do there
   ```lua
   ['{{inputName}}'] = { ... },
   ```
2. `other/file.lua` @ `another anchor` — check or edit

Verify:
- observable check that proves it worked (ensure + console clean, in-game flow)

Notes:
- pitfall that is specific to this task (memory Pitfalls of `memories[]` are added automatically)
