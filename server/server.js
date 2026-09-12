// ==========================================================================
// Sale Self-Learning App — Express backend (ES modules)
// API: kỹ năng/giáo trình, thư viện, proxy ChatGPT, insight
// ==========================================================================
import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// ---- Gia cố chống crash-loop: 1 lỗi request KHÔNG được làm sập tiến trình ----
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SEED_DIR = path.join(__dirname, 'data'); // bản seed đi kèm source
// DATA_DIR có thể trỏ ra ổ đĩa ngoài (Render Disk). Mặc định = server/data.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : SEED_DIR;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const SKILLS_FILE = path.join(DATA_DIR, 'skills.json');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ---- Bảo đảm thư mục & tự copy seed khi DATA_DIR là ổ ngoài (lần đầu trống) ----
function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const seedIfMissing = (target, seedName) => {
    if (!fs.existsSync(target)) {
      const seed = path.join(SEED_DIR, seedName);
      if (fs.existsSync(seed) && path.resolve(seed) !== path.resolve(target)) {
        fs.copyFileSync(seed, target);
        console.log(`[seed] Copied ${seedName} -> ${target}`);
      }
    }
  };
  seedIfMissing(SKILLS_FILE, 'skills.json');
  seedIfMissing(LIBRARY_FILE, 'library.json');
  seedIfMissing(TEMPLATES_FILE, 'templates.json');
}
ensureDataDir();

