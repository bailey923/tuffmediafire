
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const META_FILE = path.join(DATA_DIR, 'files.json');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, JSON.stringify([], null, 2));

function loadFiles() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveFiles(files) {
  fs.writeFileSync(META_FILE, JSON.stringify(files, null, 2));
}

function safeName(name) {
  return path
    .basename(name)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .slice(0, 180) || 'file';
}

function prettyBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function makeId() {
  return crypto.randomBytes(10).toString('hex');
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 200, // 200 MB
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/files', express.static(UPLOAD_DIR, {
  fallthrough: false,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.txt', '.mp4', '.mp3'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

app.get('/api/files', (_, res) => {
  const files = loadFiles().sort((a, b) => b.createdAt - a.createdAt);
  res.json(files);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const originalName = safeName(req.file.originalname);
  const id = makeId();
  const record = {
    id,
    originalName,
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    size: req.file.size,
    createdAt: Date.now(),
  };

  const files = loadFiles();
  files.push(record);
  saveFiles(files);

  res.json({
    ok: true,
    file: {
      id: record.id,
      name: record.originalName,
      size: record.size,
      prettySize: prettyBytes(record.size),
      downloadUrl: `/download/${record.id}`,
      viewUrl: `/files/${encodeURIComponent(record.storedName)}`,
    },
  });
});

app.get('/download/:id', (req, res) => {
  const file = loadFiles().find(f => f.id === req.params.id);
  if (!file) return res.status(404).send('File not found');

  const filePath = path.join(UPLOAD_DIR, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing from disk');

  res.download(filePath, file.originalName);
});

app.delete('/api/files/:id', (req, res) => {
  const files = loadFiles();
  const index = files.findIndex(f => f.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });

  const [file] = files.splice(index, 1);
  saveFiles(files);

  const filePath = path.join(UPLOAD_DIR, file.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  res.json({ ok: true });
});

app.get('/api/files/:id', (req, res) => {
  const file = loadFiles().find(f => f.id === req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });

  res.json({
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    prettySize: prettyBytes(file.size),
    createdAt: file.createdAt,
    downloadUrl: `/download/${file.id}`,
    viewUrl: `/files/${encodeURIComponent(file.storedName)}`,
  });
});

app.get('/', (_, res) => {
  res.type('html').send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CloudDrop Lite</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #121a33;
      --panel-2: #182241;
      --text: #e8eeff;
      --muted: #9fb0dd;
      --line: rgba(255,255,255,0.1);
      --accent: #5b8cff;
      --accent-2: #87a8ff;
      --danger: #ff6b6b;
      --ok: #21c98a;
      --shadow: 0 20px 60px rgba(0,0,0,.35);
      --radius: 22px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(circle at top, #162046 0%, var(--bg) 55%);
      color: var(--text);
      min-height: 100vh;
    }
    .wrap {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 18px 56px;
    }
    .hero {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 20px;
      align-items: stretch;
      margin-bottom: 20px;
    }
    .card {
      background: rgba(18,26,51,.86);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }
    .brand {
      padding: 28px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 20px;
      min-height: 260px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(91,140,255,.15);
      color: var(--accent-2);
      border: 1px solid rgba(91,140,255,.25);
      font-size: 13px;
      font-weight: 600;
    }
    h1 { margin: 0; font-size: clamp(2rem, 5vw, 4rem); line-height: 0.98; }
    .lead { margin: 0; color: var(--muted); max-width: 62ch; line-height: 1.55; }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .stat {
      padding: 16px;
      border-radius: 18px;
      background: rgba(255,255,255,.03);
      border: 1px solid var(--line);
    }
    .stat strong { display:block; font-size: 1.1rem; margin-bottom: 4px; }
    .stat span { color: var(--muted); font-size: .92rem; }
    .upload {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      justify-content: center;
    }
    .dropzone {
      border: 2px dashed rgba(135,168,255,.35);
      background: rgba(255,255,255,.03);
      border-radius: 20px;
      padding: 22px;
      text-align: center;
      transition: .2s ease;
    }
    .dropzone.dragover { transform: translateY(-2px); border-color: var(--accent); background: rgba(91,140,255,.12); }
    .dropzone h2 { margin: 6px 0 4px; font-size: 1.15rem; }
    .dropzone p { margin: 0; color: var(--muted); }
    input[type=file] { display: none; }
    .row { display:flex; gap: 10px; flex-wrap: wrap; }
    .btn {
      appearance: none;
      border: 0;
      cursor: pointer;
      border-radius: 14px;
      padding: 12px 16px;
      font-weight: 700;
      color: white;
      background: linear-gradient(135deg, var(--accent), #3456e8);
      box-shadow: 0 10px 30px rgba(91,140,255,.28);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      justify-content: center;
    }
    .btn.secondary {
      background: rgba(255,255,255,.06);
      box-shadow: none;
      border: 1px solid var(--line);
    }
    .btn.danger { background: rgba(255,107,107,.16); border: 1px solid rgba(255,107,107,.28); color: #ffd3d3; }
    .message { min-height: 22px; color: var(--muted); font-size: .95rem; }
    .panel {
      margin-top: 18px;
      padding: 20px;
    }
    .panel-head {
      display:flex; justify-content:space-between; align-items:end; gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
    }
    .panel-head h3 { margin: 0; font-size: 1.2rem; }
    .panel-head span { color: var(--muted); font-size: .95rem; }
    .files { display: grid; gap: 10px; }
    .file {
      display:grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 14px 14px;
      background: rgba(255,255,255,.03);
      border: 1px solid var(--line);
      border-radius: 18px;
    }
    .meta { min-width: 0; }
    .name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { color: var(--muted); font-size: .9rem; margin-top: 4px; }
    .actions { display:flex; gap: 8px; flex-wrap: wrap; justify-content: end; }
    .empty {
      padding: 28px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 18px;
      background: rgba(255,255,255,.02);
    }
    .footer { margin-top: 20px; color: var(--muted); font-size: .9rem; }
    @media (max-width: 860px) {
      .hero { grid-template-columns: 1fr; }
      .stats { grid-template-columns: 1fr; }
      .file { grid-template-columns: 1fr; }
      .actions { justify-content: start; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <section class="card brand">
        <div>
          <div class="badge">☁️ CloudDrop Lite</div>
          <h1>Upload files like a mini MediaFire clone.</h1>
          <p class="lead">A clean, simple file hosting site built with Node.js. Drop in files, share download links, and manage everything from one dashboard.</p>
        </div>
        <div class="stats" id="stats">
          <div class="stat"><strong id="count">0</strong><span>files stored</span></div>
          <div class="stat"><strong>200 MB</strong><span>max file size</span></div>
          <div class="stat"><strong>Node.js</strong><span>backend</span></div>
        </div>
      </section>

      <section class="card upload">
        <div class="dropzone" id="dropzone">
          <h2>Drag and drop a file</h2>
          <p>or choose one from your device</p>
        </div>
        <input id="fileInput" type="file" />
        <div class="row">
          <button class="btn" id="pickBtn">Choose file</button>
          <button class="btn secondary" id="uploadBtn">Upload</button>
        </div>
        <div class="message" id="message">Ready.</div>
      </section>
    </div>

    <section class="card panel">
      <div class="panel-head">
        <div>
          <h3>Recent uploads</h3>
          <span>Copy a link, download, or delete a file.</span>
        </div>
        <button class="btn secondary" id="refreshBtn">Refresh</button>
      </div>
      <div id="files" class="files"></div>
    </section>

    <div class="footer">Tip: this is a starter project. You can swap the JSON file store for MongoDB, PostgreSQL, S3, or Cloudflare R2 later.</div>
  </div>

  <script>
    const fileInput = document.getElementById('fileInput');
    const pickBtn = document.getElementById('pickBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const filesEl = document.getElementById('files');
    const messageEl = document.getElementById('message');
    const dropzone = document.getElementById('dropzone');
    const countEl = document.getElementById('count');

    let selectedFile = null;

    function setMessage(msg) {
      messageEl.textContent = msg;
    }

    function bytes(n) {
      if (n === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(n) / Math.log(1024));
      return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    function timeAgo(ts) {
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      if (hrs < 24) return hrs + 'h ago';
      return days + 'd ago';
    }

    async function loadFiles() {
      const res = await fetch('/api/files');
      const files = await res.json();
      countEl.textContent = files.length;

      if (!files.length) {
        filesEl.innerHTML = '<div class="empty">No files uploaded yet. Be the first one to drop something in ✨</div>';
        return;
      }

      filesEl.innerHTML = files.map(file => `
        <div class="file">
          <div class="meta">
            <div class="name" title="${file.originalName}">${file.originalName}</div>
            <div class="sub">${bytes(file.size)} • ${timeAgo(file.createdAt)} • ${file.mimeType || 'unknown type'}</div>
          </div>
          <div class="actions">
            <a class="btn secondary" href="/download/${file.id}">Download</a>
            <button class="btn secondary" data-copy="${location.origin}/download/${file.id}">Copy link</button>
            <button class="btn danger" data-delete="${file.id}">Delete</button>
          </div>
        </div>
      `).join('');

      document.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await navigator.clipboard.writeText(btn.dataset.copy);
          setMessage('Link copied to clipboard.');
          setTimeout(() => setMessage('Ready.'), 1500);
        });
      });

      document.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this file?')) return;
          const res = await fetch('/api/files/' + btn.dataset.delete, { method: 'DELETE' });
          if (!res.ok) {
            setMessage('Could not delete file.');
            return;
          }
          setMessage('Deleted.');
          await loadFiles();
          setTimeout(() => setMessage('Ready.'), 1200);
        });
      });
    }

    async function uploadSelected() {
      if (!selectedFile) {
        setMessage('Choose a file first.');
        return;
      }

      const form = new FormData();
      form.append('file', selectedFile);

      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';
      setMessage('Uploading ' + selectedFile.name + '...');

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        selectedFile = null;
        fileInput.value = '';
        setMessage('Uploaded: ' + data.file.name + '');
        await loadFiles();
      } catch (err) {
        setMessage(err.message || 'Upload failed');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload';
      }
    }

    pickBtn.addEventListener('click', () => fileInput.click());
    uploadBtn.addEventListener('click', uploadSelected);
    refreshBtn.addEventListener('click', loadFiles);

    fileInput.addEventListener('change', (e) => {
      selectedFile = e.target.files[0] || null;
      setMessage(selectedFile ? 'Selected: ' + selectedFile.name : 'Ready.');
    });

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        selectedFile = file;
        fileInput.files = e.dataTransfer.files;
        setMessage('Selected: ' + file.name);
      }
    });

    loadFiles();
  </script>
</body>
</html>
  `);
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Max size is 200 MB.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`CloudDrop Lite running at http://localhost:${PORT}`);
});
