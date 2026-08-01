const startPanel = document.getElementById('start-panel');
const startForm = document.getElementById('start-form');
const jobPanel = document.getElementById('job-panel');
const promptBox = document.getElementById('prompt-box');
const logEl = document.getElementById('log');
const jobsEl = document.getElementById('jobs');
const jobsEmpty = document.getElementById('jobs-empty');
const statGrid = document.getElementById('stat-grid');
const pipelineProgress = document.getElementById('pipeline-progress');
const formMessage = document.getElementById('form-message');
const jobMessage = document.getElementById('job-message');
const toast = document.getElementById('toast');

const websiteInput = document.getElementById('website-url');
const companyInput = document.getElementById('company-name');
const sameForwardInput = document.getElementById('same-forward-url');
const forwardField = document.getElementById('forward-url-field');
const forwardInput = document.getElementById('forward-url');
const inboxInput = document.getElementById('inbox-count');
const googlePercentInput = document.getElementById('google-percent');
const googlePercentOutput = document.getElementById('google-percent-output');

const wizardTitles = ['Tell us about the client', 'Choose the mailbox plan', 'Review and create'];
const pipelineStages = [
  { label: 'Client intake', statuses: ['ingest'] },
  {
    label: 'Find domains',
    statuses: ['generate_domains', 'await_porkbun', 'check_domains'],
  },
  {
    label: 'Domain approval',
    statuses: ['await_domain_approval', 'register_domains', 'await_porkbun_funds'],
  },
  {
    label: 'Connect domains',
    statuses: ['provision_mailboxes', 'await_inboxkit_workspace', 'await_ns'],
  },
  {
    label: 'Mailbox approval',
    statuses: ['await_mailbox_plan', 'buy_mailboxes'],
  },
  { label: 'Provision inboxes', statuses: ['await_mailboxes'] },
  {
    label: 'Smartlead & warmup',
    statuses: ['await_smartlead_load', 'load_smartlead', 'create_smartlead_client'],
  },
  { label: 'Complete', statuses: ['notify_complete', 'completed'] },
];

const friendlyStatuses = {
  ingest: 'Reading website',
  generate_domains: 'Generating domains',
  await_porkbun: 'Needs Porkbun setup',
  check_domains: 'Checking domains',
  await_domain_approval: 'Approval needed',
  register_domains: 'Registering domains',
  await_porkbun_funds: 'Funds needed',
  await_inboxkit_workspace: 'Workspace needed',
  provision_mailboxes: 'Connecting domains',
  await_ns: 'Waiting for nameservers',
  await_mailbox_plan: 'Approval needed',
  buy_mailboxes: 'Buying mailboxes',
  await_mailboxes: 'Provisioning mailboxes',
  await_smartlead_load: 'Approval needed',
  load_smartlead: 'Loading Smartlead',
  create_smartlead_client: 'Creating client',
  notify_complete: 'Finishing',
  completed: 'Completed',
  failed: 'Needs attention',
};

let wizardStep = 1;
let activeJobId = null;
let pollTimer = null;
let latestJob = null;
let isSubmitting = false;
let toastTimer = null;

hydrateDraft();
updateForwardField();
updatePlanPreview();
showWizardStep(1);

document.getElementById('wizard-next').addEventListener('click', () => {
  if (!validateWizardStep(wizardStep)) return;
  showWizardStep(Math.min(3, wizardStep + 1));
});

document.getElementById('wizard-back').addEventListener('click', () => {
  showWizardStep(Math.max(1, wizardStep - 1));
});

