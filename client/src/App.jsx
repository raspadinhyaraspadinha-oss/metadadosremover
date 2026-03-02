import { useEffect, useMemo, useRef, useState } from "react";

const ACCEPTED = ".jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.webm";

const DEFAULT_SETTINGS = {
  preserveQuality: true,
  removeEmbeddedThumbnails: true,
  normalizeOrientation: false,
  keepOriginalExtension: true,
  renameFiles: false,
  renamePrefix: "clean"
};

const statusLabel = {
  local: "na fila local",
  uploading: "enviando",
  queued: "fila",
  processing: "processando",
  ready: "pronto",
  error: "erro"
};

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const typeFromName = (name = "") => {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) return "imagem";
  if (["mp4", "mov", "webm"].includes(ext)) return "video";
  return "arquivo";
};

function LocalPreview({ file, name, isVideo }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) return undefined;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file) return <span>{isVideo ? "🎬" : "📄"}</span>;
  return <img src={url} alt={name} />;
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [batchId, setBatchId] = useState("");
  const [batchStatus, setBatchStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const globalProgress = useMemo(() => {
    if (batchStatus?.batch?.global_progress != null) return batchStatus.batch.global_progress;
    if (busy && files.length > 0) return uploadProgress;
    return 0;
  }, [batchStatus, busy, files.length, uploadProgress]);

  useEffect(() => {
    if (!batchId) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/batch/${batchId}`);
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error || "Falha ao buscar status do lote.");
          return;
        }
        setBatchStatus(payload);
        setFiles(payload.jobs);
      } catch {
        setError("Não foi possível atualizar o status. Verifique sua conexão.");
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [batchId]);

  const addLocalFiles = (selectedFiles) => {
    const next = [];
    for (const file of selectedFiles) {
      next.push({
        id: `local-${crypto.randomUUID()}`,
        localFile: file,
        original_name: file.name,
        size_before: file.size,
        mimetype: file.type,
        status: "local",
        progress: 0,
        created_at: new Date().toISOString()
      });
    }
    setFiles((prev) => [...prev, ...next]);
    setError("");
    setMessage("");
  };

  const onDrop = (event) => {
    event.preventDefault();
    if (event.dataTransfer.files?.length) {
      addLocalFiles(Array.from(event.dataTransfer.files));
    }
  };

  const onPickFiles = (event) => {
    addLocalFiles(Array.from(event.target.files || []));
    event.target.value = "";
  };

  const removeMetadata = () => {
    const local = files.filter((item) => item.localFile);
    if (local.length === 0) {
      setError("Adicione ao menos um arquivo antes de processar.");
      return;
    }

    const formData = new FormData();
    local.forEach((item) => {
      formData.append("files", item.localFile, item.localFile.name);
    });
    formData.append("options", JSON.stringify(settings));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/batch");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      setUploadProgress(Math.round((event.loaded / event.total) * 100));
      setFiles((prev) => prev.map((item) => ({ ...item, status: "uploading", progress: 5 })));
    };
    xhr.onloadstart = () => {
      setBusy(true);
      setError("");
      setMessage("Upload iniciado. Preparando fila...");
    };
    xhr.onerror = () => {
      setBusy(false);
      setError("Falha de rede durante upload.");
    };
    xhr.onload = () => {
      setBusy(false);
      const payload = xhr.response || {};
      if (xhr.status < 200 || xhr.status >= 300) {
        setError(payload.error || "Erro ao iniciar lote.");
        return;
      }
      setBatchId(payload.batch_id);
      setBatchStatus({ batch: { id: payload.batch_id }, jobs: payload.jobs });
      setFiles(payload.jobs);
      setMessage("Processamento em andamento.");
      setUploadProgress(100);
    };
    xhr.send(formData);
  };

  const clearList = () => {
    setFiles([]);
    setBatchId("");
    setBatchStatus(null);
    setUploadProgress(0);
    setMessage("");
    setError("");
  };

  const downloadAll = () => {
    if (!batchId) return;
    window.open(`/api/batch/${batchId}/download.zip`, "_blank");
  };

  const retryJob = async (jobId) => {
    try {
      const response = await fetch(`/api/job/${jobId}/retry`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Não foi possível reprocessar.");
        return;
      }
      setMessage("Job enviado para nova tentativa.");
    } catch {
      setError("Falha ao reenviar job.");
    }
  };

  const copyLink = async (jobId) => {
    try {
      const url = `${window.location.origin}/api/job/${jobId}/download`;
      await navigator.clipboard.writeText(url);
      setMessage("Link temporário copiado.");
    } catch {
      setError("Não foi possível copiar automaticamente. Tente novamente.");
    }
  };

  const readyCount = files.filter((f) => f.status === "ready").length;

  return (
    <main className="container">
      <h1>Remover metadados para criativos</h1>
      <p className="subtitle">Envie imagens e vídeos, remova metadados e baixe arquivos limpos na mesma qualidade.</p>

      <section
        className="dropzone"
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          hidden
          onChange={onPickFiles}
        />
        <p>Arraste e solte arquivos aqui ou toque para selecionar.</p>
        <span>Suporte: JPG, PNG, WEBP, HEIC, MP4, MOV, WEBM</span>
      </section>

      <button className="toggle" onClick={() => setSettingsOpen((prev) => !prev)}>
        {settingsOpen ? "Fechar configurações" : "Configurações seguras"}
      </button>
      {settingsOpen && (
        <section className="settings">
          <label>
            <input
              type="checkbox"
              checked={settings.preserveQuality}
              onChange={(event) => setSettings((prev) => ({ ...prev, preserveQuality: event.target.checked }))}
            />
            Preservar qualidade (sem recompressão)
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.removeEmbeddedThumbnails}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, removeEmbeddedThumbnails: event.target.checked }))
              }
            />
            Remover thumbnails embutidas
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.normalizeOrientation}
              onChange={(event) => setSettings((prev) => ({ ...prev, normalizeOrientation: event.target.checked }))}
            />
            Normalizar rotação/Orientação (altera somente tag, sem reencodar)
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.keepOriginalExtension}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, keepOriginalExtension: event.target.checked }))
              }
            />
            Manter extensão original
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.renameFiles}
              onChange={(event) => setSettings((prev) => ({ ...prev, renameFiles: event.target.checked }))}
            />
            Renomear arquivos (opcional)
          </label>
          {settings.renameFiles && (
            <input
              className="rename-input"
              value={settings.renamePrefix}
              onChange={(event) => setSettings((prev) => ({ ...prev, renamePrefix: event.target.value }))}
              placeholder="Prefixo, ex: tiktok"
            />
          )}
        </section>
      )}

      <section className="actions">
        <button onClick={removeMetadata} disabled={busy || files.length === 0}>
          Remover metadados
        </button>
        <button onClick={downloadAll} disabled={!batchId || readyCount === 0}>
          Baixar tudo (.zip)
        </button>
        <button onClick={clearList}>Limpar lista</button>
      </section>

      <section className="progress-card">
        <div className="progress-header">
          <strong>Progresso global</strong>
          <span>{globalProgress}%</span>
        </div>
        <progress value={globalProgress} max="100" />
      </section>

      {error && <p className="error">{error}</p>}
      {message && <p className="message">{message}</p>}

      {files.length === 0 ? (
        <section className="empty">
          <h3>Nenhum arquivo na fila</h3>
          <p>Adicione arquivos para começar a limpeza de metadados.</p>
        </section>
      ) : (
        <section className="list">
          {files.map((item) => {
            const itemProgress = item.progress ?? (item.status === "ready" ? 100 : item.status === "processing" ? 60 : 20);
            const isImage = item.mimetype?.startsWith("image/") && item.localFile;
            const isVideo = item.mimetype?.startsWith("video/");
            const sizeBefore = item.size_before ?? item.localFile?.size ?? 0;
            const sizeAfter = item.size_after;
            return (
              <article key={item.id} className="item">
                <div className="preview">
                  {isImage ? <LocalPreview file={item.localFile} name={item.original_name} isVideo={isVideo} /> : <span>{isVideo ? "🎬" : "📄"}</span>}
                </div>
                <div className="meta">
                  <h4>{item.original_name}</h4>
                  <p>
                    {formatBytes(sizeBefore)}
                    {sizeAfter != null && ` → ${formatBytes(sizeAfter)}`} | {typeFromName(item.original_name)}
                  </p>
                  <p>Status: {statusLabel[item.status] || item.status}</p>
                  {item.error && <p className="error-inline">{item.error}</p>}
                  <progress value={itemProgress} max="100" />
                </div>
                <div className="item-actions">
                  <button
                    disabled={item.status !== "ready"}
                    onClick={() => window.open(`/api/job/${item.id}/download`, "_blank")}
                  >
                    Baixar individual
                  </button>
                  <button disabled={item.status !== "ready"} onClick={() => copyLink(item.id)}>
                    Copiar link
                  </button>
                  <button disabled={item.status !== "error"} onClick={() => retryJob(item.id)}>
                    Retry
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
