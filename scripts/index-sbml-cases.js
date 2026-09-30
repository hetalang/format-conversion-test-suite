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
    typeof settings.archiveUrl !== 'string' ||
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

async function readModelMetadata(semanticPath, caseId) {
  const modelPath = path.join(semanticPath, caseId, `${caseId}-model.m`);

  try {
    const content = await fs.readFile(modelPath, 'utf8');
    const readTags = (fieldName) => {
      // Only horizontal whitespace is allowed after the colon. Using \s here
      // would consume a newline when a tag field is intentionally empty.
      const match = new RegExp(`^[ \\t]*${fieldName}:[ \\t]*(.*)$`, 'mi').exec(content);

      return match && match[1].trim()
        ? match[1].split(',').map((tag) => tag.trim()).filter(Boolean)
        : [];
    };

    const readSynopsis = () => {
      const lines = content.split(/\r?\n/);
      const synopsisStart = lines.findIndex((line) => /^[ \t]*synopsis:[ \t]*/i.test(line));

      if (synopsisStart === -1) {
        return '';
      }

      const synopsis = [lines[synopsisStart].replace(/^[ \t]*synopsis:[ \t]*/i, '').trimEnd()];

      for (let index = synopsisStart + 1; index < lines.length; index += 1) {
        const line = lines[index];

        // Synopsis continuations are indented, while the following metadata
        // field begins at the start of the line.
        if (!/^[ \t]+/.test(line) || /^[ \t]*[A-Za-z][A-Za-z0-9]*:[ \t]*/.test(line)) {
          break;
        }

        synopsis.push(line.trim());
      }

      return synopsis.join('\n').trim();
    };

    return {
      synopsis: readSynopsis(),
      componentTags: readTags('componentTags'),
      testTags: readTags('testTags'),
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { synopsis: '', componentTags: [], testTags: [] };
    }
    throw error;
  }
}

function toRelativeCasePath(casesPath, filePath) {
  return path.relative(casesPath, filePath).split(path.sep).join('/');
}

function parseSettingNumber(value, settingName, settingsPath, {
  minimum,
  exclusiveMinimum = false,
  integer = false,
} = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || (minimum !== undefined && (
    exclusiveMinimum ? parsed <= minimum : parsed < minimum
  ))) {
    const comparison = exclusiveMinimum ? 'greater than' : 'at least';
    const requirement = minimum === undefined ? 'a finite number' : `${comparison} ${minimum}`;
    throw new Error(`${settingsPath}: setting "${settingName}" must be ${requirement}`);
  }

  return parsed;
}

function hasSettingValue(value) {
  return value.trim().length > 0;
}

function parseSettingVariables(value, settingName, settingsPath, { required = false } = {}) {
  const variables = value.split(',').map((variable) => variable.trim()).filter(Boolean);

  if (required && !variables.length) {
    throw new Error(`${settingsPath}: setting "${settingName}" must contain at least one variable`);
  }

  return variables;
}

async function readSimulationMetadata(semanticPath, casesPath, caseId) {
  const casePath = path.join(semanticPath, caseId);
  const settingsPath = path.join(casePath, `${caseId}-settings.txt`);
  const referenceResultsPath = path.join(casePath, `${caseId}-results.csv`);
  let content;

  try {
    content = await fs.readFile(settingsPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Simulation settings are missing for case ${caseId}: ${settingsPath}`);
    }
    throw error;
  }

  try {
    await fs.access(referenceResultsPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Reference simulation results are missing for case ${caseId}: ${referenceResultsPath}`);
    }
    throw error;
  }

  const settings = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z]+)\s*:\s*(.*)\s*$/.exec(line);
    if (match) {
      settings[match[1]] = match[2];
    }
  }

  const requiredSettings = ['start', 'duration', 'steps', 'variables', 'absolute', 'relative', 'amount', 'concentration'];
  for (const settingName of requiredSettings) {
    if (!(settingName in settings)) {
      throw new Error(`${settingsPath}: required setting "${settingName}" is missing`);
    }
  }

  const timeSettingNames = ['start', 'duration', 'steps'];
  const populatedTimeSettings = timeSettingNames.filter((settingName) => hasSettingValue(settings[settingName]));
  if (populatedTimeSettings.length > 0 && populatedTimeSettings.length < timeSettingNames.length) {
    throw new Error(`${settingsPath}: start, duration, and steps must either all be set or all be empty`);
  }

  const simulation = {
    sourceSettingsPath: toRelativeCasePath(casesPath, settingsPath),
    referenceResultsPath: toRelativeCasePath(casesPath, referenceResultsPath),
    variables: parseSettingVariables(settings.variables, 'variables', settingsPath, { required: true }),
    absoluteTolerance: parseSettingNumber(settings.absolute, 'absolute', settingsPath, { minimum: 0 }),
    relativeTolerance: parseSettingNumber(settings.relative, 'relative', settingsPath, { minimum: 0 }),
    amountVariables: parseSettingVariables(settings.amount, 'amount', settingsPath),
    concentrationVariables: parseSettingVariables(settings.concentration, 'concentration', settingsPath),
  };

  if (populatedTimeSettings.length) {
    simulation.timeCourse = {
      start: parseSettingNumber(settings.start, 'start', settingsPath),
      duration: parseSettingNumber(settings.duration, 'duration', settingsPath, { minimum: 0 }),
      steps: parseSettingNumber(settings.steps, 'steps', settingsPath, {
        minimum: 0,
        exclusiveMinimum: true,
        integer: true,
      }),
    };
  }

  return simulation;
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
  let sbmlL3V1Count = 0;
  let sbmlL3V2Count = 0;
  let simulationCount = 0;

  for (const caseId of caseDirectories) {
    const files = await fs.readdir(path.join(semanticPath, caseId), {
      withFileTypes: true,
    });

    const caseIndex = {
      caseId,
      ...(await readModelMetadata(semanticPath, caseId)),
      simulation: await readSimulationMetadata(semanticPath, casesPath, caseId),
    };
    simulationCount += 1;

    for (const file of files.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativeFilePath = toRelativeCasePath(casesPath, path.join(semanticPath, caseId, file.name));

      if (file.isFile() && file.name.endsWith('-sbml-l3v2.xml')) {
        caseIndex.sbmlL3V2Path = relativeFilePath;
        sbmlL3V2Count += 1;
      }
      if (file.isFile() && file.name.endsWith('-sbml-l3v1.xml')) {
        caseIndex.sbmlL3V1Path = relativeFilePath;
        sbmlL3V1Count += 1;
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
      archiveUrl: settings.archiveUrl,
      archiveSha256: settings.archiveSha256,
    },
    root: path.relative(casesPath, semanticPath).split(path.sep).join('/'),
    summary: {
      caseCount: caseDirectories.length,
      simulationCount,
      sbmlL2V5Count,
      sbmlL3V1Count,
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
