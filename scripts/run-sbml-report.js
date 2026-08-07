const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const spawn = require('cross-spawn');
const packageInfo = require('../package.json');

const sbmlL2DefaultUnits = [
  '#defineUnit volume { units: litre };',
  '#defineUnit area { units: metre^2 };',
  '#defineUnit length { units: metre };',
  '#defineUnit substance { units: mole };',
  '#defineUnit time { units: second };',
];

const supportedInputFields = new Set(['sbmlL2V5Path', 'sbmlL3V2Path']);

function parsePositiveInteger(value, optionName, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return Number(value);
}

function parseNonNegativeInteger(value, optionName, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }

  return Number(value);
}

function parseCommaSeparatedValues(value, optionName) {
  if (value === undefined) {
    return [];
  }

  const values = value.split(',').map((item) => item.trim());
  if (!values.length || values.some((item) => !item)) {
    throw new Error(`${optionName} must be a comma-separated list of non-empty values`);
  }

  return [...new Set(values)];
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveInsideRepository(repositoryRoot, inputPath, optionName) {
  const resolvedPath = path.resolve(repositoryRoot, inputPath);
  const relativePath = path.relative(repositoryRoot, resolvedPath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`${optionName} must be a subpath of the repository`);
  }

  return resolvedPath;
}

async function resolveIndexPath(repositoryRoot, sourceOption) {
  const sourcePath = resolveInsideRepository(repositoryRoot, sourceOption, '--source');
  if (await fileExists(sourcePath)) {
    return sourcePath;
  }

  if (!path.extname(sourcePath) && await fileExists(`${sourcePath}.json`)) {
    return `${sourcePath}.json`;
  }

  throw new Error(`Index file does not exist: ${sourceOption}`);
}

function runProcess(command, argumentsList, cwd) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    let child;
    try {
      child = spawn(command, argumentsList, { cwd, shell: false, windowsHide: true });
    } catch (error) {
      finish({ exitCode: null, signal: null, stdout, stderr, error: error.message });
      return;
    }

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      finish({ exitCode: null, signal: null, stdout, stderr, error: error.message });
    });
    child.once('close', (exitCode, signal) => {
      finish({ exitCode, signal, stdout, stderr, error: null });
    });
  });
}

function createBuildSource(sourcePath, distDirectory, inputField) {
  const includePath = path.relative(distDirectory, sourcePath).split(path.sep).join('/');
  const lines = [];

  if (inputField === 'sbmlL2V5Path') {
    lines.push(...sbmlL2DefaultUnits, '');
  }

  lines.push(`#include { source: ${includePath}, type: sbml };`, '');
  return lines.join('\n');
}

function formatNotEvaluatedTags(notEvaluatedTags) {
  const groups = [];
  if (notEvaluatedTags.componentTags.length) {
    groups.push(`component tags: ${notEvaluatedTags.componentTags.join(', ')}`);
  }
  if (notEvaluatedTags.testTags.length) {
    groups.push(`test tags: ${notEvaluatedTags.testTags.join(', ')}`);
  }
  return groups.join('; ');
}

async function buildCase(caseEntry, indexDirectory, targetDirectory, repositoryRoot, inputField, notEvaluatedTags) {
  const sourceFilePath = caseEntry[inputField];
  const result = {
    caseId: caseEntry.caseId,
    sourcePath: sourceFilePath,
    status: 'failed',
  };
  const evaluationNote = formatNotEvaluatedTags(notEvaluatedTags)
    ? ` (not evaluated: ${formatNotEvaluatedTags(notEvaluatedTags)})`
    : '';
  console.log(`Building case ${caseEntry.caseId}${evaluationNote}...`);
  const sourcePath = path.resolve(indexDirectory, sourceFilePath);
  const relativeSourcePath = path.relative(indexDirectory, sourcePath);

  if (relativeSourcePath.startsWith('..') || path.isAbsolute(relativeSourcePath)) {
    result.error = { message: 'Source path is outside the index directory' };
    return result;
  }

  const distDirectory = path.join(targetDirectory, caseEntry.caseId);
  const buildSourcePath = path.join(distDirectory, 'input.heta');
  const logPath = path.join(distDirectory, 'build.log');
  await fsp.mkdir(distDirectory, { recursive: true });
  await fsp.writeFile(
    buildSourcePath,
    createBuildSource(sourcePath, distDirectory, inputField),
  );
  result.buildSourcePath = path
    .relative(targetDirectory, buildSourcePath)
    .split(path.sep)
    .join('/');

  const sourceArgument = path.relative(repositoryRoot, buildSourcePath).split(path.sep).join('/');
  const distArgument = path.relative(repositoryRoot, distDirectory).split(path.sep).join('/');
  const logArgument = path.relative(repositoryRoot, logPath).split(path.sep).join('/');
  const commandArguments = [
    'build',
    `--source=${sourceArgument}`,
    '--type=heta',
    `--dist-dir=${distArgument}`,
    `--log-path=${logArgument}`,
    '--export=canonical,dynms',
  ];
  const commandResult = await runProcess(
    'heta',
    commandArguments,
    repositoryRoot,
  );
  const canonicalPath = path.join(distDirectory, 'canonical', 'output.heta.json');
  const dynmsPath = path.join(distDirectory, 'dynms', 'output.dynms.json');

  if (await fileExists(logPath)) {
    result.logPath = path.relative(targetDirectory, logPath).split(path.sep).join('/');
  }

  if (commandResult.exitCode === 0 && await fileExists(canonicalPath) && await fileExists(dynmsPath)) {
    result.status = 'success';
    result.outputs = {
      canonical: path.relative(targetDirectory, canonicalPath).split(path.sep).join('/'),
      dynms: path.relative(targetDirectory, dynmsPath).split(path.sep).join('/'),
    };
    return result;
  }

  result.error = {
    message: commandResult.error || 'heta build did not produce the required output files',
    exitCode: commandResult.exitCode,
    stdout: commandResult.stdout,
    ...(commandResult.signal === null ? {} : { signal: commandResult.signal }),
    ...(commandResult.stderr ? { stderr: commandResult.stderr } : {}),
  };
  return result;
}

