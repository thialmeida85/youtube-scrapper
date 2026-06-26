#!/usr/bin/env node
const fs = require("node:fs");
const { suppressKnownRuntimeWarnings } = require("./warnings.js");
const { loadEnv } = require("./config.js");
const { analyzeVideo } = require("./service.js");

suppressKnownRuntimeWarnings();
loadEnv();

const args = process.argv.slice(2);
const videoInput = args.find((arg) => !arg.startsWith("--"));
const outputPath = getFlagValue(args, "--out");
const pretty = args.includes("--pretty");

if (!videoInput) {
  console.error("Uso: npm run cli -- <url-ou-id> [--out resultado.json] [--pretty]");
  process.exit(1);
}

(async () => {
  try {
    const data = await analyzeVideo(videoInput);
    const json = JSON.stringify(data, null, pretty ? 2 : 0);

    if (outputPath) {
      fs.writeFileSync(outputPath, `${json}\n`, "utf8");
      console.log(`Arquivo salvo em ${outputPath}`);
    } else {
      console.log(json);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();

function getFlagValue(values, flag) {
  const index = values.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return values[index + 1] || null;
}