// ---- Helpers đọc/ghi JSON an toàn ----
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[readJSON] ${file}:`, e.message);
    return fallback;
  }
}
function writeJSONLocal(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function writeJSON(file, data) {
  writeJSONLocal(file, data);
  mirrorKV(file, data); // đồng bộ lên MongoDB (nếu bật)
}
function readSkills() {
  return readJSON(SKILLS_FILE, { meta: {}, skills: [] });
}
function readLibrary() {
  return readJSON(LIBRARY_FILE, { resources: [] });
}
function readTemplates() {
  return readJSON(TEMPLATES_FILE, { templates: [] });
}
function readSettings() {
  return readJSON(SETTINGS_FILE, {});
}
function getOpenAIConfig() {
  const s = readSettings();
  const apiKey = (s.apiKey || process.env.OPENAI_API_KEY || '').trim();
  const model = (s.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  return { apiKey, model };
}
// ==========================================================================
// CLOUD: MongoDB (tuỳ chọn, bật bằng env MONGODB_URI) + Google Sheets webhook
//  - Không đặt MONGODB_URI → app chạy y như cũ (chỉ file JSON).
//  - Có MONGODB_URI → dữ liệu skills/library/templates + file ảnh/PDF được
//    đồng bộ lên Mongo → bền vững, không mất khi host reset/refresh.
// ==========================================================================
const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const MONGODB_DB = (process.env.MONGODB_DB || 'learnsale').trim();
let mdb = null, mkv = null, mfiles = null;
const FILE_KEYS = { [SKILLS_FILE]: 'skills', [LIBRARY_FILE]: 'library', [TEMPLATES_FILE]: 'templates' };

async function initMongo() {
  if (!MONGODB_URI) { console.log('[mongo] MONGODB_URI chưa đặt → dùng file JSON.'); return; }
  try {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    mdb = client.db(MONGODB_DB);
    mkv = mdb.collection('kv');
    mfiles = mdb.collection('files');
    await hydrateFromMongo();
    console.log(`[mongo] ✅ Đã kết nối & đồng bộ DB "${MONGODB_DB}".`);
  } catch (e) {
    console.error('[mongo] ❌ Kết nối thất bại, quay về file JSON:', e.message);
    mdb = mkv = mfiles = null;
  }
}
// Khi khởi động: nạp dữ liệu từ Mongo xuống file (nguồn sự thật là Mongo nếu có)
async function hydrateFromMongo() {
  for (const [file, key] of Object.entries(FILE_KEYS)) {
    const doc = await mkv.findOne({ _id: key });
    if (doc && doc.data) writeJSONLocal(file, doc.data);
    else await mkv.replaceOne({ _id: key }, { _id: key, data: readJSON(file, {}) }, { upsert: true });
  }
}
function mirrorKV(file, data) {
  if (!mkv) return;
  const key = FILE_KEYS[file];
  if (!key) return;
  mkv.replaceOne({ _id: key }, { _id: key, data }, { upsert: true }).catch((e) => console.error('[mongo mirrorKV]', e.message));
}
async function mirrorFile(filename, title, mimetype, absPath) {
  if (!mfiles) return;
  try {
    const b64 = fs.readFileSync(absPath).toString('base64');
    await mfiles.replaceOne({ _id: filename }, { _id: filename, title: title || filename, mimetype: mimetype || '', data: b64, createdAt: new Date().toISOString() }, { upsert: true });
  } catch (e) { console.error('[mongo mirrorFile]', e.message); }
}
function removeMongoFile(filename) {
  if (!mfiles || !filename) return;
  mfiles.deleteOne({ _id: path.basename(filename) }).catch(() => {});
}

// ---- Google Sheets qua Apps Script webhook ----
function getSheetsWebhook() {
  const s = readSettings();
  return (s.sheetsWebhook || process.env.SHEETS_WEBHOOK_URL || '').trim();
}
async function pushToSheet(resources) {
  const url = getSheetsWebhook();
  if (!url) return { ok: false, skipped: true };
  const rows = (resources || []).map((r) => ({
    id: r.id, title: r.title || '', type: r.type || '', url: r.url || '',
    tags: (r.tags || []).join(', '), skillId: r.skillId || '',
    note: String(r.note || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '[ảnh]').slice(0, 800),
    createdAt: r.createdAt || '',
  }));
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
  return { ok: resp.ok, status: resp.status };
}
const syncSheetSafe = (resources) => { pushToSheet(resources).catch((e) => console.error('[sheets]', e.message)); };

const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const slugify = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || uid('skill');

// ---- App ----
const app = express();
app.use(express.json({ limit: '2mb' }));

// Multer: upload ảnh/PDF ≤ 50MB
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uid('file')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/|application\/pdf/.test(file.mimetype);
    cb(ok ? null : new Error('Chỉ chấp nhận ảnh hoặc PDF / Only images or PDF'), ok);
  },
});

// ==========================================================================
// API: SKILLS / GIÁO TRÌNH
// ==========================================================================
app.get('/api/skills', (req, res) => {
  res.json(readSkills());
});

app.post('/api/skills', (req, res) => {
  const { name_vi, name_en, icon, summary } = req.body || {};
  if (!name_vi && !name_en) {
    return res.status(400).json({ error: 'Cần name_vi hoặc name_en' });
  }
  const data = readSkills();
  const base = slugify(name_en || name_vi);
  let id = base;
  let i = 1;
  while (data.skills.some((s) => s.id === id)) id = `${base}-${i++}`;
  const skill = {
    id,
    icon: icon || '📌',
    name_vi: name_vi || name_en,
    name_en: name_en || name_vi,
    summary: summary || '',
    builtin: false,
    lessons: [],
  };
  data.skills.push(skill);
  writeJSON(SKILLS_FILE, data);
  res.status(201).json(skill);
});

app.delete('/api/skills/:id', (req, res) => {
  const { id } = req.params;
  const data = readSkills();
  const skill = data.skills.find((s) => s.id === id);
  if (!skill) return res.status(404).json({ error: 'Không tìm thấy kỹ năng' });
  if (skill.builtin) return res.status(403).json({ error: 'Không thể xóa kỹ năng mặc định' });
  data.skills = data.skills.filter((s) => s.id !== id);
  writeJSON(SKILLS_FILE, data);
  // Xóa tài liệu thuộc kỹ năng này (kèm file upload)
  const lib = readLibrary();
  const remove = lib.resources.filter((r) => r.skillId === id);
  remove.forEach((r) => deleteUploadFile(r.file));
  lib.resources = lib.resources.filter((r) => r.skillId !== id);
  writeJSON(LIBRARY_FILE, lib);
  res.json({ ok: true });
});

// Thêm bài học
app.post('/api/skills/:id/lessons', (req, res) => {
  const { id } = req.params;
  const { title_vi, title_en, objective, blocks } = req.body || {};
  const data = readSkills();
  const skill = data.skills.find((s) => s.id === id);
  if (!skill) return res.status(404).json({ error: 'Không tìm thấy kỹ năng' });
  const lesson = {
    id: uid('lesson'),
    title_vi: title_vi || title_en || 'Bài học mới',
    title_en: title_en || title_vi || 'New lesson',
    objective: objective || '',
    blocks: Array.isArray(blocks) ? blocks : [],
  };
  skill.lessons.push(lesson);
  writeJSON(SKILLS_FILE, data);
  res.status(201).json(lesson);
});

// Xóa bài học
app.delete('/api/skills/:id/lessons/:lessonId', (req, res) => {
  const { id, lessonId } = req.params;
  const data = readSkills();
  const skill = data.skills.find((s) => s.id === id);
  if (!skill) return res.status(404).json({ error: 'Không tìm thấy kỹ năng' });
  const before = skill.lessons.length;
  skill.lessons = skill.lessons.filter((l) => l.id !== lessonId);
  if (skill.lessons.length === before)
    return res.status(404).json({ error: 'Không tìm thấy bài học' });
  writeJSON(SKILLS_FILE, data);
  res.json({ ok: true });
});

// ==========================================================================
// API: RESOURCES / THƯ VIỆN
// ==========================================================================
function deleteUploadFile(file) {
  if (!file) return;
  const name = path.basename(file); // an toàn, tránh path traversal
  const p = path.join(UPLOADS_DIR, name);
  fs.promises.unlink(p).catch(() => {});
}

app.get('/api/resources', (req, res) => {
  const { skill, type, q } = req.query;
  let list = readLibrary().resources;
  if (skill) list = list.filter((r) => r.skillId === skill);
  if (type) list = list.filter((r) => r.type === type);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((r) =>
      [r.title, r.note, r.url, (r.tags || []).join(' ')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }
  res.json({ resources: list });
});

// Thêm text/youtube/facebook/link
app.post('/api/resources', (req, res) => {
  const { skillId, type, title, url, note, tags } = req.body || {};
  if (!type) return res.status(400).json({ error: 'Thiếu type' });
  const lib = readLibrary();
  const resource = {
    id: uid('res'),
    skillId: skillId || null,
    type,
    title: title || url || 'Tài liệu',
    url: url || '',
    note: note || '',
    tags: normalizeTags(tags),
    file: null,
    createdAt: new Date().toISOString(),
  };
  lib.resources.push(resource);
  writeJSON(LIBRARY_FILE, lib);
  syncSheetSafe([resource]); // đẩy lên Google Sheets (nếu cấu hình)
  res.status(201).json(resource);
});

// Upload ảnh/PDF
app.post('/api/resources/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file' });
  const { skillId, title, note, tags } = req.body || {};
  const type = /pdf/.test(req.file.mimetype) ? 'pdf' : 'image';
  await mirrorFile(req.file.filename, title || req.file.originalname, req.file.mimetype, path.join(UPLOADS_DIR, req.file.filename));
  const lib = readLibrary();
  const resource = {
    id: uid('res'),
    skillId: skillId || null,
    type,
    title: title || req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    note: note || '',
    tags: normalizeTags(tags),
    file: req.file.filename,
    createdAt: new Date().toISOString(),
  };
  lib.resources.push(resource);
  writeJSON(LIBRARY_FILE, lib);
  syncSheetSafe([resource]);
  res.status(201).json(resource);
});

// Upload nhiều ảnh cùng lúc để NHÚNG vào nội dung (không tạo resource) → trả danh sách URL
app.post('/api/upload', upload.array('files', 30), async (req, res) => {
  for (const f of (req.files || [])) await mirrorFile(f.filename, f.originalname, f.mimetype, path.join(UPLOADS_DIR, f.filename));
  const files = (req.files || []).map((f) => ({ url: `/uploads/${f.filename}`, name: f.originalname }));
  res.status(201).json({ files });
});

app.delete('/api/resources/:id', (req, res) => {
  const { id } = req.params;
  const lib = readLibrary();
  const r = lib.resources.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
  deleteUploadFile(r.file);
  removeMongoFile(r.file);
  lib.resources = lib.resources.filter((x) => x.id !== id);
  writeJSON(LIBRARY_FILE, lib);
  res.json({ ok: true });
});

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string')
    return tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

// ==========================================================================
// API: SETTINGS (OpenAI key + model). Key chỉ lưu local (server/data).
// ==========================================================================
app.get('/api/settings', (req, res) => {
  const s = readSettings();
  const envKey = (process.env.OPENAI_API_KEY || '').trim();
  res.json({
    model: s.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    hasKey: Boolean((s.apiKey || envKey || '').trim()),
    keyFromEnv: Boolean(envKey) && !s.apiKey,
    sheetsWebhook: s.sheetsWebhook || '',
    hasSheets: Boolean(getSheetsWebhook()),
    mongo: Boolean(mdb),
  });
});

app.post('/api/settings', (req, res) => {
  const { apiKey, model, sheetsWebhook } = req.body || {};
  const s = readSettings();
  if (typeof apiKey === 'string') s.apiKey = apiKey.trim();
  if (typeof model === 'string' && model.trim()) s.model = model.trim();
  if (typeof sheetsWebhook === 'string') s.sheetsWebhook = sheetsWebhook.trim();
  writeJSON(SETTINGS_FILE, s);
  res.json({
    model: s.model || 'gpt-4o-mini',
    hasKey: Boolean((s.apiKey || process.env.OPENAI_API_KEY || '').trim()),
    hasSheets: Boolean(getSheetsWebhook()),
    mongo: Boolean(mdb),
  });
});

// Đồng bộ toàn bộ thư viện lên Google Sheets
app.post('/api/sheets/sync', async (req, res) => {
  if (!getSheetsWebhook()) return res.json({ ok: false, error: 'no_webhook', message: 'Chưa cấu hình Google Sheets webhook. Vào ⚙️ Cài đặt để thêm.' });
  try {
    const lib = readLibrary();
    const out = await pushToSheet(lib.resources);
    res.json({ ok: out.ok, count: lib.resources.length });
  } catch (e) {
    res.status(200).json({ ok: false, error: 'sync_error', message: e.message });
  }
});
app.get('/api/sheets/status', (req, res) => res.json({ configured: Boolean(getSheetsWebhook()), mongo: Boolean(mdb) }));

// ==========================================================================
// AI: CHAT (proxy ChatGPT) + INSIGHT
// ==========================================================================
const NO_KEY_MSG = 'Chưa cấu hình OpenAI API key. Vào ⚙️ Cài đặt để thêm.';
const SUBJECT = 'Sale (Bán hàng / Thương mại)';

async function callChatCompletions({ apiKey, model, messages, temperature = 0.5 }) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI ${r.status}`);
  return { text: data.choices?.[0]?.message?.content?.trim() || '', citations: [] };
}

