# MetaDados Remover

Serviço web full-stack para remover metadados de imagens e vídeos voltado para criativos (TikTok Ads), reduzindo risco de reprovação por metadata.

## Stack escolhida (e por quê)

- `Express + React (Vite)` em um único serviço Node: deploy simples na Railway.
- `busboy`: upload por streaming, sem carregar tudo na RAM.
- `exiftool`: remove EXIF/XMP/IPTC de imagens sem recompressão.
- `ffmpeg`: remove metadata de vídeo com `-map_metadata -1` e `-c copy` (sem re-encode).
- `archiver`: download em lote via ZIP.
- Fila simples com concorrência configurável + persistência leve em JSON (`storage/data/store.json`).

## Recursos implementados

- Drag & drop + multi-upload.
- Lista de arquivos com preview/ícone, tamanho, tipo e status.
- Progresso por arquivo + global.
- Configurações colapsáveis:
  - Preservar qualidade (ON por padrão)
  - Remover thumbnails embutidas (ON)
  - Normalizar rotação/orientação (OFF por padrão)
  - Manter extensão original (ON)
  - Renomear arquivos (OFF)
- Endpoints:
  - `POST /api/batch`
  - `GET /api/batch/:batch_id`
  - `GET /api/job/:job_id/download`
  - `GET /api/batch/:batch_id/download.zip`
  - `POST /api/job/:job_id/retry`
- Limites por `.env` (arquivo e lote), rate limit, sanitização de nomes e cleanup automático por TTL.
- Sem armazenamento permanente: arquivos expiram e são limpos.
- Dashboard privado em `/admin` com autenticação Basic (`ADMIN_USER`/`ADMIN_PASSWORD`) para ver uploads e baixar original/limpo.

## Estrutura de pastas

```text
.
├── client/
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       └── styles.css
├── server/
│   ├── public/
│   │   └── admin.html
│   ├── cleanup.js
│   ├── config.js
│   ├── index.js
│   ├── processor.js
│   ├── store.js
│   └── utils.js
├── storage/            # criado em runtime
├── .env.example
├── Dockerfile
├── package.json
├── vite.config.js
└── README.md
```

## Setup local

### 1) Pré-requisitos

- Node.js 20+
- `ffmpeg` instalado no sistema
- `exiftool` instalado no sistema

#### Windows (PowerShell)

```powershell
winget install Gyan.FFmpeg
winget install OliverBetz.ExifTool
```

### 2) Instalar e rodar

```bash
npm install
cp .env.example .env
npm run dev
```

- Front: `http://localhost:5173`
- API: `http://localhost:3000`

## Variáveis de ambiente

Veja `.env.example`. Principais:

- `PORT`
- `BASE_URL`
- `MAX_FILE_SIZE_MB`
- `MAX_BATCH_SIZE_MB`
- `MAX_FILES_PER_BATCH`
- `PROCESS_TIMEOUT_MS`
- `JOB_CONCURRENCY`
- `TEMP_TTL_MINUTES`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `ADMIN_USER`
- `ADMIN_PASSWORD`

## Dashboard privado (somente você)

Configure no `.env`:

```env
ADMIN_USER=seu-usuario
ADMIN_PASSWORD=sua-senha-forte
```

Acesse:

- `http://localhost:3000/admin`

O navegador pedirá usuário/senha via HTTP Basic Auth. Nesse painel você consegue:

- Ver lotes recentes (batch_id, IP de origem, criação, expiração, status).
- Ver arquivos de um lote (job_id, nome, tipo, tamanho antes/depois, status).
- Baixar **arquivo original** enviado.
- Baixar **arquivo limpo** (quando pronto).

## Deploy na Railway

### Opção recomendada: Dockerfile

1. Suba este projeto para GitHub.
2. No Railway: New Project > Deploy from GitHub.
3. Railway detecta `Dockerfile` automaticamente.
4. Configure variáveis de ambiente (copie de `.env.example`).
5. Defina `PORT` (Railway injeta automaticamente; app já respeita).
6. Deploy.

## API (resumo)

### `POST /api/batch`

- `multipart/form-data`
- Campo `files` (múltiplos)
- Campo `options` (JSON string)

Resposta:

```json
{
  "batch_id": "uuid",
  "status": "processing",
  "jobs": []
}
```

### `GET /api/batch/:batch_id`

Retorna status de todos os jobs do batch e progresso global.

### Rotas admin (protegidas por Basic Auth)

- `GET /api/admin/batches`
- `GET /api/admin/batch/:batch_id`
- `GET /api/admin/job/:job_id/original`
- `GET /api/admin/job/:job_id/clean`

### `GET /api/job/:job_id/download`

Download individual do arquivo limpo.

### `GET /api/batch/:batch_id/download.zip`

ZIP com todos os arquivos prontos do lote.

## Como testar (obrigatório)

1. Suba o app local.
2. Faça upload de **5 imagens** (`jpg/png/webp`) e **3 vídeos** (`mp4/mov/webm`).
3. Aguarde status `ready`.
4. Baixe individual e via ZIP.
5. Confirme que todos abrem normalmente.

### Verificação de metadata (comandos)

#### Antes/depois em imagens e vídeos

```bash
exiftool arquivo_original.jpg
exiftool arquivo_limpo.jpg
```

```bash
exiftool video_original.mp4
exiftool video_limpo.mp4
```

```bash
ffprobe -hide_banner -show_format -show_streams video_limpo.mp4
```

Esperado:

- Campos sensíveis (GPS, autor, câmera, etc.) ausentes ou reduzidos.
- Vídeo e áudio preservados sem re-encode (`-c copy`).
- Tamanho pode variar levemente.

## Observações de qualidade

- Imagens: limpeza via `exiftool -all=` em cópia do arquivo (sem recompressão).
- Vídeos: `ffmpeg -map_metadata -1 -c copy`.
- `normalizeOrientation` altera somente tag de orientação para imagens (não rotaciona pixels).

## Segurança e confiabilidade

- Upload streaming com limites por arquivo e por lote.
- Sanitização de nomes de arquivos.
- Rate limit de API.
- Timeout por job.
- Retry manual de jobs com erro.
- Limpeza automática de arquivos temporários após TTL.
