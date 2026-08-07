const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const packageInfo = require('../package.json');

const caseStatuses = ['success', 'failed', 'not-evaluated'];
const artifactNames = ['canonical', 'dynms'];

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

function countStatuses(cases) {
  const counts = Object.fromEntries(caseStatuses.map((status) => [status, 0]));
  for (const caseResult of cases) {
    counts[caseResult.status] += 1;
  }
  return counts;
}

function isPathInside(directory, candidatePath) {
  const relativePath = path.relative(directory, candidatePath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function collectArtifactStatistics(report, reportPath) {
  const reportDirectory = path.dirname(reportPath);

  return Object.fromEntries(artifactNames.map((artifactName) => {
    const statistics = { paths: 0, files: 0, missing: 0, invalidPaths: 0 };

    for (const caseResult of report.cases) {
      const artifactPath = caseResult.outputs?.[artifactName];
      if (typeof artifactPath !== 'string' || !artifactPath) {
        continue;
      }

      statistics.paths += 1;
      const artifactFile = path.resolve(reportDirectory, artifactPath);
      if (!isPathInside(reportDirectory, artifactFile)) {
        statistics.invalidPaths += 1;
      } else if (fs.existsSync(artifactFile)) {
        statistics.files += 1;
      } else {
        statistics.missing += 1;
      }
    }

    return [artifactName, statistics];
  }));
}

function printReportStatistics(label, report, reportPath) {
  const statistics = collectReportStatistics(report, reportPath);
  console.log(`${label} report: ${path.relative(process.cwd(), reportPath)}`);
  console.log(`  Cases: ${statistics.caseCount}`);
  console.log(`  Statuses: success ${statistics.statuses.success}, failed ${statistics.statuses.failed}, not-evaluated ${statistics.statuses['not-evaluated']}`);
  for (const artifactName of artifactNames) {
    const artifactStatistics = statistics.artifacts[artifactName];
    console.log(`  ${artifactName}: paths ${artifactStatistics.paths}, files ${artifactStatistics.files}, missing ${artifactStatistics.missing}, invalid paths ${artifactStatistics.invalidPaths}`);
  }

  return statistics;
}

function collectReportStatistics(report, reportPath) {
  return {
    caseCount: report.cases.length,
    statuses: countStatuses(report.cases),
    artifacts: collectArtifactStatistics(report, reportPath),
  };
}

function relativeRepositoryPath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

async function compareReports(options, repositoryRoot) {
  if (!options.reference || !options.candidate) {
    throw new Error('--reference and --candidate are required');
  }

  const referencePath = resolveReportPath(repositoryRoot, options.reference, '--reference');
  const candidatePath = resolveReportPath(repositoryRoot, options.candidate, '--candidate');
  const outputPath = options.output
    ? resolveInsideRepository(repositoryRoot, options.output, '--output')
    : path.join(path.dirname(candidatePath), 'compare.json');
  const [{ report: reference, caseIds: referenceCaseIds }, { report: candidate, caseIds: candidateCaseIds }] = await Promise.all([
    readReport(referencePath, 'Reference'),
    readReport(candidatePath, 'Candidate'),
  ]);

  const referenceStatistics = printReportStatistics('Reference', reference, referencePath);
  const candidateStatistics = printReportStatistics('Candidate', candidate, candidatePath);

  const candidateOnlyCaseIds = [...candidateCaseIds]
    .filter((caseId) => !referenceCaseIds.has(caseId))
    .sort();
  const commonCaseCount = candidate.cases.length - candidateOnlyCaseIds.length;
  console.log(`Common cases: ${commonCaseCount}`);

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
      referenceOnlyCaseCount: reference.cases.length - commonCaseCount,
    },
    statistics: {
      reference: referenceStatistics,
      candidate: candidateStatistics,
    },
  };

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`);
  console.log(`Comparison written to ${relativeRepositoryPath(repositoryRoot, outputPath)}`);

  if (candidateOnlyCaseIds.length) {
    const preview = candidateOnlyCaseIds.slice(0, 20).join(', ');
    const suffix = candidateOnlyCaseIds.length > 20 ? ', ...' : '';
    console.log(`Reports are not compatible: candidate is wider than reference by ${candidateOnlyCaseIds.length} case IDs (${preview}${suffix})`);
    return comparison;
  }

  console.log('Reports are compatible: every candidate case is present in the reference.');
  console.log('Per-case artifact comparison will be added in a later stage.');
  return comparison;
}

module.exports = { compareReports };
