const fs = require('node:fs/promises');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const optionsPath = path.join(repositoryRoot, 'config', 'options.json');

function fail(message) {
  throw new Error(message);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function resolveInside(directory, relativePath, label) {
  const value = requireString(relativePath, label);
  const resolvedPath = path.resolve(directory, value);
  const relative = path.relative(directory, resolvedPath);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} must be a subpath of ${directory}`);
  }

  return resolvedPath;
}

async function requireFile(filePath, label) {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    fail(`${label} does not exist: ${filePath}`);
  }

  if (!stats.isFile()) {
    fail(`${label} is not a file: ${filePath}`);
  }
}

function parseArchiveUrl(archiveUrl) {
  let url;
  try {
    url = new URL(archiveUrl);
  } catch {
    fail('sbmlSemanticTestSuite.archiveUrl must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    fail('sbmlSemanticTestSuite.archiveUrl must use HTTPS');
  }

  return url;
}

async function requestArchive(url, options) {
  const response = await fetch(url, {
    ...options,
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });

  if (response.body) {
    await response.body.cancel();
  }

  return response;
}

async function verifyArchiveUrl(archiveUrl) {
  const url = parseArchiveUrl(archiveUrl);
  let response = await requestArchive(url, { method: 'HEAD' });

  if (response.status === 405 || response.status === 501) {
    response = await requestArchive(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
  }

  if (!response.ok) {
    fail(`Archive URL is not available: HTTP ${response.status}`);
  }

  const finalUrl = new URL(response.url);
  console.log(`Archive URL is available: ${finalUrl.origin}${finalUrl.pathname}`);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  return value;
}

async function verifyReference(reference, settings) {
  const id = requireString(reference.id, 'reference.id');
  if (reference.type !== 'sbmlSemanticTestSuite') {
    fail(`Reference ${id} has an unsupported type: ${reference.type}`);
  }

  const inputField = requireString(reference.inputField, `Reference ${id}.inputField`);
  const exportsList = requireArray(reference.exports, `Reference ${id}.exports`);
  if (!exportsList.length || exportsList.some((item) => typeof item !== 'string' || !item)) {
    fail(`Reference ${id}.exports must contain non-empty strings`);
  }
  if (new Set(exportsList).size !== exportsList.length) {
    fail(`Reference ${id}.exports contains duplicate values`);
  }

  const targetDirectory = resolveInside(repositoryRoot, reference.targetDir, `Reference ${id}.targetDir`);
  const reportPath = path.join(targetDirectory, 'report.json');
  await requireFile(reportPath, `Reference ${id} report`);

  let report;
  try {
    report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  } catch (error) {
    fail(`Reference ${id} report is not valid JSON: ${error.message}`);
  }

  if (report.testSuite?.version !== settings.version) {
    fail(`Reference ${id} uses an unexpected test-suite version`);
  }
  if (report.testSuite?.archiveSha256 !== settings.archiveSha256) {
    fail(`Reference ${id} uses an unexpected test-suite checksum`);
  }
  if (report.command?.inputField !== inputField || report.input?.field !== inputField) {
    fail(`Reference ${id} does not match inputField ${inputField}`);
  }
  if (report.command?.target !== reference.targetDir.split(path.sep).join('/')) {
    fail(`Reference ${id} report target does not match its configured targetDir`);
  }

  const cases = requireArray(report.cases, `Reference ${id}.cases`);
  const caseIds = new Set();
  for (const caseResult of cases) {
    if (!caseResult || typeof caseResult !== 'object') {
      fail(`Reference ${id} contains an invalid case record`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(caseResult.caseId)) {
      fail(`Reference ${id} contains an invalid caseId`);
    }
    if (caseIds.has(caseResult.caseId)) {
      fail(`Reference ${id} contains a duplicate caseId: ${caseResult.caseId}`);
    }
    caseIds.add(caseResult.caseId);

    if (!['success', 'failed', 'not-evaluated'].includes(caseResult.status)) {
      fail(`Reference ${id} case ${caseResult.caseId} has an invalid status`);
    }

    if (caseResult.status !== 'success') {
      continue;
    }

    if (!caseResult.outputs || typeof caseResult.outputs !== 'object') {
      fail(`Reference ${id} case ${caseResult.caseId} has no outputs`);
    }

    for (const exportName of exportsList) {
      const artifactPath = caseResult.outputs[exportName];
      const artifactFile = resolveInside(
        targetDirectory,
        artifactPath,
        `Reference ${id} case ${caseResult.caseId} ${exportName} artifact`,
      );
      await requireFile(artifactFile, `Reference ${id} case ${caseResult.caseId} ${exportName} artifact`);
    }
  }

  console.log(`Reference ${id} is valid (${cases.length} cases).`);
}

async function main() {
  let options;
  try {
    options = JSON.parse(await fs.readFile(optionsPath, 'utf8'));
  } catch (error) {
    fail(`Unable to read ${optionsPath}: ${error.message}`);
  }

  const settings = options.sbmlSemanticTestSuite;
  if (!settings || typeof settings !== 'object') {
    fail('sbmlSemanticTestSuite configuration is required');
  }

  requireString(settings.version, 'sbmlSemanticTestSuite.version');
  requireString(settings.targetDir, 'sbmlSemanticTestSuite.targetDir');
  resolveInside(repositoryRoot, settings.targetDir, 'sbmlSemanticTestSuite.targetDir');
  parseArchiveUrl(requireString(settings.archiveUrl, 'sbmlSemanticTestSuite.archiveUrl'));
  if (!/^[a-f0-9]{64}$/.test(settings.archiveSha256)) {
    fail('sbmlSemanticTestSuite.archiveSha256 must be a lowercase SHA-256 digest');
  }

  const references = requireArray(options.references, 'references');
  if (!references.length) {
    fail('references must not be empty');
  }
  const referenceIds = new Set();
  const targetDirectories = new Set();
  for (const reference of references) {
    const id = requireString(reference?.id, 'reference.id');
    if (referenceIds.has(id)) {
      fail(`references contains a duplicate id: ${id}`);
    }
    referenceIds.add(id);

    const targetDir = requireString(reference.targetDir, `Reference ${id}.targetDir`);
    if (targetDirectories.has(targetDir)) {
      fail(`references contains a duplicate targetDir: ${targetDir}`);
    }
    targetDirectories.add(targetDir);
  }

  await verifyArchiveUrl(settings.archiveUrl);
  for (const reference of references) {
    await verifyReference(reference, settings);
  }
  console.log('Configuration verification completed successfully.');
}

main().catch((error) => {
  console.error(`verify:config failed: ${error.message}`);
  process.exitCode = 1;
});
