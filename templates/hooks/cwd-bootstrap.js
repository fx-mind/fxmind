"use strict";
/**
 * Cursor can invoke project hooks from its own extension-host directory.
 * Node --require loads this bootstrap before the selected hook script, so all
 * FxMind hooks use the installed workspace root, regardless of caller cwd.
 *
 * The script is installed at <project>/.cursor/hooks/cwd-bootstrap.js.
 * A missing workspace is a hard error, letting Cursor failClosed block tools.
 */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..", "..");
if (!fs.existsSync(path.join(root, ".cursor", "hooks.json")) ||
    !fs.existsSync(path.join(root, ".fxmind", "memory"))) {
  throw new Error("FXMIND: hook workspace root unavailable: " + root);
}
process.chdir(root);
