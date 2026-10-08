const fs = require('node:fs/promises');
const path = require('node:path');
const spawn = require('cross-spawn');
const packageInfo = require('../package.json');
const common = require('./run-sbml-report');
const defaultInputField = 'sbmlL2V5Path';
const supportedInputFields = new Set(['sbmlL2V5Path', 'sbmlL3V1Path', 'sbmlL3V2Path']);
const timeTolerance = 1e-6;
const relative = (from, target) => path.relative(from, target).split(path.sep).join('/');

function readCsv(text, label) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error(`${label} must contain a header and data`);
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(',');
    if (cells.length !== headers.length) throw new Error(`${label} row ${rowIndex + 2} has an invalid column count`);
    return cells.map((cell, columnIndex) => {
      const valueText = cell.trim();
      if (/^\+?inf(inity)?$/i.test(valueText)) return Infinity;
      if (/^-inf(inity)?$/i.test(valueText)) return -Infinity;
      if (/^nan$/i.test(valueText)) return NaN;
      const value = Number(valueText);
      if (!Number.isFinite(value)) throw new Error(`${label} row ${rowIndex + 2}, column ${columnIndex + 1} is not numeric`);
      return value;
    });
  });
  return { headers, rows };
}

function compare(reference, actual, settings) {
  if (reference.rows.length !== actual.rows.length) return { status: 'failed', error: { message: `Simulation produced ${actual.rows.length} rows; expected ${reference.rows.length}` } };
  if (reference.headers.length !== settings.variables.length + 1 || actual.headers.length !== settings.variables.length + 1) return { status: 'failed', error: { message: 'Simulation CSV columns do not match indexed simulation variables' } };
  let comparedValues = 0; let maxAbsoluteError = 0; const failures = [];
  for (let rowIndex = 0; rowIndex < reference.rows.length; rowIndex += 1) {
    const expectedRow = reference.rows[rowIndex]; const actualRow = actual.rows[rowIndex];
    if (Math.abs(expectedRow[0] - actualRow[0]) > timeTolerance && failures.length < 20) failures.push({ row: rowIndex + 1, variable: 'time', expected: expectedRow[0], actual: actualRow[0] });
    for (let variableIndex = 0; variableIndex < settings.variables.length; variableIndex += 1) {
      const expected = expectedRow[variableIndex + 1]; const observed = actualRow[variableIndex + 1]; const absoluteError = Math.abs(observed - expected); const tolerance = settings.absoluteTolerance + settings.relativeTolerance * Math.abs(expected);
      comparedValues += 1;
      if (!Number.isFinite(expected) || !Number.isFinite(observed)) {
        const matches = Number.isNaN(expected) ? Number.isNaN(observed) : expected === observed;
        if (!matches && failures.length < 20) failures.push({ row: rowIndex + 1, time: expectedRow[0], variable: settings.variables[variableIndex], expected, actual: observed, absoluteError, tolerance });
        continue;
      }
      maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
      if (absoluteError > tolerance && failures.length < 20) failures.push({ row: rowIndex + 1, time: expectedRow[0], variable: settings.variables[variableIndex], expected, actual: observed, absoluteError, tolerance });
    }
  }
  return failures.length ? { status: 'failed', comparedValues, maxAbsoluteError, failures } : { status: 'valid', comparedValues, maxAbsoluteError };
}

async function readEnvironment(root) {
  const version = await common.runProcess('julia', ['-e', 'using HetaSimulator; print(Base.pkgversion(HetaSimulator))'], root);
  if (version.exitCode !== 0 || !version.stdout.trim()) throw new Error(version.error || version.stderr || 'Unable to determine the installed HetaSimulator.jl version');
  return { hetaSimulatorVersion: version.stdout.trim() };
}

