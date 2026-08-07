const fsp = require('node:fs/promises');
const path = require('node:path');
const packageInfo = require('../package.json');

const caseStatuses = ['success', 'failed', 'not-evaluated'];

function resolveInsideRepository(repositoryRoot, inputPath, optionName) {
  const resolvedPath = path.resolve(repositoryRoot, inputPath);
  const relativePath = path.relative(repositoryRoot, resolvedPath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`${optionName} must be a subpath of the repository`);
  }

  return resolvedPath;
}

function resolveReportPath(repositoryRoot, inputPath, optionName) {
  const resolvedPath = resolveInsideRepository(repositoryRoot, inputPath, optionName);
  return path.extname(resolvedPath) === '.json'
    ? resolvedPath
    : path.join(resolvedPath, 'report.json');
}

async function readReport(reportPath, label) {
  let report;
  try {
    report = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} report ${reportPath}: ${error.message}`);
  }

  if (!report || typeof report !== 'object' || !Array.isArray(report.cases)) {
    throw new Error(`${label} report must contain a cases array: ${reportPath}`);
  }

  const caseIds = new Set();
  for (const caseResult of report.cases) {
    if (!caseResult || typeof caseResult !== 'object') {
      throw new Error(`${label} report contains an invalid case record`);
    }
    if (typeof caseResult.caseId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(caseResult.caseId)) {
      throw new Error(`${label} report contains an invalid caseId`);
    }
    if (caseIds.has(caseResult.caseId)) {
      throw new Error(`${label} report contains a duplicate caseId: ${caseResult.caseId}`);
    }
    if (!caseStatuses.includes(caseResult.status)) {
      throw new Error(`${label} report case ${caseResult.caseId} has an invalid status`);
    }
    caseIds.add(caseResult.caseId);
  }

  return { report, caseIds };
}

function relativeRepositoryPath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

async function compareReports(options, repositoryRoot) {
  if (!options.reference || !options.candidate) {
    throw new Error('--reference and --candidate are required');
  }
  if (options['require-compatible'] !== undefined && options['require-compatible'] !== 'true') {
    throw new Error('--require-compatible does not accept a value');
  }

  const requireCompatible = options['require-compatible'] === 'true';
  const referencePath = resolveReportPath(repositoryRoot, options.reference, '--reference');
  const candidatePath = resolveReportPath(repositoryRoot, options.candidate, '--candidate');
  const outputPath = options.output
    ? resolveInsideRepository(repositoryRoot, options.output, '--output')
    : path.join(path.dirname(candidatePath), 'compare.json');
  const [{ report: reference, caseIds: referenceCaseIds }, { report: candidate, caseIds: candidateCaseIds }] = await Promise.all([
    readReport(referencePath, 'Reference'),
    readReport(candidatePath, 'Candidate'),
  ]);

  const candidateOnlyCaseIds = [...candidateCaseIds]
    .filter((caseId) => !referenceCaseIds.has(caseId))
    .sort();
  const commonCaseCount = candidate.cases.length - candidateOnlyCaseIds.length;

  const comparison = {
    generator: {
      type: 'report-comparison',
      packageName: packageInfo.name,
      packageVersion: packageInfo.version,
    },
    generatedAt: new Date().toISOString(),
    reference: {
      reportPath: relativeRepositoryPath(repositoryRoot, referencePath),
    },
    candidate: {
      reportPath: relativeRepositoryPath(repositoryRoot, candidatePath),
    },
    compatibility: {
      candidateIsSubsetOfReference: candidateOnlyCaseIds.length === 0,
      commonCaseCount,
      candidateOnlyCaseIds,
    },
  };

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`);
  console.log(`Comparison status: ${candidateOnlyCaseIds.length ? 'incompatible' : 'compatible'}`);
  console.log(`Comparison written to ${relativeRepositoryPath(repositoryRoot, outputPath)}`);

  if (candidateOnlyCaseIds.length) {
    if (requireCompatible) {
      throw new Error('Comparison is incompatible and --require-compatible was specified');
    }
    return comparison;
  }

  return comparison;
}

module.exports = { compareReports };
