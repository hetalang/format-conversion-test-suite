const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const packageInfo = require('../package.json');

const caseStatuses = ['success', 'failed', 'not-evaluated'];
const artifactNames = new Set(['canonical', 'dynms']);
const maximumStoredDifferences = 1000;

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

function isPathInside(directory, candidatePath) {
  const relativePath = path.relative(directory, candidatePath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isSameOrParentDirectory(directory, filePath) {
  const relativePath = path.relative(directory, filePath);
  return !relativePath || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function parseIgnorePaths(value) {
  if (value === undefined) {
    return [];
  }

  // Git Bash converts arguments beginning with / into paths below its Git directory.
  const restoredValue = process.env.MSYSTEM
    ? value.replace(/^[A-Za-z]:\/.*\/Git(\/.*)$/i, '$1')
    : value;
  const paths = restoredValue.split(',').map((item) => item.trim());
  if (!paths.length || paths.some((item) => !item || !item.startsWith('/'))) {
    throw new Error('--ignore-paths must be a comma-separated list of JSON Pointer paths');
  }

  return [...new Set(paths)];
}

function inspectArtifact(caseResult, artifactName, reportPath) {
  if (!caseResult || caseResult.status !== 'success') {
    return { available: false };
  }

  const artifactPath = caseResult.outputs?.[artifactName];
  if (typeof artifactPath !== 'string' || !artifactPath) {
    return { available: false, reason: 'artifact-path-missing' };
  }

  const artifactFile = path.resolve(path.dirname(reportPath), artifactPath);
  if (!isPathInside(path.dirname(reportPath), artifactFile)) {
    return { available: false, reason: 'artifact-path-outside-report' };
  }

  try {
    if (!fs.statSync(artifactFile).isFile()) {
      return { available: false, reason: 'artifact-file-missing' };
    }
  } catch {
    return { available: false, reason: 'artifact-file-missing' };
  }

  return { available: true, filePath: artifactFile };
}

function createCaseComparison(referenceCase, candidateCase, artifactName, referencePath, candidatePath) {
  const referenceArtifact = inspectArtifact(referenceCase, artifactName, referencePath);
  const candidateArtifact = inspectArtifact(candidateCase, artifactName, candidatePath);
  const issues = [
    ...(referenceArtifact.reason ? [{ report: 'reference', reason: referenceArtifact.reason }] : []),
    ...(candidateArtifact.reason ? [{ report: 'candidate', reason: candidateArtifact.reason }] : []),
  ];

  if (issues.length) {
    return {
      caseId: referenceCase.caseId,
      status: 'error',
      issues,
    };
  }

  return {
    caseId: referenceCase.caseId,
    status: `${referenceArtifact.available ? 'success' : 'failed'}-${candidateArtifact.available ? 'success' : 'failed'}`,
    referenceArtifact,
    candidateArtifact,
  };
}

function escapeJsonPointerSegment(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function compareJsonValues(referenceValue, candidateValue, ignoredPaths) {
  const differences = [];
  let differenceCount = 0;

  const addDifference = (difference) => {
    differenceCount += 1;
    if (differences.length < maximumStoredDifferences) {
      differences.push(difference);
    }
  };

  const compareValue = (referenceItem, candidateItem, pointer) => {
    if (ignoredPaths.has(pointer)) {
      return;
    }

    const referenceIsArray = Array.isArray(referenceItem);
    const candidateIsArray = Array.isArray(candidateItem);
    const referenceIsObject = referenceItem !== null && typeof referenceItem === 'object' && !referenceIsArray;
    const candidateIsObject = candidateItem !== null && typeof candidateItem === 'object' && !candidateIsArray;

    if (referenceIsArray && candidateIsArray) {
      const itemCount = Math.max(referenceItem.length, candidateItem.length);
      for (let index = 0; index < itemCount; index += 1) {
        const itemPointer = `${pointer}/${index}`;
        if (index >= referenceItem.length) {
          addDifference({ path: itemPointer, kind: 'missing-in-reference', candidate: candidateItem[index] });
        } else if (index >= candidateItem.length) {
          addDifference({ path: itemPointer, kind: 'missing-in-candidate', reference: referenceItem[index] });
        } else {
          compareValue(referenceItem[index], candidateItem[index], itemPointer);
        }
      }
      return;
    }

    if (referenceIsObject && candidateIsObject) {
      const keys = [...new Set([...Object.keys(referenceItem), ...Object.keys(candidateItem)])].sort();
      for (const key of keys) {
        const itemPointer = `${pointer}/${escapeJsonPointerSegment(key)}`;
        if (!Object.hasOwn(referenceItem, key)) {
          addDifference({ path: itemPointer, kind: 'missing-in-reference', candidate: candidateItem[key] });
        } else if (!Object.hasOwn(candidateItem, key)) {
          addDifference({ path: itemPointer, kind: 'missing-in-candidate', reference: referenceItem[key] });
        } else {
          compareValue(referenceItem[key], candidateItem[key], itemPointer);
        }
      }
      return;
    }

    if (!Object.is(referenceItem, candidateItem)) {
      addDifference({ path: pointer, kind: 'changed', reference: referenceItem, candidate: candidateItem });
    }
  };

  compareValue(referenceValue, candidateValue, '');
  return {
    differenceCount,
    differences,
    truncated: differenceCount > differences.length,
  };
}

async function compareJsonArtifacts(referenceFilePath, candidateFilePath, ignoredPaths) {
  const readJson = async (filePath, report) => {
    try {
      return { value: JSON.parse(await fsp.readFile(filePath, 'utf8')) };
    } catch (error) {
      return {
        issue: {
          report,
          reason: error instanceof SyntaxError ? 'artifact-json-invalid' : 'artifact-read-failed',
          message: error.message,
        },
      };
    }
  };

  const [referenceResult, candidateResult] = await Promise.all([
    readJson(referenceFilePath, 'reference'),
    readJson(candidateFilePath, 'candidate'),
  ]);
  const issues = [referenceResult.issue, candidateResult.issue].filter(Boolean);
  if (issues.length) {
    return { status: 'error', issues };
  }

  const differences = compareJsonValues(referenceResult.value, candidateResult.value, ignoredPaths);
  return differences.differenceCount
    ? { status: 'different', ...differences }
    : { status: 'equal' };
}

async function compareReports(options, repositoryRoot) {
  if (!options.reference || !options.candidate || !options.target) {
    throw new Error('--reference, --candidate, and --target are required');
  }
  if (!options.artifact || !artifactNames.has(options.artifact)) {
    throw new Error('--artifact must be canonical or dynms');
  }
  if (options['require-compatible'] !== undefined && options['require-compatible'] !== 'true') {
    throw new Error('--require-compatible does not accept a value');
  }

  const requireCompatible = options['require-compatible'] === 'true';
  const artifactName = options.artifact;
  const ignorePaths = parseIgnorePaths(options['ignore-paths']);
  const ignoredPathSet = new Set(ignorePaths);
  const referencePath = resolveReportPath(repositoryRoot, options.reference, '--reference');
  const candidatePath = resolveReportPath(repositoryRoot, options.candidate, '--candidate');
  const targetDirectory = resolveInsideRepository(repositoryRoot, options.target, '--target');
  const outputPath = path.join(targetDirectory, 'compare.json');
  const [{ report: reference, caseIds: referenceCaseIds }, { report: candidate, caseIds: candidateCaseIds }] = await Promise.all([
    readReport(referencePath, 'Reference'),
    readReport(candidatePath, 'Candidate'),
  ]);

  if (
    isSameOrParentDirectory(targetDirectory, referencePath)
    || isSameOrParentDirectory(targetDirectory, candidatePath)
  ) {
    throw new Error('--target must not contain the reference or candidate report');
  }

  const candidateOnlyCaseIds = [...candidateCaseIds]
    .filter((caseId) => !referenceCaseIds.has(caseId))
    .sort();
  const commonCaseCount = candidate.cases.length - candidateOnlyCaseIds.length;
  const candidateCasesById = new Map(candidate.cases.map((caseResult) => [caseResult.caseId, caseResult]));

  const caseComparisons = [];
  const diffsDirectory = path.join(targetDirectory, 'diffs');

  await fsp.rm(targetDirectory, { recursive: true, force: true });
  await fsp.mkdir(targetDirectory, { recursive: true });

  for (const referenceCase of reference.cases) {
    const caseComparison = createCaseComparison(
      referenceCase,
      candidateCasesById.get(referenceCase.caseId),
      artifactName,
      referencePath,
      candidatePath,
    );
    const { referenceArtifact, candidateArtifact, ...caseResult } = caseComparison;

    if (caseResult.status === 'success-success') {
      const artifactComparison = await compareJsonArtifacts(
        referenceArtifact.filePath,
        candidateArtifact.filePath,
        ignoredPathSet,
      );
      if (artifactComparison.status === 'different') {
        await fsp.mkdir(diffsDirectory, { recursive: true });
        const diffPath = path.join(diffsDirectory, `${caseResult.caseId}.json`);
        await fsp.writeFile(diffPath, `${JSON.stringify({
          caseId: caseResult.caseId,
          artifact: artifactName,
          differenceCount: artifactComparison.differenceCount,
          truncated: artifactComparison.truncated,
          differences: artifactComparison.differences,
        }, null, 2)}\n`);
        caseResult.artifactComparison = {
          status: 'different',
          differenceCount: artifactComparison.differenceCount,
          diffPath: path.relative(targetDirectory, diffPath).split(path.sep).join('/'),
        };
      } else {
        caseResult.artifactComparison = artifactComparison;
      }
    }

    caseComparisons.push(caseResult);
  }

  const comparison = {
    generator: {
      type: 'report-comparison',
      packageName: packageInfo.name,
      packageVersion: packageInfo.version,
    },
    generatedAt: new Date().toISOString(),
    artifact: artifactName,
    ...(ignorePaths.length ? { ignorePaths } : {}),
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
    cases: caseComparisons,
  };

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
