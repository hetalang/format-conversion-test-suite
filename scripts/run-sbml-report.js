const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const spawn = require('cross-spawn');

function parsePositiveInteger(value, optionName, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return Number(value);
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

async function buildCase(caseEntry, indexDirectory, targetDirectory, repositoryRoot) {
  const result = {
    caseId: caseEntry.caseId,
    sourcePath: caseEntry.sbmlL3V2Path,
    status: 'failed',
  };
  console.log(`Building case ${caseEntry.caseId}...`);
  const sourcePath = path.resolve(indexDirectory, caseEntry.sbmlL3V2Path);
  const relativeSourcePath = path.relative(indexDirectory, sourcePath);

  if (relativeSourcePath.startsWith('..') || path.isAbsolute(relativeSourcePath)) {
    result.error = { message: 'Source path is outside the index directory' };
    return result;
  }

  const distDirectory = path.join(targetDirectory, caseEntry.caseId);
  const sourceArgument = path.relative(repositoryRoot, sourcePath).split(path.sep).join('/');
  const distArgument = path.relative(repositoryRoot, distDirectory).split(path.sep).join('/');
  const commandArguments = [
    'build',
    `--source=${sourceArgument}`,
    '--type=sbml',
    `--dist-dir=${distArgument}`,
    '--export=canonical,dynms',
  ];
  const commandResult = await runProcess(
    'heta',
    commandArguments,
    repositoryRoot,
  );
  const canonicalPath = path.join(distDirectory, 'canonical', 'output.heta.json');
  const dynmsPath = path.join(distDirectory, 'dynms', 'output.dynms.json');

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
    signal: commandResult.signal,
    stdout: commandResult.stdout,
    stderr: commandResult.stderr,
  };
  return result;
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
  const indexPath = await resolveIndexPath(repositoryRoot, options.source);
  const targetDirectory = resolveInsideRepository(repositoryRoot, options.target, '--target');
  const index = JSON.parse(await fsp.readFile(indexPath, 'utf8'));

  if (!Array.isArray(index.cases)) {
    throw new Error(`Invalid case index: ${indexPath}`);
  }

  const cases = index.cases
    .filter((caseEntry) => typeof caseEntry.sbmlL3V2Path === 'string')
    .slice(0, limit);

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
  const startedAtMs = Date.now();
  const results = await runWithConcurrency(cases, concurrency, async (caseEntry) => {
    try {
      return await buildCase(caseEntry, path.dirname(indexPath), targetDirectory, repositoryRoot);
    } catch (error) {
      return {
        caseId: caseEntry.caseId,
        sourcePath: caseEntry.sbmlL3V2Path,
        status: 'failed',
        error: { message: error.message },
      };
    }
  });
  const succeeded = results.filter((result) => result.status === 'success').length;
  const report = {
    schemaVersion: 1,
    status: succeeded === results.length ? 'success' : 'completed-with-errors',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    command: {
      source: path.relative(repositoryRoot, indexPath).split(path.sep).join('/'),
      target: path.relative(repositoryRoot, targetDirectory).split(path.sep).join('/'),
      concurrency,
      ...(limit === undefined ? {} : { limit }),
    },
    environment: {
      hetaVersion: hetaVersionResult.stdout.trim(),
      nodeVersion: process.version,
      operatingSystem: `${os.type()} ${os.release()}`,
    },
    testSuite: index.testSuite,
    summary: {
      requested: cases.length,
      succeeded,
      failed: results.length - succeeded,
    },
    cases: results,
  };

  const reportPath = path.join(targetDirectory, 'report.json');
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written to ${reportPath}`);

  return report;
}

module.exports = { runSbmlReport };
