#!/usr/bin/env node

const path = require('node:path');
const { runSbmlReport } = require('../scripts/run-sbml-report');
const { runSbmlDynmsSimulation } = require('../scripts/run-sbml-dynms-simulation');

function parseOptions(argumentsList) {
  const options = {};

  for (const argument of argumentsList) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (match) {
      options[match[1]] = match[2];
      continue;
    }

    const flagMatch = /^--([^=]+)$/.exec(argument);
    if (!flagMatch) {
      throw new Error(`Invalid option: ${argument}`);
    }
    options[flagMatch[1]] = 'true';
  }

  return options;
}

function printUsage() {
  console.log('Usage:');
  console.log('  fcts sbml-report --source=<index> --target=<directory> [--input-field=<field>] [--concurrency=<number>] [--skip=<number>] [--limit=<number>] [--skip-component-tags=<tag,...>] [--skip-test-tags=<tag,...>]');
  console.log('  fcts sbml-dynms-simulation --source=<index> --target=<directory> [--input-field=sbmlL2V5Path] [--concurrency=<number>] [--skip=<number>] [--limit=<number>] [--skip-component-tags=<tag,...>] [--skip-test-tags=<tag,...>]');
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2);

  if (command === 'sbml-report') {
    await runSbmlReport(parseOptions(argumentsList), path.resolve(__dirname, '..'));
    return;
  }

  if (command === 'sbml-dynms-simulation') {
    await runSbmlDynmsSimulation(parseOptions(argumentsList), path.resolve(__dirname, '..'));
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`fcts failed: ${error.message}`);
  process.exitCode = 1;
});
