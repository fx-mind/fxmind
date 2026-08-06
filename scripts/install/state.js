/**
 * install/state — mutable installer state shared across modules.
 * SKILL_SOURCES is (re)built from selected packs during CLI resolution.
 */
const state = {
  SKILL_SOURCES: new Map(),
};

module.exports = state;