async function callResponsesWebSearch({ apiKey, model, input, instructions }) {
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      tools: [{ type: 'web_search' }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI ${r.status}`);

  // Trích text + url_citation từ Responses API
  let text = data.output_text || '';
  const citations = [];
  if (!text && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text') {
            text += c.text || '';
            for (const ann of c.annotations || []) {
              if (ann.type === 'url_citation') {
                citations.push({ url: ann.url, title: ann.title || ann.url });
              }
            }
          }
        }
      }
    }
  } else if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          for (const ann of c.annotations || []) {
            if (ann.type === 'url_citation') citations.push({ url: ann.url, title: ann.title || ann.url });
          }
        }
      }
    }
  }
  return { text: text.trim(), citations };
}

app.post('/api/chat', async (req, res) => {
  const { apiKey, model } = getOpenAIConfig();
  if (!apiKey) return res.status(200).json({ reply: NO_KEY_MSG, citations: [], error: 'no_key' });

  const { message, context, webSearch, history } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Thiếu message' });

  const system = `Bạn là COACH chuyên môn ${SUBJECT}. Luôn trả lời bằng TIẾNG VIỆT, thực chiến, ngắn gọn có cấu trúc. Bắt buộc: (1) giải thích ngắn, (2) ví dụ cụ thể, (3) các BƯỚC HÀNH ĐỘNG. Dùng thuật ngữ tiếng Anh chuẩn ngành khi cần (đặt trong ngoặc). ${context ? 'Bối cảnh bài học người học đang xem: ' + context : ''}`;

  try {
    if (webSearch) {
      const out = await callResponsesWebSearch({
        apiKey,
        model,
        instructions: system,
        input: message,
      });
      return res.json({ reply: out.text, citations: out.citations });
    }
    const messages = [{ role: 'system', content: system }];
    if (Array.isArray(history)) {
      for (const h of history.slice(-8)) {
        if (h && h.role && h.content) messages.push({ role: h.role, content: String(h.content) });
      }
    }
    messages.push({ role: 'user', content: message });
    const out = await callChatCompletions({ apiKey, model, messages });
    res.json({ reply: out.text, citations: [] });
  } catch (e) {
    console.error('[chat]', e.message);
    res.status(200).json({ reply: `Lỗi gọi AI: ${e.message}`, citations: [], error: 'ai_error' });
  }
});

app.post('/api/insight', async (req, res) => {
  const { apiKey, model } = getOpenAIConfig();
  if (!apiKey) return res.status(200).json({ insight: NO_KEY_MSG, citations: [], error: 'no_key' });

  const { resourceId, prompt: userPrompt } = req.body || {};
  const lib = readLibrary();
  const r = lib.resources.find((x) => x.id === resourceId);
  if (!r) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });

  const extra = userPrompt && String(userPrompt).trim() ? `\n\nYÊU CẦU THÊM TỪ NGƯỜI DÙNG (ưu tiên tuân thủ): ${String(userPrompt).trim()}` : '';
  const frame = `Hãy RÚT INSIGHT BÀI HỌC cho môn ${SUBJECT} theo đúng khung sau (tiếng Việt):
**Tóm tắt**: 2-3 câu.
**Bài học chính**: 3-5 gạch đầu dòng thực chiến.
**Áp dụng ngay**: 2-3 hành động cụ thể có thể làm hôm nay.${extra}`;

  try {
    let out;
    if (r.type === 'text') {
      const content = `${r.title}\n\n${r.note || ''}`;
      out = await callChatCompletions({
        apiKey,
        model,
        messages: [
          { role: 'system', content: frame },
          { role: 'user', content: `Nội dung tài liệu:\n${content}` },
        ],
      });
    } else if (r.url) {
      // youtube/facebook/link/pdf-online/image-url → dùng web_search theo URL
      out = await callResponsesWebSearch({
        apiKey,
        model,
        instructions: frame,
        input: `Tra cứu và tóm tắt nội dung tại URL này rồi rút insight: ${r.url}\nTiêu đề: ${r.title}\nGhi chú: ${r.note || ''}`,
      });
    } else {
      out = await callChatCompletions({
        apiKey,
        model,
        messages: [
          { role: 'system', content: frame },
          { role: 'user', content: `Tài liệu: ${r.title}\nGhi chú: ${r.note || ''}` },
        ],
      });
    }

    r.insight = out.text;
    r.insightCitations = out.citations || [];
    r.insightAt = new Date().toISOString();
    writeJSON(LIBRARY_FILE, lib);
    res.json({ insight: r.insight, citations: r.insightCitations, insightAt: r.insightAt });
  } catch (e) {
    console.error('[insight]', e.message);
    res.status(200).json({ insight: `Lỗi gọi AI: ${e.message}`, citations: [], error: 'ai_error' });
  }
});

// ==========================================================================
// AI: KNOWLEDGE GENERATE (ví dụ / công cụ / thực hành / video) + QUIZ
// ==========================================================================
function parseJSONLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  // bỏ ```json ... ```
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch {}
  // thử tìm khối {...} hoặc [...] đầu tiên
  const m = t.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// kind: examples | tools | practice | videos
app.post('/api/knowledge/generate', async (req, res) => {
  const { apiKey, model } = getOpenAIConfig();
  if (!apiKey) return res.status(200).json({ items: [], error: 'no_key', message: NO_KEY_MSG });
  const { kind, context, topic } = req.body || {};
  const ctx = context || topic || SUBJECT;

  const specs = {
    examples: { web: true, prompt: `Tìm 4-6 VÍ DỤ THỰC TẾ có thật (case study, tình huống doanh nghiệp/thương hiệu) minh hoạ cho chủ đề: "${ctx}". Mỗi ví dụ kèm URL nguồn thật.` },
    tools: { web: true, prompt: `Liệt kê 4-6 CÔNG CỤ / WEBSITE / TÀI NGUYÊN có thật, hữu ích để học & thực hành chủ đề: "${ctx}". Mỗi mục kèm URL thật.` },
    videos: { web: true, prompt: `Tìm 4-6 VIDEO YOUTUBE có thật, chất lượng, liên quan trực tiếp chủ đề: "${ctx}". Ưu tiên tiếng Việt, có thể kèm tiếng Anh. Mỗi mục 'url' PHẢI là link YouTube thật (https://www.youtube.com/watch?v=...).` },
    practice: { web: false, prompt: `Soạn 4-6 BÀI TẬP / HÀNH ĐỘNG cụ thể, thực chiến làm được ngay trong tuần cho chủ đề: "${ctx}". Không cần URL.` },
  };
  const spec = specs[kind];
  if (!spec) return res.status(400).json({ error: 'kind không hợp lệ' });

  const instructions = `Bạn là chuyên gia đào tạo ${SUBJECT}. Trả về DUY NHẤT một JSON hợp lệ dạng {"items":[{"title":"...","detail":"...","url":"..."}]} (tiếng Việt). "url" để "" nếu không có. Không thêm chữ nào ngoài JSON.`;
  try {
    let out;
    if (spec.web) out = await callResponsesWebSearch({ apiKey, model, instructions, input: spec.prompt });
    else out = await callChatCompletions({ apiKey, model, messages: [{ role: 'system', content: instructions }, { role: 'user', content: spec.prompt }] });
    const parsed = parseJSONLoose(out.text);
    let items = (parsed && Array.isArray(parsed.items)) ? parsed.items : (Array.isArray(parsed) ? parsed : []);
    items = items.map((it) => ({ title: String(it.title || '').trim(), detail: String(it.detail || it.note || '').trim(), url: String(it.url || '').trim() })).filter((it) => it.title || it.detail);
    res.json({ items, citations: out.citations || [], kind });
  } catch (e) {
    console.error('[knowledge]', e.message);
    res.status(200).json({ items: [], error: 'ai_error', message: 'Lỗi gọi AI: ' + e.message });
  }
});