async function prepareCase(entry, indexDirectory, target, inputField, tags) {
  const result = { caseId: entry.caseId, synopsis: entry.synopsis || '', sourcePath: entry[inputField], status: 'failed' };
  if (!entry.simulation?.timeCourse) { result.error = { message: 'Case has no time-course simulation settings' }; return { result }; }
  const source = path.resolve(indexDirectory, entry[inputField]);
  if (path.relative(indexDirectory, source).startsWith('..')) { result.error = { message: 'Source path is outside the index directory' }; return { result }; }
  const directory = path.join(target, entry.caseId); const heta = path.join(directory, 'input.heta'); const settingsPath = path.join(directory, 'simulation-input.json'); const outputPath = path.join(directory, 'simulation.csv');
  const speciesOutputs = entry.simulation.speciesOutputsByInputField?.[inputField];
  if (!speciesOutputs) { result.error = { message: `Case index has no species output metadata for ${inputField}; rerun npm run index:sbml` }; return { result }; }
  await fs.mkdir(directory, { recursive: true });
  const settings = { ...entry.simulation, speciesOutputs }; delete settings.speciesOutputsByInputField;
  await Promise.all([fs.writeFile(heta, common.createBuildSource(source, directory, inputField)), fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)]);
  result.buildSourcePath = relative(target, heta); result.simulationInputPath = relative(target, settingsPath);
  const referencePath = path.resolve(indexDirectory, settings.referenceResultsPath);
  return { result, settings, outputPath, referencePath, job: { caseId: entry.caseId, projectDirectory: directory, sourceFile: 'input.heta', outputPath, settingsPath, referencePath, plotDirectory: directory, plotPrefix: 'plot' } };
}

function runJuliaBatch(argumentsList, cwd) {
  return new Promise((resolve) => {
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    let child;
    try {
      child = spawn('julia', argumentsList, { cwd, shell: false, windowsHide: true });
    } catch (error) {
      finish({ exitCode: null, signal: null, stdout, stderr, error: error.message });
      return;
    }
    child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish({ exitCode: null, signal: null, stdout, stderr, error: error.message }));
    child.once('close', (exitCode, signal) => finish({ exitCode, signal, stdout, stderr, error: null }));
  });
}

async function runBatch(jobs, target, root) {
  if (!jobs.length) return { outcomes: new Map() };
  const inputPath = path.join(target, '.hetasimulator-batch-input.json'); const resultPath = path.join(target, '.hetasimulator-batch-result.json');
  await fs.writeFile(inputPath, `${JSON.stringify({ cases: jobs }, null, 2)}\n`);
  let batch;
  let parsed;
  try {
    batch = await runJuliaBatch([path.join(root, 'scripts', 'run-hetasimulator-simulation.jl'), inputPath, resultPath], root);
    if (await common.fileExists(resultPath)) parsed = JSON.parse(await fs.readFile(resultPath, 'utf8'));
  } finally {
    await Promise.all([fs.rm(inputPath, { force: true }), fs.rm(resultPath, { force: true })]);
  }
  const outcomes = new Map();
  if (Array.isArray(parsed?.cases)) for (const outcome of parsed.cases) if (typeof outcome?.caseId === 'string') outcomes.set(outcome.caseId, outcome);
  return { batch, outcomes };
}

async function finishCase(prepared, batchResult, target) {
  const { result, settings, outputPath, referencePath, job } = prepared;
  if (!prepared.job) return result;
  const outcome = batchResult.outcomes.get(result.caseId);
  if (outcome?.status !== 'success' || !(await common.fileExists(outputPath))) {
    result.error = {
      phase: 'heta-load-simulation',
      message: outcome?.message || batchResult.batch?.error || 'HetaSimulator batch simulation did not produce output',
      ...(batchResult.batch ? { exitCode: batchResult.batch.exitCode } : {}),
      ...(batchResult.batch?.exitCode && batchResult.batch.stdout ? { stdout: batchResult.batch.stdout } : {}),
      ...(batchResult.batch?.exitCode && batchResult.batch.stderr ? { stderr: batchResult.batch.stderr } : {}),
    };
    return result;
  }
  try {
    result.outputs = { simulation: relative(target, outputPath) };
    result.comparison = compare(readCsv(await fs.readFile(referencePath, 'utf8'), settings.referenceResultsPath), readCsv(await fs.readFile(outputPath, 'utf8'), result.outputs.simulation), settings);
    const plotPaths = settings.variables.map((_, index) => path.join(job.plotDirectory, `plot-${String(index + 1).padStart(3, '0')}.png`)); const plotExists = await Promise.all(plotPaths.map((plotPath) => common.fileExists(plotPath)));
    result.simulationPlotPaths = plotPaths.filter((_, index) => plotExists[index]).map((plotPath) => relative(target, plotPath)); if (!result.simulationPlotPaths.length) delete result.simulationPlotPaths;
  } catch (error) { result.error = { phase: 'comparison', message: error.message }; return result; }
  if (result.comparison.status === 'valid') result.status = 'success'; else result.error = { phase: 'comparison', message: 'Simulation results exceed the Semantic Test Suite tolerances' };
  return result;
}