document.getElementById('new-onboarding').addEventListener('click', () => {
  stopPolling();
  activeJobId = null;
  latestJob = null;
  history.pushState({}, '', '/');
  jobPanel.classList.add('hidden');
  startPanel.classList.remove('hidden');
  showWizardStep(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

document.getElementById('refresh-jobs').addEventListener('click', async (event) => {
  event.currentTarget.classList.add('spinning');
  await loadJobs();
  event.currentTarget.classList.remove('spinning');
});

sameForwardInput.addEventListener('change', () => {
  updateForwardField();
  saveDraft();
});

for (const input of [websiteInput, companyInput, forwardInput, inboxInput, googlePercentInput]) {
  input.addEventListener('input', () => {
    clearMessage(formMessage);
    saveDraft();
    updatePlanPreview();
  });
}

for (const button of document.querySelectorAll('[data-adjust]')) {
  button.addEventListener('click', () => {
    const adjustment = Number(button.dataset.adjust || 0);
    const next = Math.max(4, Math.min(400, Number(inboxInput.value || 80) + adjustment));
    inboxInput.value = String(next);
    inboxInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

startForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (wizardStep !== 3 || !validateWizardStep(3) || isSubmitting) return;

  const plan = calculatePlan();
  const body = {
    websiteUrl: normalizeUrl(websiteInput.value),
    forwardToUrl: sameForwardInput.checked
      ? normalizeUrl(websiteInput.value)
      : normalizeUrl(forwardInput.value),
    companyName: companyInput.value.trim(),
    inboxCount: plan.total,
    googleRatio: plan.ratio,
    manualApproval: true,
  };

  setSubmitting(true);
  clearMessage(formMessage);
  try {
    const { response, data } = await requestJson('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(data.error || 'Could not create onboarding job');
    localStorage.removeItem('onboarding-draft');
    showToast('Onboarding job created. No paid action has run.');
    await selectJob(data.job.id);
    await loadJobs();
  } catch (error) {
    showMessage(formMessage, error.message || 'Could not create onboarding job');
  } finally {
    setSubmitting(false);
  }
});

window.addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('job');
  if (id) selectJob(id, false);
  else {
    stopPolling();
    activeJobId = null;
    jobPanel.classList.add('hidden');
    startPanel.classList.remove('hidden');
  }
});

function showWizardStep(step) {
  wizardStep = step;
  for (const element of document.querySelectorAll('.wizard-step')) {
    element.classList.toggle('hidden', Number(element.dataset.step) !== step);
  }
  for (const element of document.querySelectorAll('[data-progress-step]')) {
    const itemStep = Number(element.dataset.progressStep);
    element.classList.toggle('active', itemStep === step);
    element.classList.toggle('complete', itemStep < step);
  }
  document.getElementById('wizard-title').textContent = wizardTitles[step - 1];
  document.getElementById('step-count').textContent = `Step ${step} of 3`;
  document.getElementById('wizard-back').classList.toggle('hidden', step === 1);
  document.getElementById('wizard-next').classList.toggle('hidden', step === 3);
  document.getElementById('wizard-submit').classList.toggle('hidden', step !== 3);
  clearMessage(formMessage);
  if (step === 3) updateReview();
}

function validateWizardStep(step) {
  clearMessage(formMessage);
  const fields =
    step === 1
      ? [websiteInput, companyInput, ...(sameForwardInput.checked ? [] : [forwardInput])]
      : step === 2
        ? [inboxInput]
        : [document.getElementById('review-confirmed')];

  if (step === 1) {
    websiteInput.value = normalizeUrl(websiteInput.value);
    if (!sameForwardInput.checked) forwardInput.value = normalizeUrl(forwardInput.value);
  }

  if (step === 2) {
    const inboxes = Number(inboxInput.value);
    if (!Number.isInteger(inboxes) || inboxes < 4 || inboxes % 4 !== 0) {
      inboxInput.setCustomValidity('Use a multiple of 4 (four inboxes per domain).');
    } else {
      inboxInput.setCustomValidity('');
    }
  }

  for (const field of fields) {
    if (!field.checkValidity()) {
      field.reportValidity();
      showMessage(formMessage, 'Please complete the highlighted information.');
      return false;
    }
  }
  saveDraft();
  return true;
}

function updateForwardField() {
  forwardField.classList.toggle('hidden', sameForwardInput.checked);
  forwardInput.required = !sameForwardInput.checked;
  if (sameForwardInput.checked) forwardInput.value = '';
}

function calculatePlan(totalOverride) {
  const total = Math.max(4, Number(totalOverride ?? inboxInput.value ?? 80));
  const domains = Math.max(1, Math.ceil(total / 4));
  const ratio = Math.max(0, Math.min(1, Number(googlePercentInput.value || 67) / 100));
  let googleDomains = Math.round(domains * ratio);
  if (ratio < 1 && domains > 1 && googleDomains === domains) googleDomains = domains - 1;
  if (ratio > 0 && domains > 1 && googleDomains === 0) googleDomains = 1;
  return {
    total: domains * 4,
    domains,
    ratio,
    google: googleDomains * 4,
    microsoft: (domains - googleDomains) * 4,
  };
}

function updatePlanPreview() {
  const plan = calculatePlan();
  googlePercentOutput.textContent = `${Math.round(plan.ratio * 100)}% Google`;
  document.getElementById('preview-domains').textContent = plan.domains;
  document.getElementById('preview-google').textContent = plan.google;
  document.getElementById('preview-microsoft').textContent = plan.microsoft;
}

function updateReview() {
  const plan = calculatePlan();
  document.getElementById('review-company').textContent = companyInput.value.trim() || '—';
  document.getElementById('review-website').textContent = normalizeUrl(websiteInput.value) || '—';
  document.getElementById('review-forward').textContent = sameForwardInput.checked
    ? 'Main website'
    : normalizeUrl(forwardInput.value) || '—';
  document.getElementById('review-plan').textContent =
    `${plan.total} inboxes across ${plan.domains} domains`;
  document.getElementById('review-split').textContent =
    `${plan.google} Google / ${plan.microsoft} Microsoft`;
}

function saveDraft() {
  const draft = {
    websiteUrl: websiteInput.value,
    companyName: companyInput.value,
    sameForward: sameForwardInput.checked,
    forwardToUrl: forwardInput.value,
    inboxCount: inboxInput.value,
    googlePercent: googlePercentInput.value,
  };
  localStorage.setItem('onboarding-draft', JSON.stringify(draft));
}

function hydrateDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem('onboarding-draft') || '{}');
    if (draft.websiteUrl) websiteInput.value = draft.websiteUrl;
    if (draft.companyName) companyInput.value = draft.companyName;
    if (typeof draft.sameForward === 'boolean') sameForwardInput.checked = draft.sameForward;
    if (draft.forwardToUrl) forwardInput.value = draft.forwardToUrl;
    if (draft.inboxCount) inboxInput.value = draft.inboxCount;
    if (draft.googlePercent) googlePercentInput.value = draft.googlePercent;
  } catch {
    localStorage.removeItem('onboarding-draft');
  }
}