// Sinh đề kiểm tra. scope: lesson | skill | all
app.post('/api/quiz/generate', async (req, res) => {
  const { apiKey, model } = getOpenAIConfig();
  if (!apiKey) return res.status(200).json({ questions: [], error: 'no_key', message: NO_KEY_MSG });
  const { context, mcq = 4, essay = 1 } = req.body || {};
  const instructions = `Bạn là giảng viên ${SUBJECT}. Soạn đề kiểm tra tiếng Việt dựa trên ngữ cảnh. Trả về DUY NHẤT JSON hợp lệ:
{"questions":[
  {"type":"mcq","q":"...","options":["A","B","C","D"],"answer":0,"explain":"..."},
  {"type":"essay","q":"...","guide":"gợi ý chấm điểm"}
]}
Yêu cầu: ${mcq} câu trắc nghiệm (mỗi câu 4 lựa chọn, "answer" là chỉ số 0-3, kèm "explain") và ${essay} câu tự luận thực chiến. Không thêm chữ nào ngoài JSON.`;
  try {
    const out = await callChatCompletions({ apiKey, model, temperature: 0.4, messages: [{ role: 'system', content: instructions }, { role: 'user', content: 'Ngữ cảnh:\n' + (context || SUBJECT) }] });
    const parsed = parseJSONLoose(out.text);
    const questions = (parsed && Array.isArray(parsed.questions)) ? parsed.questions : [];
    if (!questions.length) return res.status(200).json({ questions: [], error: 'parse', message: 'AI không trả về đúng định dạng, thử lại.' });
    res.json({ questions });
  } catch (e) {
    console.error('[quiz-gen]', e.message);
    res.status(200).json({ questions: [], error: 'ai_error', message: 'Lỗi gọi AI: ' + e.message });
  }
});

