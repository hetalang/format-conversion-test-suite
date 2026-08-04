const fs = require('node:fs/promises');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const optionsPath = path.join(repositoryRoot, 'config', 'options.json');

async function readOptions() {
  const options = JSON.parse(await fs.readFile(optionsPath, 'utf8'));
  const settings = options.sbmlSemanticTestSuite;

  if (
    !settings ||
    typeof settings.version !== 'string' ||
    typeof settings.targetDir !== 'string'
  ) {
    throw new Error(`Invalid SBML Test Suite configuration in ${optionsPath}`);
  }

  return settings;
}

function resolveTargetDir(targetDir) {
  const targetPath = path.resolve(repositoryRoot, targetDir);
  const relativePath = path.relative(repositoryRoot, targetPath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('sbmlSemanticTestSuite.targetDir must be a subdirectory of the repository');
  }

  return targetPath;
}

async function main() {
  const settings = await readOptions();
  const semanticPath = resolveTargetDir(settings.targetDir);
  const casesPath = path.dirname(semanticPath);
  const indexPath = path.join(casesPath, 'index.json');
  let caseEntries;

  try {
    caseEntries = await fs.readdir(semanticPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('SBML cases are missing. Run "npm run fetch:sbml" first.');
    }
    throw error;
  }

  const caseDirectories = caseEntries
    .filter((entry) => entry.isDirectory() && /^\d{5}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const cases = [];
  let sbmlL2V5Count = 0;
  let sbmlL3V2Count = 0;

  for (const caseId of caseDirectories) {
    const files = await fs.readdir(path.join(semanticPath, caseId), {
      withFileTypes: true,
    });

    const caseIndex = { caseId };

    for (const file of files.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativeFilePath = path
        .relative(casesPath, path.join(semanticPath, caseId, file.name))
        .split(path.sep)
        .join('/');

      if (file.isFile() && file.name.endsWith('-sbml-l3v2.xml')) {
        caseIndex.sbmlL3V2Path = relativeFilePath;
        sbmlL3V2Count += 1;
      }
      if (file.isFile() && file.name.endsWith('-sbml-l2v5.xml')) {
        caseIndex.sbmlL2V5Path = relativeFilePath;
        sbmlL2V5Count += 1;
      }
    }

    cases.push(caseIndex);
  }

  const index = {
    schemaVersion: 1,
    testSuite: {
      version: settings.version,
      archiveSha256: settings.archiveSha256,
    },
    root: path.relative(casesPath, semanticPath).split(path.sep).join('/'),
    summary: {
      caseCount: caseDirectories.length,
      sbmlL2V5Count,
      sbmlL3V2Count,
    },
    cases,
  };

  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Indexed ${caseDirectories.length} SBML cases in ${indexPath}`);
}

main().catch((error) => {
  console.error(`index:sbml failed: ${error.message}`);
  process.exitCode = 1;
});
