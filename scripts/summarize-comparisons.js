const fs = require('node:fs/promises');

function parseArguments(argumentsList) {
  const options = { policy: 'warning', comparisons: [] };

  for (const argument of argumentsList) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match) {
      throw new Error(`Invalid option: ${argument}`);
    }

    if (match[1] === 'comparison') {
      const separator = match[2].indexOf(':');
      if (separator < 1 || separator === match[2].length - 1) {
        throw new Error('--comparison must be <label>:<path>');
      }
      options.comparisons.push({
        label: match[2].slice(0, separator),
        path: match[2].slice(separator + 1),
      });
    } else {
      options[match[1]] = match[2];
    }
  }

  if (!['warning', 'strict'].includes(options.policy)) {
    throw new Error('--policy must be warning or strict');
  }
  if (!options.comparisons.length) {
    throw new Error('At least one --comparison is required');
  }

  return options;
}

function countCases(comparison) {
  const counts = {
    equal: 0,
    different: 0,
    comparisonError: 0,
    successFailed: 0,
    failedSuccess: 0,
    failedFailed: 0,
    reportError: 0,
  };

  for (const caseResult of comparison.cases || []) {
    if (caseResult.status === 'success-success') {
      if (caseResult.artifactComparison?.status === 'equal') counts.equal += 1;
      else if (caseResult.artifactComparison?.status === 'different') counts.different += 1;
      else counts.comparisonError += 1;
    } else if (caseResult.status === 'success-failed') {
      counts.successFailed += 1;
    } else if (caseResult.status === 'failed-success') {
      counts.failedSuccess += 1;
    } else if (caseResult.status === 'failed-failed') {
      counts.failedFailed += 1;
    } else if (caseResult.status === 'error') {
      counts.reportError += 1;
    }
  }

  return counts;
}

function addCounts(left, right) {
  for (const key of Object.keys(left)) {
    left[key] += right[key];
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const results = [];
  const totals = {
    equal: 0,
    different: 0,
    comparisonError: 0,
    successFailed: 0,
    failedSuccess: 0,
    failedFailed: 0,
    reportError: 0,
  };
  let missingComparison = false;

  for (const entry of options.comparisons) {
    try {
      const comparison = JSON.parse(await fs.readFile(entry.path, 'utf8'));
      const counts = countCases(comparison);
      addCounts(totals, counts);
      results.push({ ...entry, counts, missing: false });
    } catch (error) {
      missingComparison = true;
      results.push({ ...entry, missing: true, message: error.message });
    }
  }

  const hardFailure = missingComparison || totals.successFailed > 0 || totals.comparisonError > 0 || totals.reportError > 0;
  const reviewRequired = totals.different > 0 || totals.failedSuccess > 0;
  const failed = hardFailure || (options.policy === 'strict' && reviewRequired);
  const resultLabel = failed ? 'FAILED' : reviewRequired ? 'REVIEW REQUIRED' : 'PASSED';
  const lines = [
    '## FCTS verification',
    '',
    `Policy: \`${options.policy}\``,
    '',
    '| Comparison | Equal | Different | Comparison errors | Success / failed | Failed / success | Failed / failed | Report errors |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const result of results) {
    if (result.missing) {
      lines.push(`| ${result.label} | — | — | — | — | — | — | missing |`);
      continue;
    }
    const counts = result.counts;
    lines.push(`| ${result.label} | ${counts.equal} | ${counts.different} | ${counts.comparisonError} | ${counts.successFailed} | ${counts.failedSuccess} | ${counts.failedFailed} | ${counts.reportError} |`);
  }

  lines.push('', `**Result: ${resultLabel}**`, '');
  const summary = `${lines.join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  process.stdout.write(summary);

  if (hardFailure) {
    console.log('::error title=FCTS verification failed::A required artifact, comparison, or candidate conversion failed.');
  } else if (reviewRequired) {
    console.log('::warning title=FCTS verification requires review::Candidate outputs differ from the approved reference.');
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Comparison summary failed: ${error.message}`);
  process.exitCode = 1;
});