// Tự sinh TEMPLATE EXCEL bằng AI. body: {context?, resourceId?}
app.post('/api/template/generate', async (req, res) => {
  const { apiKey, model } = getOpenAIConfig();
  if (!apiKey) return res.status(200).json({ error: 'no_key', message: NO_KEY_MSG });
  let { context, resourceId } = req.body || {};
  if (resourceId) {
    const r = readLibrary().resources.find((x) => x.id === resourceId);
    if (r) context = `${r.title}\n${r.note || ''}\n${r.url || ''}`.trim();
  }
  if (!context) return res.status(400).json({ error: 'Thiếu ngữ cảnh' });
  const instructions = `Bạn là chuyên gia ${SUBJECT}. Dựa trên ngữ cảnh, hãy TẠO MỘT TEMPLATE EXCEL thực dụng, có thể dùng ngay để theo dõi/áp dụng. Trả về DUY NHẤT JSON hợp lệ (tiếng Việt):
{"title":"...","category":"Bảng theo dõi / Tracker","description":"...","headers":["Cột 1","Cột 2",...],"rows":[["...","..."],["",""]]}
Yêu cầu: 4-8 cột hợp lý; 3-8 dòng mẫu (có thể để trống vài ô để người dùng điền). Không thêm chữ nào ngoài JSON.`;
  try {
    const out = await callChatCompletions({ apiKey, model, temperature: 0.4, messages: [{ role: 'system', content: instructions }, { role: 'user', content: 'Ngữ cảnh:\n' + context }] });
    const p = parseJSONLoose(out.text);
    if (!p || !Array.isArray(p.headers) || !p.headers.length) return res.status(200).json({ error: 'parse', message: 'AI không trả về đúng định dạng, thử lại.' });
    res.json({ title: p.title || 'Template', category: p.category || 'Bảng theo dõi / Tracker', description: p.description || '', headers: p.headers.map(String), rows: Array.isArray(p.rows) ? p.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])) : [] });
  } catch (e) {
    console.error('[template-gen]', e.message);
    res.status(200).json({ error: 'ai_error', message: 'Lỗi gọi AI: ' + e.message });
  }
});

