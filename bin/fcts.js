#!/usr/bin/env node

const path = require('node:path');
const { runSbmlReport } = require('../scripts/run-sbml-report');

function parseOptions(argumentsList) {
  const options = {};

  for (const argument of argumentsList) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match) {
      throw new Error(`Invalid option: ${argument}`);
    }
    options[match[1]] = match[2];
  }

  return options;
}

function printUsage() {
  console.log('Usage: fcts report --source=<index> --target=<directory> [--input-field=<field>] [--concurrency=<number>] [--skip=<number>] [--limit=<number>]');
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2);

  if (command === 'report') {
    await runSbmlReport(parseOptions(argumentsList), path.resolve(__dirname, '..'));
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`fcts failed: ${error.message}`);
  process.exitCode = 1;
});
