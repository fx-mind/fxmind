"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readProjectEnv(root, env = process.env) {
  let local = {};
  try {
    local = require("dotenv").parse(fs.readFileSync(path.join(root, ".env")));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Unable to read the project .env file.");
  }
  // Scope secrets to the caller; never inject project values into the MCP process.
  return { ...local, ...env };
}

module.exports = { readProjectEnv };