// Chấm các câu tự luận. body: {items:[{q, guide, answer}]}
app.post('/api/quiz/grade', async (req, res) => {
  const { apiKey, model } = getOpenAIConfig();
  if (!apiKey) return res.status(200).json({ results: [], error: 'no_key', message: NO_KEY_MSG });
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Thiếu items' });
  const instructions = `Bạn là giám khảo ${SUBJECT}. Chấm từng câu tự luận theo thang 0-10, nhận xét ngắn gọn mang tính xây dựng (tiếng Việt). Trả về DUY NHẤT JSON: {"results":[{"score":0-10,"feedback":"..."}]} theo đúng thứ tự câu.`;
  const payload = items.map((it, i) => `Câu ${i + 1}: ${it.q}\nGợi ý chấm: ${it.guide || '(không có)'}\nBài làm của học viên: ${it.answer || '(bỏ trống)'}`).join('\n\n');
  try {
    const out = await callChatCompletions({ apiKey, model, temperature: 0.2, messages: [{ role: 'system', content: instructions }, { role: 'user', content: payload }] });
    const parsed = parseJSONLoose(out.text);
    const results = (parsed && Array.isArray(parsed.results)) ? parsed.results : [];
    res.json({ results });
  } catch (e) {
    console.error('[quiz-grade]', e.message);
    res.status(200).json({ results: [], error: 'ai_error', message: 'Lỗi gọi AI: ' + e.message });
  }
});