function findMatchingTags(caseEntry, fieldName, skippedTags) {
  if (!Array.isArray(caseEntry[fieldName]) || !skippedTags.length) {
    return [];
  }

  const skippedTagSet = new Set(skippedTags);
  return [...new Set(caseEntry[fieldName].filter((tag) => skippedTagSet.has(tag)))];
}

function markNotEvaluated(result, notEvaluatedTags) {
  const { componentTags, testTags } = notEvaluatedTags;
  if (!componentTags.length && !testTags.length) {
    return result;
  }

  return {
    ...result,
    // Keep the actual compiler result while excluding this case from evaluation.
    buildStatus: result.status,
    status: 'not-evaluated',
    ...(componentTags.length ? { notEvaluatedComponentTags: componentTags } : {}),
    ...(testTags.length ? { notEvaluatedTestTags: testTags } : {}),
  };
}

async function runWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function runSbmlReport(options, repositoryRoot) {
  if (!options.source || !options.target) {
    throw new Error('--source and --target are required');
  }

  const concurrency = parsePositiveInteger(options.concurrency, '--concurrency', 1);
  const limit = parsePositiveInteger(options.limit, '--limit', undefined);
  const skip = parseNonNegativeInteger(options.skip, '--skip', 0);
  const skipComponentTags = parseCommaSeparatedValues(
    options['skip-component-tags'],
    '--skip-component-tags',
  );
  const skipTestTags = parseCommaSeparatedValues(
    options['skip-test-tags'],
    '--skip-test-tags',
  );
  const inputField = options['input-field'] || 'sbmlL3V2Path';

  if (!supportedInputFields.has(inputField)) {
    throw new Error(`Unsupported --input-field: ${inputField}`);
  }

  const indexPath = await resolveIndexPath(repositoryRoot, options.source);
  const targetDirectory = resolveInsideRepository(repositoryRoot, options.target, '--target');
  const index = JSON.parse(await fsp.readFile(indexPath, 'utf8'));

  if (!Array.isArray(index.cases)) {
    throw new Error(`Invalid case index: ${indexPath}`);
  }

  const cases = index.cases
    .filter((caseEntry) => typeof caseEntry[inputField] === 'string')
    .slice(skip, limit === undefined ? undefined : skip + limit);

  if (cases.some((caseEntry) => !/^[A-Za-z0-9_-]+$/.test(caseEntry.caseId))) {
    throw new Error('Invalid caseId in the index');
  }

  await fsp.rm(targetDirectory, { recursive: true, force: true });
  await fsp.mkdir(targetDirectory, { recursive: true });

  const hetaVersionResult = await runProcess(
    'heta',
    ['--version'],
    repositoryRoot,
  );
  if (hetaVersionResult.exitCode !== 0) {
    throw new Error(hetaVersionResult.error || hetaVersionResult.stderr || 'Unable to determine heta version');
  }

  const startedAt = new Date().toISOString();
  const results = await runWithConcurrency(cases, concurrency, async (caseEntry) => {
    const notEvaluatedTags = {
      componentTags: findMatchingTags(caseEntry, 'componentTags', skipComponentTags),
      testTags: findMatchingTags(caseEntry, 'testTags', skipTestTags),
    };

    try {
      const result = await buildCase(
        caseEntry,
        path.dirname(indexPath),
        targetDirectory,
        repositoryRoot,
        inputField,
        notEvaluatedTags,
      );
      return markNotEvaluated(result, notEvaluatedTags);
    } catch (error) {
      return markNotEvaluated({
        caseId: caseEntry.caseId,
        sourcePath: caseEntry[inputField],
        status: 'failed',
        error: { message: error.message },
      }, notEvaluatedTags);
    }
  });
  const succeeded = results.filter((result) => result.status === 'success').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const notEvaluated = results.filter((result) => result.status === 'not-evaluated').length;
  const report = {
    generator: {
      type: 'sbml-report',
      packageName: packageInfo.name,
      packageVersion: packageInfo.version,
    },
    status: failed > 0
      ? 'completed-with-errors'
      : notEvaluated > 0
        ? 'completed-with-not-evaluated'
        : 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    command: {
      source: path.relative(repositoryRoot, indexPath).split(path.sep).join('/'),
      target: path.relative(repositoryRoot, targetDirectory).split(path.sep).join('/'),
      inputField,
      concurrency,
      ...(skip === 0 ? {} : { skip }),
      ...(limit === undefined ? {} : { limit }),
      ...(skipComponentTags.length ? { skipComponentTags } : {}),
      ...(skipTestTags.length ? { skipTestTags } : {}),
    },
    environment: {
      hetaVersion: hetaVersionResult.stdout.trim(),
    },
    testSuite: index.testSuite,
    cases: results,
  };

  const reportPath = path.join(targetDirectory, 'report.json');
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written to ${reportPath}`);

  return report;
}

module.exports = { runSbmlReport };
