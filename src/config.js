const fs = require("node:fs");
const path = require("node:path");

let loadedEnvPath = null;

function loadEnv(filePath) {
  const candidates = filePath ? [filePath] : getEnvCandidates();
  const envPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!envPath) {
    return null;
  }

  loadedEnvPath = envPath;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return loadedEnvPath;
}

function getLoadedEnvPath() {
  return loadedEnvPath;
}

function getEnvCandidates() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(path.dirname(process.execPath), ".env"),
    path.resolve(path.dirname(process.execPath), "..", ".env"),
  ];

  return [...new Set(candidates)];
}

function requireConfig(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Configure ${name} no arquivo .env.`);
  }
  return value;
}

module.exports = {
  getLoadedEnvPath,
  loadEnv,
  requireConfig,
};
