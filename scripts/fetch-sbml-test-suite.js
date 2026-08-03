const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const extract = require('extract-zip');

const repositoryRoot = path.resolve(__dirname, '..');
const optionsPath = path.join(repositoryRoot, 'config', 'options.json');
const casesPath = path.join(repositoryRoot, 'cases');

async function readOptions() {
  const options = JSON.parse(await fsp.readFile(optionsPath, 'utf8'));
  const settings = options.sbmlTestSuite;

  if (
    !settings ||
    typeof settings.version !== 'string' ||
    typeof settings.archiveUrl !== 'string' ||
    !/^https:\/\/.+/.test(settings.archiveUrl) ||
    typeof settings.archiveSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(settings.archiveSha256)
  ) {
    throw new Error(`Invalid SBML Test Suite configuration in ${optionsPath}`);
  }

  return settings;
}

async function downloadArchive(url, archivePath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const hash = crypto.createHash('sha256');
  const hashStream = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body),
    hashStream,
    fs.createWriteStream(archivePath),
  );

  return hash.digest('hex');
}

async function main() {
  const settings = await readOptions();
  const archivePath = path.join(casesPath, 'semantic-tests.zip');

  await fsp.rm(casesPath, { recursive: true, force: true });
  await fsp.mkdir(casesPath, { recursive: true });

  try {
    console.log(`Downloading SBML Semantic Test Suite ${settings.version}...`);
    const actualHash = await downloadArchive(settings.archiveUrl, archivePath);

    if (actualHash.toLowerCase() !== settings.archiveSha256.toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch. Expected ${settings.archiveSha256}, received ${actualHash}.`,
      );
    }

    console.log('Extracting archive...');
    await extract(archivePath, { dir: casesPath });
    console.log(`SBML Semantic Test Suite ${settings.version} is available at ${casesPath}`);
  } finally {
    await fsp.rm(archivePath, { force: true });
  }
}

main().catch((error) => {
  console.error(`fetch:sbml failed: ${error.message}`);
  process.exitCode = 1;
});
