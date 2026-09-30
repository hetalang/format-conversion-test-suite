const elements = {
  file: document.querySelector('#report-file'),
  url: document.querySelector('#report-url'),
  loadUrl: document.querySelector('#load-url'),
  error: document.querySelector('#error-message'),
  content: document.querySelector('#report-content'),
  description: document.querySelector('#report-description'),
  metadata: document.querySelector('#report-metadata'),
  generator: document.querySelector('#report-generator-values'),
  command: document.querySelector('#report-command-values'),
  environment: document.querySelector('#report-environment-values'),
  overview: document.querySelector('#overview'),
  grid: document.querySelector('#case-grid'),
  count: document.querySelector('#case-count'),
  search: document.querySelector('#case-search'),
  filter: document.querySelector('#status-filter'),
  dialog: document.querySelector('#case-dialog'),
  dialogTitle: document.querySelector('#case-dialog-title'),
  details: document.querySelector('#case-details'),
  closeDialog: document.querySelector('#close-dialog'),
};

const state = {
  report: null,
  reportUrl: null,
};

function createElement(name, attributes = {}, text = '') {
  const element = document.createElement(name);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') element.className = value;
    else element.setAttribute(key, value);
  }
  if (text) element.textContent = text;
  return element;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = !message;
}

function statusName(caseResult) {
  const knownStatuses = ['success', 'failed', 'not-evaluated'];
  return knownStatuses.includes(caseResult.status) ? caseResult.status : 'unknown';
}

function caseNumber(index) {
  const configuredSkip = Number(state.report?.command?.skip);
  const skip = Number.isSafeInteger(configuredSkip) && configuredSkip >= 0 ? configuredSkip : 0;
  return skip + index + 1;
}

function resolveArtifactPath(artifactPath) {
  if (!state.reportUrl || !artifactPath) return null;
  try {
    return new URL(artifactPath, state.reportUrl).href;
  } catch {
    return null;
  }
}