async function runSbmlHetaSimulatorSimulation(options, root) {
  if (!options.source || !options.target) throw new Error('--source and --target are required');
  const inputField = options['input-field'] || defaultInputField; if (!supportedInputFields.has(inputField)) throw new Error(`Unsupported --input-field: ${inputField}`);
  const concurrency = common.parsePositiveInteger(options.concurrency, '--concurrency', 1); const limit = common.parsePositiveInteger(options.limit, '--limit', undefined); const skip = common.parseNonNegativeInteger(options.skip, '--skip', 0); const skippedComponentTags = common.parseCommaSeparatedValues(options['skip-component-tags'], '--skip-component-tags'); const skippedTestTags = common.parseCommaSeparatedValues(options['skip-test-tags'], '--skip-test-tags');
  const [indexPath, hetaSimulatorEnvironment] = await Promise.all([common.resolveIndexPath(root, options.source), readEnvironment(root)]); const target = common.resolveInsideRepository(root, options.target, '--target'); const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  if (!Array.isArray(index.cases)) throw new Error(`Invalid case index: ${indexPath}`);
  const cases = index.cases.filter((entry) => typeof entry[inputField] === 'string').slice(skip, limit === undefined ? undefined : skip + limit);
  await fs.rm(target, { recursive: true, force: true }); await fs.mkdir(target, { recursive: true });
  const startedAt = new Date().toISOString();
  const preparedCases = await common.runWithConcurrency(cases, concurrency, async (entry) => {
    const tags = { componentTags: common.findMatchingTags(entry, 'componentTags', skippedComponentTags), testTags: common.findMatchingTags(entry, 'testTags', skippedTestTags) };
    try { return { tags, prepared: await prepareCase(entry, path.dirname(indexPath), target, inputField, tags) }; }
    catch (error) { return { tags, prepared: { result: { caseId: entry.caseId, status: 'failed', error: { message: error.message } } } }; }
  });
  const batchResult = await runBatch(preparedCases.filter(({ prepared }) => prepared.job).map(({ prepared }) => prepared.job), target, root);
  const casesResult = await Promise.all(preparedCases.map(async ({ tags, prepared }) => common.markNotEvaluated(await finishCase(prepared, batchResult, target), tags)));
  const succeeded = casesResult.filter((entry) => entry.status === 'success').length; const failed = casesResult.filter((entry) => entry.status === 'failed').length; const assessed = succeeded + failed;
  const report = { description: 'This report records SBML conversion through heta-compiler, HetaSimulator.jl simulation, and comparison with SBML Semantic Test Suite reference results.', generator: { type: 'sbml-hetasimulator-simulation', packageName: packageInfo.name, packageVersion: packageInfo.version }, status: failed ? 'completed-with-errors' : 'success', startedAt, completedAt: new Date().toISOString(), command: { source: relative(root, indexPath), target: relative(root, target), inputField, concurrency, ...(skip ? { skip } : {}), ...(limit === undefined ? {} : { limit }), ...(skippedComponentTags.length ? { skipComponentTags: skippedComponentTags } : {}), ...(skippedTestTags.length ? { skipTestTags: skippedTestTags } : {}) }, environment: { ...hetaSimulatorEnvironment, testSuite: index.testSuite, simulationBackend: 'HetaSimulator.jl' }, cases: casesResult };
  await fs.writeFile(path.join(target, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); const ratio = assessed ? succeeded / assessed : 0; await fs.writeFile(path.join(target, 'badge.json'), `${JSON.stringify({ schemaVersion: 1, label: report.generator.type, message: `${succeeded}/${assessed}`, color: assessed && ratio === 1 ? 'brightgreen' : ratio > 0.8 ? 'yellow' : 'red', ...(failed ? { isError: true } : {}), cacheSeconds: 300 }, null, 2)}\n`);
  console.log(`Report written to ${path.join(target, 'report.json')}`); return report;
}

module.exports = { runSbmlHetaSimulatorSimulation };
