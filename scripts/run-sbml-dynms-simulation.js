const fs = require('node:fs/promises');
const path = require('node:path');
const packageInfo = require('../package.json');
const common = require('./run-sbml-report');

const defaultInputField = 'sbmlL2V5Path';
const supportedInputFields = new Set(['sbmlL2V5Path', 'sbmlL3V1Path', 'sbmlL3V2Path']);
const timeTolerance = 1e-6;
const relative = (from, target) => path.relative(from, target).split(path.sep).join('/');

function csv(text, label) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error(`${label} must contain a header and data`);
  const headers = lines[0].split(',').map((header) => /^time$/i.test(header) ? 'time' : header);
  return { headers, rows: lines.slice(1).map((line, row) => {
    const cells = line.split(',');
    if (cells.length !== headers.length) throw new Error(`${label} row ${row + 2} has an invalid column count`);
    return Object.fromEntries(headers.map((header, index) => {
      const value = Number(cells[index]);
      if (!Number.isFinite(value)) throw new Error(`${label} row ${row + 2}, ${header} is not finite`);
      return [header, value];
    }));
  }) };
}

function compare(reference, actual, settings) {
  const variables = ['time', ...settings.variables];
  const missing = variables.filter((key) => !reference.headers.includes(key) || !actual.headers.includes(key));
  if (missing.length) return { status: 'failed', error: { message: `Missing comparison columns: ${missing.join(', ')}` } };
  if (reference.rows.length !== actual.rows.length) return { status: 'failed', error: { message: `Simulation produced ${actual.rows.length} rows; expected ${reference.rows.length}` } };
  let comparedValues = 0; let maxAbsoluteError = 0; const failures = [];
  for (let i = 0; i < reference.rows.length; i += 1) {
    if (Math.abs(reference.rows[i].time - actual.rows[i].time) > timeTolerance) failures.push({ row: i + 1, variable: 'time', expected: reference.rows[i].time, actual: actual.rows[i].time });
    for (const variable of settings.variables) {
      const expected = reference.rows[i][variable]; const observed = actual.rows[i][variable];
      const absoluteError = Math.abs(observed - expected); const tolerance = settings.absoluteTolerance + settings.relativeTolerance * Math.abs(expected);
      comparedValues += 1; maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
      if (absoluteError > tolerance && failures.length < 20) failures.push({ row: i + 1, time: reference.rows[i].time, variable, expected, actual: observed, absoluteError, tolerance });
    }
  }
  return failures.length ? { status: 'failed', comparedValues, maxAbsoluteError, failures } : { status: 'valid', comparedValues, maxAbsoluteError };
}

async function readDynmsEnvironment(repositoryRoot) {
  const expression = [
    'if (!requireNamespace("DynMSR", quietly = TRUE)) stop("Package DynMSR is not installed.")',
    'description <- utils::packageDescription("DynMSR")',
    'schemaPath <- system.file("schema", "dynms.schema.json", package = "DynMSR")',
    'if (!nzchar(schemaPath)) stop("DynMSR does not provide a DynMS schema.")',
    'schema <- jsonlite::fromJSON(schemaPath, simplifyVector = FALSE)',
    'version <- schema$properties$dynms$const',
    'if (!is.character(version) || length(version) != 1L || !nzchar(version)) stop("DynMSR schema does not declare a DynMS version.")',
    'cat(jsonlite::toJSON(list(dynmsrVersion = description$Version, dynmsVersion = version), auto_unbox = TRUE))',
  ].join('; ');
  const result = await common.runProcess('Rscript', ['--vanilla', '-e', expression], repositoryRoot);
  if (result.exitCode !== 0) {
    throw new Error(result.error || result.stderr || 'Unable to verify the installed DynMSR package');
  }
  try {
    const environment = JSON.parse(result.stdout);
    if (typeof environment.dynmsrVersion !== 'string' || typeof environment.dynmsVersion !== 'string') throw new Error('invalid version data');
    return environment;
  } catch (error) {
    throw new Error(`Unable to read DynMSR version information: ${error.message}`);
  }
}