function appendOverviewItem(label, value, extraClass = '') {
  const item = createElement('div');
  item.append(createElement('p', { className: 'label' }, label));
  item.append(createElement('p', { className: `value ${extraClass}`.trim() }, String(value ?? '—')));
  elements.overview.append(item);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function appendReportMetadata(label, value, target = elements.metadata) {
  if (value === undefined || value === null || value === '') return;
  target.append(createElement('dt', {}, label));
  target.append(createElement('dd', {}, formatMetadataValue(value)));
}

function formatMetadataValue(value) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function renderReportContext() {
  const { report } = state;
  const command = report.command || {};
  const environment = report.environment || {};
  const generator = report.generator || {};
  elements.description.textContent = typeof report.description === 'string' && report.description.trim()
    ? report.description
    : 'No description was provided by this report generator.';
  elements.metadata.replaceChildren();
  elements.generator.replaceChildren();
  elements.command.replaceChildren();
  elements.environment.replaceChildren();
  appendReportMetadata('Status', report.status);
  appendReportMetadata('Started', formatDate(report.startedAt));
  appendReportMetadata('Completed', formatDate(report.completedAt));
  for (const [key, value] of Object.entries(generator)) {
    appendReportMetadata(key, value, elements.generator);
  }
  for (const [key, value] of Object.entries(command)) {
    appendReportMetadata(key, value, elements.command);
  }
  for (const [key, value] of Object.entries(environment)) {
    appendReportMetadata(key, value, elements.environment);
  }
}

function renderOverview() {
  const { report } = state;
  const cases = report.cases || [];
  const countStatus = (status) => cases.filter((caseResult) => statusName(caseResult) === status).length;
  elements.overview.replaceChildren();

  appendOverviewItem('Successful', countStatus('success'), 'success-value');
  appendOverviewItem('Failed', countStatus('failed'), 'failure-value');
  appendOverviewItem('Not evaluated', countStatus('not-evaluated'), 'neutral-value');
}

function renderCaseDetails(caseResult) {
  elements.dialogTitle.textContent = `Case ${caseResult.caseId}`;
  elements.details.replaceChildren();
  elements.details.append(createElement('span', { className: `status ${statusName(caseResult)}` }, statusName(caseResult)));

  const list = createElement('dl', { className: 'detail-list' });
  const addDetail = (label, value, className = '') => {
    if (value === undefined || value === null || value === '') return;
    list.append(createElement('dt', {}, label));
    list.append(createElement('dd', { className }, String(value)));
  };

  addDetail('Synopsis', caseResult.synopsis, 'synopsis');
  addDetail('Build status', caseResult.buildStatus);
  addDetail('Canonical schema validation', caseResult.validation?.canonical?.status);
  addDetail('Canonical schema', caseResult.validation?.canonical?.schema?.title);
  addDetail('DynMS schema validation', caseResult.validation?.dynms?.status);
  addDetail('DynMS schema', caseResult.validation?.dynms?.schema?.title);
  addDetail('Simulation comparison', caseResult.comparison?.status);
  addDetail('Compared values', caseResult.comparison?.comparedValues);
  addDetail('Maximum absolute error', caseResult.comparison?.maxAbsoluteError);
  addDetail('Not evaluated component tags', caseResult.notEvaluatedComponentTags?.join(', '));
  addDetail('Not evaluated test tags', caseResult.notEvaluatedTestTags?.join(', '));
  addDetail('Source', caseResult.sourcePath);
  addDetail('Build source', caseResult.buildSourcePath);
  addDetail('Log file', caseResult.logPath);
  addDetail('Error', caseResult.error?.message);
  addDetail('Exit code', caseResult.error?.exitCode);
  elements.details.append(list);

  const artifacts = {
    ...(caseResult.buildSourcePath ? { input: caseResult.buildSourcePath } : {}),
    ...(caseResult.outputs || {}),
    ...(caseResult.logPath ? { log: caseResult.logPath } : {}),
    ...(Array.isArray(caseResult.simulationPlotPaths)
      ? Object.fromEntries(caseResult.simulationPlotPaths.map((plotPath, index) => [`plot ${index + 1}`, plotPath]))
      : {}),
  };
  if (Object.keys(artifacts).length) {
    const outputHeading = createElement('h3', {}, 'Artifacts');
    const outputList = createElement('ul');
    for (const [name, artifactPath] of Object.entries(artifacts)) {
      const item = createElement('li');
      const url = resolveArtifactPath(artifactPath);
      if (url) item.append(createElement('a', { href: url, target: '_blank', rel: 'noreferrer' }, `${name}: ${artifactPath}`));
      else item.textContent = `${name}: ${artifactPath}`;
      outputList.append(item);
    }
    elements.details.append(outputHeading, outputList);
  }

  const diagnostics = [
    ['Compiler output', caseResult.error?.stdout],
    ['Compiler error output', caseResult.error?.stderr],
    ['DynMS schema validation errors', caseResult.validation?.dynms?.errors?.length
      ? JSON.stringify(caseResult.validation.dynms.errors, null, 2)
      : null],
    ['Canonical schema validation errors', caseResult.validation?.canonical?.errors?.length
      ? JSON.stringify(caseResult.validation.canonical.errors, null, 2)
      : null],
    ['Simulation comparison failures', caseResult.comparison?.failures?.length
      ? JSON.stringify(caseResult.comparison.failures, null, 2)
      : null],
  ].filter(([, value]) => value);

  for (const [title, value] of diagnostics) {
    const details = createElement('details');
    details.append(createElement('summary', {}, title));
    details.append(createElement('pre', {}, value));
    elements.details.append(details);
  }

  elements.dialog.showModal();
}

function renderCases() {
  const search = elements.search.value.trim().toLowerCase();
  const selectedStatus = elements.filter.value;
  const cases = state.report.cases || [];
  const visibleCases = cases.map((caseResult, index) => ({ caseResult, index })).filter(({ caseResult }) => {
    const matchesSearch = String(caseResult.caseId || '').toLowerCase().includes(search);
    const matchesStatus = selectedStatus === 'all' || statusName(caseResult) === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  elements.grid.replaceChildren();
  for (const { caseResult, index } of visibleCases) {
    const status = statusName(caseResult);
    const number = caseNumber(index);
    const button = createElement('button', {
      type: 'button',
      className: `case ${status}`,
      title: `\#${number} (ID ${caseResult.caseId}): ${status}`,
      'aria-label': `Open case ${number} (ID ${caseResult.caseId}): ${status}`,
    });
    button.addEventListener('click', () => renderCaseDetails(caseResult));
    elements.grid.append(button);
  }
  elements.count.textContent = `${visibleCases.length} of ${cases.length} cases`;
}

function renderReport(report, reportUrl) {
  if (!report || !Array.isArray(report.cases)) {
    throw new Error('The selected JSON is not an FCTS report with a cases array.');
  }

  state.report = report;
  state.reportUrl = reportUrl;
  elements.content.hidden = false;
  showError('');
  renderReportContext();
  renderOverview();
  renderCases();
}

async function loadUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load report: HTTP ${response.status}`);
  const report = await response.json();
  renderReport(report, response.url);
}

elements.file.addEventListener('change', async () => {
  const [file] = elements.file.files;
  if (!file) return;
  try {
    renderReport(JSON.parse(await file.text()), null);
  } catch (error) {
    showError(error.message);
  }
});

elements.loadUrl.addEventListener('click', async () => {
  const url = elements.url.value.trim();
  if (!url) return showError('Enter a report URL first.');
  try {
    await loadUrl(url);
    const pageUrl = new URL(window.location.href);
    pageUrl.searchParams.set('ref', url);
    history.replaceState(null, '', pageUrl);
  } catch (error) {
    showError(error.message);
  }
});

elements.search.addEventListener('input', renderCases);
elements.filter.addEventListener('change', renderCases);
elements.closeDialog.addEventListener('click', () => elements.dialog.close());
elements.dialog.addEventListener('click', (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});

const reference = new URLSearchParams(window.location.search).get('ref');
if (reference) {
  elements.url.value = reference;
  loadUrl(reference).catch((error) => showError(error.message));
}
