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
  const body = {
    websiteUrl,
    manualApproval: fd.get('manualApproval') === 'on' || fd.get('manualApproval') === 'true',
  };
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

  metaGrid.innerHTML = [
    ['Website', job.websiteUrl],
    ['Forward to', job.forwardToUrl || job.websiteUrl],
    ['Company (sig)', job.companyName || job.brand?.clientName || '—'],
    ['Approvals', job.manualApproval ? 'on' : 'off'],
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
      const body = {};
      for (const [key, value] of fd.entries()) {
        if (key === 'domains') {
          if (!body.domains) body.domains = [];
          body.domains.push(String(value));
        } else {
          body[key] = value;
        }
      }
      if (body.approved != null) body.approved = true;
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
  const prompt = job.pendingPrompt;
  if (prompt.type === 'porkbun_credentials') {
    return `
      <p><strong>Porkbun credentials needed</strong></p>
      <p>${escapeHtml(prompt.message)}</p>
      <form>
        <label>Label (optional)<input name="porkbunLabel" placeholder="Main account" /></label>
        <label>API key<input name="porkbunApiKey" required autocomplete="off" /></label>
        <label>Secret API key<input name="porkbunSecretApiKey" required autocomplete="off" /></label>
        <button type="submit">Continue</button>
      </form>`;
  }
  if (prompt.type === 'domain_approval') {
    const domains = prompt.availableDomains || [];
    const preselect = Math.min(domains.length, 4);
    const rows = domains
      .map((d, i) => {
        const price =
          d.costCents != null ? `$${(d.costCents / 100).toFixed(2)}` : 'price TBD';
        const checked = i < preselect ? 'checked' : '';
        return `<label class="check-row"><input type="checkbox" name="domains" value="${escapeHtml(
          d.domain,
        )}" ${checked} /><span>${escapeHtml(d.domain)}</span><em>${price}</em></label>`;
      })
      .join('');
    return `
      <p><strong>Approve domains &amp; inbox plan</strong></p>
      <p>${escapeHtml(prompt.message)}</p>
      <form>
        <div class="domain-list">${rows}</div>
        <div class="row">
          <label>Inbox count<input name="inboxCount" type="number" min="1" value="${
            prompt.suggestedInboxCount || domains.length
          }" /></label>
          <label>Google share (0–1)<input name="googleRatio" type="number" min="0" max="1" step="0.01" value="${
            prompt.suggestedGoogleRatio ?? 0.67
          }" /></label>
        </div>
        <label>Company (sig line 2)<input name="companyName" value="${escapeHtml(
          job.companyName || job.brand?.clientName || '',
        )}" /></label>
        <button type="submit">Register selected domains</button>
      </form>`;
  }
  if (prompt.type === 'mailbox_plan') {
    const rows = (prompt.plan || [])
      .map(
        (p) =>
          `<li><code>${escapeHtml(p.domain)}</code> → ${escapeHtml(p.platform)}</li>`,
      )
      .join('');
    return `
      <p><strong>Approve mailbox order</strong></p>
      <p>${escapeHtml(prompt.message)}</p>
      <p class="hint">${prompt.googleCount || 0} Google · ${prompt.microsoftCount || 0} Microsoft · ${
        (prompt.plan || []).length
      } total</p>
      <ul class="plan-list">${rows}</ul>
      <form>
        <input type="hidden" name="approved" value="true" />
        <button type="submit">Buy mailboxes</button>
      </form>`;
  }
  if (prompt.type === 'smartlead_load') {
    const samples = (prompt.sampleSignatures || [])
      .map((s) => `<pre class="sig">${escapeHtml(s)}</pre>`)
      .join('');
    return `
      <p><strong>Approve Smartlead load</strong></p>
      <p>${escapeHtml(prompt.message)}</p>
      <p class="hint">${prompt.mailboxCount || 0} active mailboxes · warmup on</p>
      ${samples}
      <form>
        <input type="hidden" name="approved" value="true" />
        <button type="submit">Load into Smartlead</button>
      </form>`;
  }
  if (prompt.type === 'inboxkit_workspace') {
    return `
      <p><strong>InboxKit workspace ID needed</strong></p>
      <p>${escapeHtml(prompt.message)}</p>
      <p class="hint">${escapeHtml(prompt.reason || '')}</p>
      <form>
        <label>Workspace ID<input name="inboxkitWorkspaceId" required autocomplete="off" /></label>
        <button type="submit">Continue</button>
      </form>`;
  }
  return `<p>${escapeHtml(JSON.stringify(prompt))}</p>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

loadJobs();
