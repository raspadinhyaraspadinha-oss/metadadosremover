const batchesEl = document.getElementById("batches");
const jobsEl = document.getElementById("jobs");
const batchSelect = document.getElementById("batchSelect");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const loadBatchBtn = document.getElementById("loadBatch");

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const escape = (s = "") =>
  String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[m]);

async function loadBatches() {
  statusEl.textContent = "Carregando lotes...";
  const response = await fetch("/api/admin/batches?limit=150");
  const payload = await response.json();
  if (!response.ok) {
    statusEl.textContent = payload.error || "Falha ao carregar lotes";
    return;
  }
  const items = payload.batches || [];
  batchSelect.innerHTML = items
    .map((item) => `<option value="${item.batch.id}">${item.batch.id} (${item.counts.total} arquivos)</option>`)
    .join("");

  if (!items.length) {
    batchesEl.innerHTML = "<p class='muted'>Nenhum lote registrado.</p>";
    statusEl.textContent = "Sem lotes.";
    jobsEl.innerHTML = "";
    return;
  }

  batchesEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>batch_id</th>
          <th>Criado em</th>
          <th>IP origem</th>
          <th>Arquivos</th>
          <th>Prontos</th>
          <th>Erros</th>
          <th>Expira em</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `
          <tr>
            <td><code>${escape(item.batch.id)}</code></td>
            <td>${new Date(item.batch.created_at).toLocaleString()}</td>
            <td>${escape(item.batch.source_ip || "-")}</td>
            <td>${item.counts.total}</td>
            <td class="ok">${item.counts.ready || 0}</td>
            <td class="err">${item.counts.error || 0}</td>
            <td>${new Date(item.batch.expires_at).toLocaleString()}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
  statusEl.textContent = `${items.length} lote(s) carregado(s).`;
}

async function loadBatchDetails(batchId) {
  if (!batchId) return;
  statusEl.textContent = "Carregando arquivos do lote...";
  const response = await fetch(`/api/admin/batch/${batchId}`);
  const payload = await response.json();
  if (!response.ok) {
    statusEl.textContent = payload.error || "Falha ao carregar lote.";
    return;
  }
  const jobs = payload.jobs || [];
  if (!jobs.length) {
    jobsEl.innerHTML = "<p class='muted'>Este lote não possui arquivos.</p>";
    return;
  }

  jobsEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>job_id</th>
          <th>Arquivo</th>
          <th>Status</th>
          <th>Tipo</th>
          <th>Tamanho (antes/depois)</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${jobs
          .map(
            (job) => `
          <tr>
            <td><code>${escape(job.id)}</code></td>
            <td>${escape(job.original_name)}</td>
            <td>${escape(job.status)}</td>
            <td>${escape(job.mimetype || "-")}</td>
            <td>${formatBytes(job.size_before || 0)} / ${job.size_after ? formatBytes(job.size_after) : "-"}</td>
            <td>
              <a href="/api/admin/job/${job.id}/original" target="_blank">Baixar original</a>
              ${job.status === "ready" ? ` | <a href="/api/admin/job/${job.id}/clean" target="_blank">Baixar limpo</a>` : ""}
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
  statusEl.textContent = `Lote ${batchId} carregado (${jobs.length} arquivo(s)).`;
}

refreshBtn.addEventListener("click", () => {
  loadBatches().catch((err) => {
    statusEl.textContent = err.message;
  });
});

loadBatchBtn.addEventListener("click", () => {
  loadBatchDetails(batchSelect.value).catch((err) => {
    statusEl.textContent = err.message;
  });
});

loadBatches()
  .then(() => {
    if (batchSelect.value) return loadBatchDetails(batchSelect.value);
    return null;
  })
  .catch((err) => {
    statusEl.textContent = err.message;
  });
