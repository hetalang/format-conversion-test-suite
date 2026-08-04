const elements = {
  file: document.querySelector('#report-file'),
  url: document.querySelector('#report-url'),
  loadUrl: document.querySelector('#load-url'),
  error: document.querySelector('#error-message'),
  status: document.querySelector('#report-status'),
  content: document.querySelector('#report-content'),
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

function renderOverview() {
  const { report } = state;
  const environment = report.environment || {};
  const cases = report.cases || [];
  const countStatus = (status) => cases.filter((caseResult) => statusName(caseResult) === status).length;
  elements.overview.replaceChildren();

  appendOverviewItem('Report status', report.status || 'unknown', 'meta-value');
  appendOverviewItem('Successful', countStatus('success'), 'success-value');
  appendOverviewItem('Failed', countStatus('failed'), 'failure-value');
  appendOverviewItem('Not evaluated', countStatus('not-evaluated'), 'neutral-value');
  appendOverviewItem('Heta compiler', environment.hetaVersion || 'unknown', 'meta-value');
}

function renderCaseDetails(caseResult) {
  elements.dialogTitle.textContent = `Case ${caseResult.caseId}`;
  elements.details.replaceChildren();
  elements.details.append(createElement('span', { className: `status ${statusName(caseResult)}` }, statusName(caseResult)));

  const list = createElement('dl', { className: 'detail-list' });
  const addDetail = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    list.append(createElement('dt', {}, label));
    list.append(createElement('dd', {}, String(value)));
  };

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
  const visibleCases = cases.filter((caseResult) => {
    const matchesSearch = String(caseResult.caseId || '').toLowerCase().includes(search);
    const matchesStatus = selectedStatus === 'all' || statusName(caseResult) === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  elements.grid.replaceChildren();
  for (const caseResult of visibleCases) {
    const status = statusName(caseResult);
    const button = createElement('button', {
      type: 'button',
      className: `case ${status}`,
      title: `Case ${caseResult.caseId}: ${status}`,
      'aria-label': `Open case ${caseResult.caseId}: ${status}`,
    });
    button.addEventListener('click', () => renderCaseDetails(caseResult));
    elements.grid.append(button);
  }
  elements.count.textContent = `${visibleCases.length} of ${cases.length} cases`;
}

function renderReport(report, reportUrl, label) {
  if (!report || !Array.isArray(report.cases)) {
    throw new Error('The selected JSON is not an FCTS report with a cases array.');
  }

  state.report = report;
  state.reportUrl = reportUrl;
  elements.status.textContent = label;
  elements.content.hidden = false;
  showError('');
  renderOverview();
  renderCases();
}

async function loadUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load report: HTTP ${response.status}`);
  const report = await response.json();
  renderReport(report, response.url, new URL(response.url).hostname);
}

elements.file.addEventListener('change', async () => {
  const [file] = elements.file.files;
  if (!file) return;
  try {
    renderReport(JSON.parse(await file.text()), null, file.name);
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