async function loadJobs() {
  try {
    const { response, data } = await requestJson('/api/jobs');
    if (!response.ok) throw new Error(data.error || 'Could not load jobs');
    const jobs = data.jobs || [];
    jobsEl.innerHTML = '';
    jobsEmpty.classList.toggle('hidden', jobs.length > 0);
    for (const job of jobs) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `job-link${job.id === activeJobId ? ' active' : ''}`;
      button.innerHTML = `
        <span>
          <strong>${escapeHtml(job.clientName || job.companyName || hostname(job.websiteUrl))}</strong>
          <small>${escapeHtml(job.id)} · ${escapeHtml(formatDate(job.updatedAt))}</small>
        </span>
        <em class="${job.status === 'failed' ? 'bad' : job.status === 'completed' ? 'good' : ''}">
          ${escapeHtml(friendlyStatuses[job.status] || humanize(job.status))}
        </em>`;
      button.addEventListener('click', () => selectJob(job.id));
      li.appendChild(button);
      jobsEl.appendChild(li);
    }
  } catch (error) {
    showToast(error.message || 'Could not load recent jobs', true);
  }
}

async function selectJob(id, updateHistory = true) {
  activeJobId = id;
  startPanel.classList.add('hidden');
  jobPanel.classList.remove('hidden');
  if (updateHistory) history.pushState({ job: id }, '', `/?job=${encodeURIComponent(id)}`);
  await refreshJob();
  await loadJobs();
  startPolling();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startPolling() {
  stopPolling();
  if (latestJob?.status === 'completed') return;
  pollTimer = setInterval(refreshJob, 3000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function refreshJob() {
  if (!activeJobId) return;
  try {
    const { response, data } = await requestJson(`/api/jobs/${activeJobId}`);
    if (!response.ok) throw new Error(data.error || 'Could not load job');
    latestJob = data.job;
    renderJob(data.job);
    if (data.job.status === 'completed') stopPolling();
  } catch (error) {
    showMessage(jobMessage, error.message || 'Could not refresh job');
  }
}

function renderJob(job) {
  document.getElementById('job-id').textContent = `Job ${job.id}`;
  document.getElementById('client-name').textContent =
    job.brand?.clientName || job.companyName || hostname(job.websiteUrl);

  const status = document.getElementById('job-status');
  status.textContent = friendlyStatuses[job.status] || humanize(job.status);
  status.className = 'status';
  if (job.pendingPrompt) status.classList.add('awaiting');
  if (job.status === 'failed') status.classList.add('failed');
  if (job.status === 'completed') status.classList.add('completed');

  renderPipeline(job);
  renderStats(job);
  renderJobPrompt(job);
  renderLog(job.logs || []);
}

function renderPipeline(job) {
  let current = pipelineStages.findIndex((stage) => stage.statuses.includes(job.status));
  if (job.status === 'failed' && job.error?.step) {
    current = pipelineStages.findIndex((stage) => stage.statuses.includes(job.error.step));
  }
  if (current < 0) current = 0;

  pipelineProgress.innerHTML = pipelineStages
    .map((stage, index) => {
      const state = job.status === 'failed' && index === current
        ? 'failed'
        : index < current || job.status === 'completed'
          ? 'complete'
          : index === current
            ? 'active'
            : '';
      return `<li class="${state}"><span>${state === 'complete' ? '✓' : index + 1}</span><small>${escapeHtml(
        stage.label,
      )}</small></li>`;
    })
    .join('');
}

function renderStats(job) {
  const mailboxes = job.mailboxes || [];
  const active = mailboxes.filter((mailbox) => mailbox.status === 'active').length;
  const warming = mailboxes.filter((mailbox) => mailbox.smartleadLoaded).length;
  const domains = job.registeredDomains?.length || 0;
  const expected = job.expectedMailboxCount || mailboxes.length || 0;
  statGrid.innerHTML = [
    [domains, 'domains registered'],
    [`${active}/${expected || '—'}`, 'inboxes active'],
    [`${warming}/${active || '—'}`, 'loaded + warming'],
    [job.manualApproval ? 'On' : 'Off', 'approval gates'],
  ]
    .map(
      ([value, label]) =>
        `<div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`,
    )
    .join('');
}

function renderJobPrompt(job) {
  clearMessage(jobMessage);
  if (!job.pendingPrompt) {
    promptBox.classList.add('hidden');
    promptBox.innerHTML = '';
    if (job.status === 'failed') {
      showMessage(jobMessage, job.error?.message || 'This job needs attention.');
    }
    return;
  }

  promptBox.classList.remove('hidden');
  promptBox.innerHTML = renderPrompt(job);
  const form = promptBox.querySelector('form');
  form?.addEventListener('submit', (event) => submitPrompt(event, job));
  wirePromptControls(job);
}

async function submitPrompt(event, job) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  if (
    job.pendingPrompt?.type === 'domain_approval' &&
    !form.querySelector('input[name="domains"]:checked')
  ) {
    showMessage(jobMessage, 'Select at least one domain before approving the purchase.');
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton?.textContent;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Working…';
  }

  const formData = new FormData(form);
  const body = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'domains') {
      if (!body.domains) body.domains = [];
      body.domains.push(String(value));
    } else {
      body[key] = value;
    }
  }
  if (body.approved != null) body.approved = true;

  try {
    const { response, data } = await requestJson(`/api/jobs/${job.id}/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(data.error || 'Could not submit approval');
    latestJob = data.job;
    renderJob(data.job);
    showToast(promptSuccessMessage(job.pendingPrompt.type));
    await loadJobs();
  } catch (error) {
    showMessage(jobMessage, error.message || 'Could not submit approval');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

function renderPrompt(job) {
  const prompt = job.pendingPrompt;
  if (prompt.type === 'porkbun_credentials') {
    return promptShell(
      'Account connection needed',
      'Connect the main Porkbun account so availability and registration can continue.',
      `
        <form>
          <div class="field"><label>Account label</label><input name="porkbunLabel" placeholder="Main Porkbun account" /></div>
          <div class="field"><label>API key</label><input name="porkbunApiKey" type="password" required autocomplete="off" /></div>
          <div class="field"><label>Secret API key</label><input name="porkbunSecretApiKey" type="password" required autocomplete="off" /></div>
          <p class="prompt-note">Credentials are redacted in API responses and are never shown in the UI again.</p>
          <button class="button" type="submit">Connect and continue</button>
        </form>`,
    );
  }

  if (prompt.type === 'domain_approval') {
    const recommended = new Set(prompt.recommendedDomains || []);
    const rows = (prompt.availableDomains || [])
      .map((domain) => {
        const checked = recommended.has(domain.domain) ? 'checked' : '';
        const price =
          domain.costCents != null ? `$${(domain.costCents / 100).toFixed(2)}` : 'Price pending';
        return `
          <label class="domain-choice">
            <input type="checkbox" name="domains" value="${escapeHtml(domain.domain)}"
              data-cost="${Number(domain.costCents || 0)}" ${checked} />
            <span><strong>${escapeHtml(domain.domain)}</strong><small>${recommended.has(domain.domain) ? 'Recommended' : 'Available'}</small></span>
            <em>${price}</em>
          </label>`;
      })
      .join('');
    return promptShell(
      'Choose and approve domains',
      'This is a paid action. Review the exact domains and estimated Porkbun charge.',
      `
        <form data-prompt="domain_approval">
          <input type="hidden" name="approved" value="true" />
          <input type="hidden" name="inboxCount" value="${prompt.suggestedInboxCount || 0}" />
          <div class="approval-toolbar">
            <button type="button" class="text-button" data-domain-select="recommended">Recommended</button>
            <button type="button" class="text-button" data-domain-select="all">Select all</button>
            <button type="button" class="text-button" data-domain-select="none">Clear</button>
          </div>
          <div class="domain-list">${rows}</div>
          <div class="two-fields">
            <div class="field">
              <label>Google share</label>
              <input name="googleRatio" type="number" min="0" max="1" step="0.01"
                value="${prompt.suggestedGoogleRatio ?? 0.67}" required />
            </div>
            <div class="field">
              <label>Signature company</label>
              <input name="companyName" value="${escapeHtml(job.companyName || job.brand?.clientName || '')}" required />
            </div>
          </div>
          <div class="spend-summary" id="domain-spend-summary"></div>
          <button class="button danger-button" type="submit" id="domain-approve-button">
            Approve domain purchase
          </button>
        </form>`,
    );
  }

  if (prompt.type === 'porkbun_funds') {
    const remaining = (prompt.remainingDomains || [])
      .map((domain) => `<li><code>${escapeHtml(domain)}</code></li>`)
      .join('');
    return promptShell(
      'Porkbun balance needs attention',
      prompt.message,
      `
        <ul class="plan-list">${remaining}</ul>
        <div class="spend-summary">
          <strong>Estimated remaining charge: $${Number(prompt.estimatedCostUsd || 0).toFixed(2)}</strong>
          <span>Current balance: ${prompt.balanceUsd != null ? `$${Number(prompt.balanceUsd).toFixed(2)}` : 'unknown'}</span>
        </div>
        <form>
          <input type="hidden" name="approved" value="true" />
          <button class="button danger-button" type="submit">I added funds—retry purchase</button>
        </form>`,
    );
  }

  if (prompt.type === 'inboxkit_workspace') {
    return promptShell(
      'InboxKit workspace needed',
      prompt.message,
      `
        <form>
          <div class="field">
            <label>Workspace ID</label>
            <input name="inboxkitWorkspaceId" required autocomplete="off" placeholder="Workspace UUID" />
            <small>${escapeHtml(prompt.reason || '')}</small>
          </div>
          <button class="button" type="submit">Use workspace</button>
        </form>`,
    );
  }

  if (prompt.type === 'mailbox_plan') {
    const grouped = groupMailboxPlan(prompt.plan || []);
    const rows = [...grouped.entries()]
      .map(([domain, group]) => `
        <li class="plan-domain">
          <div><code>${escapeHtml(domain)}</code><span class="provider ${group.platform.toLowerCase()}">${group.platform === 'GOOGLE' ? 'Google' : 'Microsoft'}</span></div>
          <small>${group.names.map(escapeHtml).join(' · ')}</small>
        </li>`)
      .join('');
    return promptShell(
      'Review the mailbox order',
      'This uses InboxKit wallet balance. Verify every domain, provider, and sender identity.',
      `
        <div class="plan-totals">
          <strong>${(prompt.plan || []).length} mailboxes</strong>
          <span>${prompt.googleCount || 0} Google</span>
          <span>${prompt.microsoftCount || 0} Microsoft</span>
        </div>
        <ul class="plan-list detailed">${rows}</ul>
        <form>
          <input type="hidden" name="approved" value="true" />
          <p class="prompt-note">No InboxKit warmup will be enabled. No test emails will be sent.</p>
          <button class="button danger-button" type="submit">
            Approve purchase of ${(prompt.plan || []).length} mailboxes
          </button>
        </form>`,
    );
  }

  if (prompt.type === 'smartlead_load') {
    const samples = (prompt.sampleSignatures || [])
      .map((signature) => `<pre class="sig">${escapeHtml(signature)}</pre>`)
      .join('');
    return promptShell(
      'Approve Smartlead load',
      `${prompt.mailboxCount || 0} active mailboxes are ready to connect and begin Smartlead warmup.`,
      `
        <div class="signature-grid">${samples}</div>
        <form>
          <input type="hidden" name="approved" value="true" />
          <p class="prompt-note">This does not send a test email or enable InboxKit warmup.</p>
          <button class="button" type="submit">Load and enable Smartlead warmup</button>
        </form>`,
    );
  }

  return promptShell('Input needed', prompt.message || 'This job needs additional information.', '');
}

function promptShell(title, message, content) {
  return `
    <div class="prompt-heading">
      <span>!</span>
      <div><p class="eyebrow">Action required</p><h3>${escapeHtml(title)}</h3></div>
    </div>
    <p class="prompt-copy">${escapeHtml(message || '')}</p>
    ${content}`;
}

function wirePromptControls(job) {
  if (job.pendingPrompt?.type !== 'domain_approval') return;
  const form = promptBox.querySelector('form[data-prompt="domain_approval"]');
  const checkboxes = [...form.querySelectorAll('input[name="domains"]')];
  const recommended = new Set(job.pendingPrompt.recommendedDomains || []);

  for (const button of form.querySelectorAll('[data-domain-select]')) {
    button.addEventListener('click', () => {
      const mode = button.dataset.domainSelect;
      for (const checkbox of checkboxes) {
        checkbox.checked =
          mode === 'all' || (mode === 'recommended' && recommended.has(checkbox.value));
      }
      updateDomainApprovalSummary(form);
    });
  }
  for (const checkbox of checkboxes) {
    checkbox.addEventListener('change', () => updateDomainApprovalSummary(form));
  }
  updateDomainApprovalSummary(form);
}

function updateDomainApprovalSummary(form) {
  const selected = [...form.querySelectorAll('input[name="domains"]:checked')];
  const costCents = selected.reduce(
    (sum, checkbox) => sum + Number(checkbox.dataset.cost || 0),
    0,
  );
  const inboxes = selected.length * 4;
  form.querySelector('input[name="inboxCount"]').value = String(inboxes);
  const summary = form.querySelector('#domain-spend-summary');
  summary.innerHTML = `
    <strong>${selected.length} domains · ${inboxes} inboxes planned</strong>
    <span>Estimated Porkbun charge: ${costCents ? `$${(costCents / 100).toFixed(2)}` : 'price pending'}</span>`;
  const submit = form.querySelector('#domain-approve-button');
  submit.disabled = selected.length === 0;
}

function groupMailboxPlan(plan) {
  const grouped = new Map();
  for (const mailbox of plan) {
    const current = grouped.get(mailbox.domain) || {
      platform: mailbox.platform,
      names: [],
    };
    current.names.push(
      `${mailbox.firstName || ''} ${mailbox.lastName || ''}`.trim() || mailbox.username || 'Pending',
    );
    grouped.set(mailbox.domain, current);
  }
  return grouped;
}

function renderLog(logs) {
  logEl.innerHTML = '';
  for (const entry of [...logs].reverse().slice(0, 80)) {
    const li = document.createElement('li');
    li.innerHTML = `<time>${escapeHtml(formatDate(entry.at))}</time><span>${escapeHtml(entry.message)}</span>`;
    logEl.appendChild(li);
  }
}

function setSubmitting(submitting) {
  isSubmitting = submitting;
  const button = document.getElementById('wizard-submit');
  button.disabled = submitting;
  button.textContent = submitting ? 'Creating job…' : 'Create onboarding job';
}

function promptSuccessMessage(type) {
  if (type === 'domain_approval') return 'Domain purchase approved. Registration is starting.';
  if (type === 'mailbox_plan') return 'Mailbox purchase approved. Provisioning is starting.';
  if (type === 'smartlead_load') return 'Smartlead load approved. Warmup setup is starting.';
  return 'Information saved. The workflow is continuing.';
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `Request failed (${response.status})` };
  }
  return { response, data };
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function hostname(value) {
  try {
    return new URL(normalizeUrl(value)).hostname.replace(/^www\./, '');
  } catch {
    return value || 'Client';
  }
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function humanize(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function showMessage(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
}

function clearMessage(element) {
  element.textContent = '';
  element.classList.add('hidden');
}

function showToast(message, isError = false) {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast${isError ? ' error' : ''}`;
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 4000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

loadJobs();
const initialJobId = new URLSearchParams(location.search).get('job');
if (initialJobId) selectJob(initialJobId, false);
