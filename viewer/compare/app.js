const elements = {
  file: document.querySelector('#comparison-file'),
  url: document.querySelector('#comparison-url'),
  loadUrl: document.querySelector('#load-url'),
  error: document.querySelector('#error-message'),
  status: document.querySelector('#comparison-status'),
  content: document.querySelector('#comparison-content'),
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
  comparison: null,
  comparisonUrl: null,
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

function resultName(caseResult) {
  if (caseResult.status === 'error') return 'error';
  if (caseResult.status === 'success-success') {
    if (caseResult.artifactComparison?.status === 'error') return 'comparison-error';
    return caseResult.artifactComparison?.status || 'success-success';
  }
  return caseResult.status;
}

function resultLabel(result) {
  return result.replaceAll('-', ' ');
}

function resolveRelativePath(relativePath) {
  if (!state.comparisonUrl || !relativePath) return null;
  try {
    return new URL(relativePath, state.comparisonUrl).href;
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

function countResults(result) {
  return state.comparison.cases.filter((caseResult) => resultName(caseResult) === result).length;
}

function renderOverview() {
  const { comparison } = state;
  elements.overview.replaceChildren();
  appendOverviewItem('Artifact', comparison.artifact, 'meta-value');
  appendOverviewItem('Equal', countResults('equal'), 'success-value');
  appendOverviewItem('Different', countResults('different'), 'difference-value');
  appendOverviewItem('Comparison errors', countResults('comparison-error') + countResults('error'), 'failure-value');
  appendOverviewItem('Success / failed', countResults('success-failed'), 'failure-value');
  appendOverviewItem('Failed / success', countResults('failed-success'), 'new-value');
  appendOverviewItem('Failed / failed', countResults('failed-failed'), 'neutral-value');
  if (comparison.ignorePaths?.length) {
    appendOverviewItem('Ignored paths', comparison.ignorePaths.join(', '), 'meta-value');
  }
}

function addDetail(list, label, value) {
  if (value === undefined || value === null || value === '') return;
  list.append(createElement('dt', {}, label));
  list.append(createElement('dd', {}, String(value)));
}

function appendIssues(container, issues) {
  if (!Array.isArray(issues) || !issues.length) return;
  const heading = createElement('h3', {}, 'Issues');
  const list = createElement('ul');
  for (const issue of issues) {
    const text = [issue.report, issue.reason, issue.message].filter(Boolean).join(': ');
    list.append(createElement('li', {}, text));
  }
  container.append(heading, list);
}

async function appendDiff(container, diffPath) {
  const url = resolveRelativePath(diffPath);
  const heading = createElement('h3', {}, 'Difference file');
  const path = createElement('p', {}, diffPath);
  if (url) {
    const link = createElement('a', { href: url, target: '_blank', rel: 'noreferrer' }, 'Open diff JSON');
    path.append(' ', link);
  }
  container.append(heading, path);

  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const diff = await response.json();
    const details = createElement('details');
    details.append(createElement('summary', {}, `Differences (${diff.differenceCount ?? 0})`));
    details.append(createElement('pre', {}, JSON.stringify(diff.differences || [], null, 2)));
    container.append(details);
  } catch (error) {
    container.append(createElement('p', { className: 'hint' }, `Unable to load diff: ${error.message}`));
  }
}

async function renderCaseDetails(caseResult) {
  elements.dialogTitle.textContent = `Case ${caseResult.caseId}`;
  elements.details.replaceChildren();
  const result = resultName(caseResult);
  elements.details.append(createElement('span', { className: `status ${result}` }, resultLabel(result)));

  const list = createElement('dl', { className: 'detail-list' });
  addDetail(list, 'Report status', caseResult.status);
  addDetail(list, 'Artifact comparison', caseResult.artifactComparison?.status);
  addDetail(list, 'Difference count', caseResult.artifactComparison?.differenceCount);
  elements.details.append(list);
  appendIssues(elements.details, caseResult.issues);
  appendIssues(elements.details, caseResult.artifactComparison?.issues);
  elements.dialog.showModal();

  if (caseResult.artifactComparison?.diffPath) {
    await appendDiff(elements.details, caseResult.artifactComparison.diffPath);
  }
}

function renderCases() {
  const search = elements.search.value.trim().toLowerCase();
  const selectedResult = elements.filter.value;
  const cases = state.comparison.cases;
  const visibleCases = cases.filter((caseResult) => {
    const matchesSearch = String(caseResult.caseId || '').toLowerCase().includes(search);
    const matchesResult = selectedResult === 'all' || resultName(caseResult) === selectedResult;
    return matchesSearch && matchesResult;
  });

  elements.grid.replaceChildren();
  for (const caseResult of visibleCases) {
    const result = resultName(caseResult);
    const button = createElement('button', {
      type: 'button',
      className: `case ${result}`,
      title: `Case ${caseResult.caseId}: ${resultLabel(result)}`,
      'aria-label': `Open case ${caseResult.caseId}: ${resultLabel(result)}`,
    });
    button.addEventListener('click', () => { renderCaseDetails(caseResult); });
    elements.grid.append(button);
  }
  elements.count.textContent = `${visibleCases.length} of ${cases.length} cases`;
}

function renderComparison(comparison, comparisonUrl, label) {
  if (!comparison || !Array.isArray(comparison.cases) || !['canonical', 'dynms'].includes(comparison.artifact)) {
    throw new Error('The selected JSON is not an FCTS comparison with an artifact and cases array.');
  }

  state.comparison = comparison;
  state.comparisonUrl = comparisonUrl;
  elements.status.textContent = label;
  elements.content.hidden = false;
  showError('');
  renderOverview();
  renderCases();
}

async function loadUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load comparison: HTTP ${response.status}`);
  const comparison = await response.json();
  renderComparison(comparison, response.url, new URL(response.url).hostname);
}

elements.file.addEventListener('change', async () => {
  const [file] = elements.file.files;
  if (!file) return;
  try {
    renderComparison(JSON.parse(await file.text()), null, file.name);
  } catch (error) {
    showError(error.message);
  }
});

elements.loadUrl.addEventListener('click', async () => {
  const url = elements.url.value.trim();
  if (!url) return showError('Enter a comparison URL first.');
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