async function runCase(entry, indexDirectory, target, root, selectedInputField, tags) {
  const result = { caseId: entry.caseId, synopsis: entry.synopsis || '', sourcePath: entry[selectedInputField], status: 'failed' };
  console.log(`Simulating case ${entry.caseId}${common.formatNotEvaluatedTags(tags) ? ` (not evaluated: ${common.formatNotEvaluatedTags(tags)})` : ''}...`);
  if (!entry.simulation?.timeCourse) { result.error = { message: 'Case has no time-course simulation settings' }; return result; }
  const source = path.resolve(indexDirectory, entry[selectedInputField]);
  if (path.relative(indexDirectory, source).startsWith('..')) { result.error = { message: 'Source path is outside the index directory' }; return result; }
  const directory = path.join(target, entry.caseId); const heta = path.join(directory, 'input.heta'); const log = path.join(directory, 'build.log');
  const settings = path.join(directory, 'simulation-input.json'); const output = path.join(directory, 'simulation.csv'); const plotDirectory = directory;
  const speciesOutputs = entry.simulation.speciesOutputsByInputField?.[selectedInputField];
  if (!speciesOutputs) { result.error = { message: `Case index has no species output metadata for ${selectedInputField}; rerun npm run index:sbml` }; return result; }
  await fs.mkdir(directory, { recursive: true });
  const simulation = { ...entry.simulation, speciesOutputs };
  delete simulation.speciesOutputsByInputField;
  await Promise.all([fs.writeFile(heta, common.createBuildSource(source, directory, selectedInputField)), fs.writeFile(settings, `${JSON.stringify(simulation, null, 2)}\n`)]);
  result.buildSourcePath = relative(target, heta); result.simulationInputPath = relative(target, settings);
  const referencePath = path.resolve(indexDirectory, entry.simulation.referenceResultsPath);
  const simulated = await common.runProcess('Rscript', ['--vanilla', path.join(root, 'scripts', 'run-dynms-simulation.R'), directory, 'input.heta', output, settings, log, referencePath, plotDirectory], root);
  if (await common.fileExists(log)) result.logPath = relative(target, log);
  if (simulated.exitCode !== 0 || !(await common.fileExists(output))) { result.error = { phase: 'heta-load-simulation', message: simulated.error || 'DynMSR heta_load simulation did not produce output', exitCode: simulated.exitCode, stdout: simulated.stdout, ...(simulated.stderr ? { stderr: simulated.stderr } : {}) }; return result; }
  result.outputs = { simulation: relative(target, output) };
  const plotPaths = entry.simulation.variables.map((_, index) => path.join(plotDirectory, `plot-${String(index + 1).padStart(3, '0')}.png`));
  const plotExists = await Promise.all(plotPaths.map((plotPath) => common.fileExists(plotPath)));
  result.simulationPlotPaths = plotPaths
    .filter((_, index) => plotExists[index])
    .map((plotPath) => relative(target, plotPath));
  if (!result.simulationPlotPaths.length) {
    delete result.simulationPlotPaths;
  }
  try {
    const [referenceText, outputText] = await Promise.all([fs.readFile(referencePath, 'utf8'), fs.readFile(output, 'utf8')]);
    result.comparison = compare(csv(referenceText, entry.simulation.referenceResultsPath), csv(outputText, result.outputs.simulation), entry.simulation);
  } catch (error) { result.error = { phase: 'comparison', message: error.message }; return result; }
  if (result.comparison.status === 'valid') result.status = 'success';
  else { result.error = { phase: 'comparison', message: 'Simulation results exceed the Semantic Test Suite tolerances' }; }
  return result;
}

async function runSbmlDynmsSimulation(options, root) {
  if (!options.source || !options.target) throw new Error('--source and --target are required');
  const inputField = options['input-field'] || defaultInputField;
  if (!supportedInputFields.has(inputField)) throw new Error(`Unsupported --input-field: ${inputField}`);
  const concurrency = common.parsePositiveInteger(options.concurrency, '--concurrency', 1); const limit = common.parsePositiveInteger(options.limit, '--limit', undefined); const skip = common.parseNonNegativeInteger(options.skip, '--skip', 0);
  const skippedComponentTags = common.parseCommaSeparatedValues(options['skip-component-tags'], '--skip-component-tags'); const skippedTestTags = common.parseCommaSeparatedValues(options['skip-test-tags'], '--skip-test-tags');
  const [indexPath, dynmsEnvironment] = await Promise.all([common.resolveIndexPath(root, options.source), readDynmsEnvironment(root)]);
  const target = common.resolveInsideRepository(root, options.target, '--target'); const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  if (!Array.isArray(index.cases)) throw new Error(`Invalid case index: ${indexPath}`);
  const cases = index.cases.filter((entry) => typeof entry[inputField] === 'string').slice(skip, limit === undefined ? undefined : skip + limit);
  await fs.rm(target, { recursive: true, force: true }); await fs.mkdir(target, { recursive: true });
  const hetaVersion = await common.runProcess('heta', ['--version'], root); if (hetaVersion.exitCode !== 0) throw new Error('Unable to determine heta version');
  const startedAt = new Date().toISOString();
  const casesResult = await common.runWithConcurrency(cases, concurrency, async (entry) => {
    const tags = { componentTags: common.findMatchingTags(entry, 'componentTags', skippedComponentTags), testTags: common.findMatchingTags(entry, 'testTags', skippedTestTags) };
    try { return common.markNotEvaluated(await runCase(entry, path.dirname(indexPath), target, root, inputField, tags), tags); }
    catch (error) { return common.markNotEvaluated({ caseId: entry.caseId, status: 'failed', error: { message: error.message } }, tags); }
  });
  const succeeded = casesResult.filter((entry) => entry.status === 'success').length; const failed = casesResult.filter((entry) => entry.status === 'failed').length; const assessed = succeeded + failed;
  const report = { description: 'This report records SBML conversion through heta-compiler, DynMSR/mrgsolve simulation, and comparison with SBML Semantic Test Suite reference results.', generator: { type: 'sbml-dynms-simulation', packageName: packageInfo.name, packageVersion: packageInfo.version }, status: failed ? 'completed-with-errors' : 'success', startedAt, completedAt: new Date().toISOString(), command: { source: relative(root, indexPath), target: relative(root, target), inputField, concurrency, ...(skip ? { skip } : {}), ...(limit === undefined ? {} : { limit }), ...(skippedComponentTags.length ? { skipComponentTags: skippedComponentTags } : {}), ...(skippedTestTags.length ? { skipTestTags: skippedTestTags } : {}) }, environment: { hetaVersion: hetaVersion.stdout.trim(), ...dynmsEnvironment, testSuite: index.testSuite, simulationBackend: 'DynMSR/mrgsolve' }, cases: casesResult };
  await fs.writeFile(path.join(target, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const ratio = assessed ? succeeded / assessed : 0; await fs.writeFile(path.join(target, 'badge.json'), `${JSON.stringify({ schemaVersion: 1, label: report.generator.type, message: `${succeeded}/${assessed}`, color: assessed && ratio === 1 ? 'brightgreen' : ratio > 0.8 ? 'yellow' : 'red', ...(failed ? { isError: true } : {}), cacheSeconds: 300 }, null, 2)}\n`);
  console.log(`Report written to ${path.join(target, 'report.json')}`); return report;
}
module.exports = { runSbmlDynmsSimulation };
