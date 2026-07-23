const startForm = document.getElementById('start-form');
const jobPanel = document.getElementById('job-panel');
const promptBox = document.getElementById('prompt-box');
const logEl = document.getElementById('log');
const jobsEl = document.getElementById('jobs');
const metaGrid = document.getElementById('meta-grid');

let activeJobId = null;
let pollTimer = null;

startForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(startForm);
  const websiteUrl = String(fd.get('websiteUrl') || '').trim();
  const forwardToUrl = String(fd.get('forwardToUrl') || '').trim();
  const companyName = String(fd.get('companyName') || '').trim();
  const inboxRaw = String(fd.get('inboxCount') || '').trim();
  const googleRaw = String(fd.get('googleRatio') || '').trim();
  const body = { websiteUrl };
  if (forwardToUrl) body.forwardToUrl = forwardToUrl;
  if (companyName) body.companyName = companyName;
  if (inboxRaw) body.inboxCount = Number(inboxRaw);
  if (googleRaw) body.googleRatio = Number(googleRaw);

  const res = await fetch('/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to start');
    return;
  }
  selectJob(data.job.id);
});

document.getElementById('refresh-jobs').addEventListener('click', loadJobs);

async function loadJobs() {
  const res = await fetch('/api/jobs');
  const data = await res.json();
  jobsEl.innerHTML = '';
  for (const job of data.jobs || []) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="sub">${job.id} · ${job.status}</span>${job.clientName || job.websiteUrl}`;
    li.addEventListener('click', () => selectJob(job.id));
    jobsEl.appendChild(li);
  }
}

function selectJob(id) {
  activeJobId = id;
  jobPanel.classList.remove('hidden');
  refreshJob();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshJob, 2500);
}

async function refreshJob() {
  if (!activeJobId) return;
  const res = await fetch(`/api/jobs/${activeJobId}`);
  if (!res.ok) return;
  const { job } = await res.json();
  renderJob(job);
}

function renderJob(job) {
  document.getElementById('job-id').textContent = job.id;
  document.getElementById('client-name').textContent =
    job.brand?.clientName || job.websiteUrl;
  const status = document.getElementById('job-status');
  status.textContent = job.status;
  status.className = 'status';
  if (job.pendingPrompt) status.classList.add('awaiting');
  if (job.status === 'failed') status.classList.add('failed');
  if (job.status === 'completed') status.classList.add('completed');

  <meta-grid.innerHTML = [
    ['Website', job.websiteUrl],
    ['Forward to', job.forwardToUrl || job.websiteUrl],
    ['Company (sig)', job.companyName || job.brand?.clientName || '—'],
    ['Domains registered', String(job.registeredDomains?.length || 0)],
    ['Mailboxes', String(job.mailboxes?.length || 0)],
    ['Expected', String(job.expectedMailboxCount || '—')],
    ['Smartlead client', job.smartleadClientId || '—'],
    ['InboxKit workspace', job.inboxkitWorkspaceId || '—'],
  ]
    .map(
      ([k, v]) => `<div><span>${k}</span><strong>${escapeHtml(String(v))}</strong></div>`,
    )
    .join('');

  if (job.pendingPrompt) {
    promptBox.classList.remove('hidden');
    promptBox.innerHTML = renderPrompt(job);
    const form = promptBox.querySelector('form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      const res = await fetch(`/api/jobs/${job.id}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to submit answers');
        return;
      }
      renderJob(data.job);
    });
  } else {
    promptBox.classList.add('hidden');
    promptBox.innerHTML = '';
  }

  logEl.innerHTML = '';
  for (const entry of [...(job.logs || [])].reverse().slice(0, 80)) {
    const li = document.createElement('li');
    li.innerHTML = `<time>${escapeHtml(entry.at)}</time>${escapeHtml(entry.message)}`;
    logEl.appendChild(li);
  }
}

function renderPrompt(job) {
  if (job.pendingPrompt.type === 'porkbun_credentials') {
    return `
      <p><strong>Porkbun credentials needed</strong></p>
      <p>${escapeHtml(job.pendingPrompt.message)}</p>
      <form>
        <label>Label (optional)<input name="porkbunLabel" placeholder="Main account" /></label>
        <label>API key<input name="porkbunApiKey" required autocomplete="off" /></label>
        <label>Secret API key<input name="porkbunSecretApiKey" required autocomplete="off" /></label>
        <button type="submit">Register domains</button>
      </form>`;
  }
  if (job.pendingPrompt.type === 'inboxkit_workspace') {
    return `
      <p><strong>InboxKit workspace ID needed</strong></p>
      <p>${escapeHtml(job.pendingPrompt.message)}</p>
      <p class="hint">${escapeHtml(job.pendingPrompt.reason || '')}</p>
      <form>
        <label>Workspace ID<input name="inboxkitWorkspaceId" required autocomplete="off" /></label>
        <button type="submit">Continue</button>
      </form>`;
  }
  return `<p>${escapeHtml(JSON.stringify(job.pendingPrompt))}</p>`;
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

loadJobs();
