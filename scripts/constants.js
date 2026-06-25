/** Install command strings — single source for docs and error messages. */
const GITHUB_PKG = "github:fx-mind/fxmind";
const INSTALL_BIN = "fxmind";

function npxInstall(extraArgs = "-y") {
  const args = extraArgs ? ` ${extraArgs}` : "";
  return `npx --yes ${GITHUB_PKG}${args}`;
}

function globalInstall() {
  return `npm install -g ${GITHUB_PKG}`;
}

module.exports = {
  GITHUB_PKG,
  INSTALL_BIN,
  npxInstall,
  globalInstall,
};