// ==========================================================================
// TEMPLATES (thư viện template)
// ==========================================================================
app.get('/api/templates', (req, res) => {
  const { q, category, skill } = req.query;
  let list = readTemplates().templates;
  if (skill) list = list.filter((t) => (t.skillId || '') === skill);
  if (category) list = list.filter((t) => t.category === category);
  if (q) {
    const n = String(q).toLowerCase();
    list = list.filter((t) => [t.title, t.description, t.content, t.category, (t.tags || []).join(' ')].filter(Boolean).join(' ').toLowerCase().includes(n));
  }
  res.json({ templates: list });
});

app.post('/api/templates', (req, res) => {
  const { title, category, description, content, table, tags, skillId } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Thiếu tiêu đề' });
  const data = readTemplates();
  const tpl = {
    id: uid('tpl'),
    skillId: skillId || null,
    title,
    category: category || 'Khác',
    description: description || '',
    content: content || '',
    table: table && Array.isArray(table.headers) ? { headers: table.headers, rows: Array.isArray(table.rows) ? table.rows : [] } : null,
    tags: normalizeTags(tags),
    builtin: false,
    createdAt: new Date().toISOString(),
  };
  data.templates.push(tpl);
  writeJSON(TEMPLATES_FILE, data);
  res.status(201).json(tpl);
});

