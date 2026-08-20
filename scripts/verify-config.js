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

  await verifyArchiveUrl(settings.archiveUrl);
  console.log('Configuration verification completed successfully.');
}

main().catch((error) => {
  console.error(`verify:config failed: ${error.message}`);
  process.exitCode = 1;
});