app.put('/api/templates/:id', (req, res) => {
  const { id } = req.params;
  const data = readTemplates();
  const tpl = data.templates.find((t) => t.id === id);
  if (!tpl) return res.status(404).json({ error: 'Không tìm thấy template' });
  const { title, category, description, content, table, tags, skillId } = req.body || {};
  if (typeof title === 'string' && title.trim()) tpl.title = title.trim();
  if (skillId !== undefined) tpl.skillId = skillId || null;
  if (typeof category === 'string') tpl.category = category || 'Khác';
  if (typeof description === 'string') tpl.description = description;
  if (typeof content === 'string') tpl.content = content;
  if (table !== undefined) tpl.table = table && Array.isArray(table.headers) ? { headers: table.headers, rows: Array.isArray(table.rows) ? table.rows : [] } : null;
  if (tags !== undefined) tpl.tags = normalizeTags(tags);
  writeJSON(TEMPLATES_FILE, data);
  res.json(tpl);
});

app.delete('/api/templates/:id', (req, res) => {
  const { id } = req.params;
  const data = readTemplates();
  const tpl = data.templates.find((t) => t.id === id);
  if (!tpl) return res.status(404).json({ error: 'Không tìm thấy template' });
  if (tpl.builtin) return res.status(403).json({ error: 'Không thể xóa template mặc định' });
  data.templates = data.templates.filter((t) => t.id !== id);
  writeJSON(TEMPLATES_FILE, data);
  res.json({ ok: true });
});

// ==========================================================================
// Static + uploads + health
// ==========================================================================
// Phục vụ file upload: ưu tiên đĩa, nếu mất (host reset) thì lấy từ MongoDB
app.get('/uploads/:name', async (req, res, next) => {
  const name = path.basename(req.params.name);
  const p = path.join(UPLOADS_DIR, name);
  if (fs.existsSync(p)) return res.sendFile(p);
  if (mfiles) {
    try {
      const f = await mfiles.findOne({ _id: name });
      if (f && f.data) {
        if (f.mimetype) res.type(f.mimetype);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(Buffer.from(f.data, 'base64'));
      }
    } catch (e) { console.error('[uploads-mongo]', e.message); }
  }
  next();
});
// Chống cache JS/CSS/HTML cũ trên host
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

// SPA-ish fallback cho các route không phải /api
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Middleware bắt lỗi Express -> JSON 500 (không để sập tiến trình)
app.use((err, req, res, next) => {
  console.error('[express-error]', err.message);
  if (res.headersSent) return next(err);
  const code = err.message && /file/i.test(err.message) ? 400 : 500;
  res.status(code).json({ error: err.message || 'Lỗi máy chủ' });
});

const PORT = process.env.PORT || 3000;
// Kết nối Mongo (nếu có) rồi mới lắng nghe — hydrate dữ liệu bền vững trước khi phục vụ
initMongo().finally(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Sale app chạy tại http://localhost:${PORT}  (DATA_DIR=${DATA_DIR}, Mongo=${mdb ? 'ON' : 'OFF'})`);
  });
});
