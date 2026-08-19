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
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function readSkills() {
  return readJSON(SKILLS_FILE, { meta: {}, skills: [] });
}
function readLibrary() {
  return readJSON(LIBRARY_FILE, { resources: [] });
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
  res.status(201).json(resource);
});

// Upload ảnh/PDF
app.post('/api/resources/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file' });
  const { skillId, title, note, tags } = req.body || {};
  const type = /pdf/.test(req.file.mimetype) ? 'pdf' : 'image';
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
  res.status(201).json(resource);
});

app.delete('/api/resources/:id', (req, res) => {
  const { id } = req.params;
  const lib = readLibrary();
  const r = lib.resources.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
  deleteUploadFile(r.file);
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
  });
});

app.post('/api/settings', (req, res) => {
  const { apiKey, model } = req.body || {};
  const s = readSettings();
  if (typeof apiKey === 'string') s.apiKey = apiKey.trim();
  if (typeof model === 'string' && model.trim()) s.model = model.trim();
  writeJSON(SETTINGS_FILE, s);
  res.json({
    model: s.model || 'gpt-4o-mini',
    hasKey: Boolean((s.apiKey || process.env.OPENAI_API_KEY || '').trim()),
  });
});

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

  const { resourceId } = req.body || {};
  const lib = readLibrary();
  const r = lib.resources.find((x) => x.id === resourceId);
  if (!r) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });

  const frame = `Hãy RÚT INSIGHT BÀI HỌC cho môn ${SUBJECT} theo đúng khung sau (tiếng Việt):
**Tóm tắt**: 2-3 câu.
**Bài học chính**: 3-5 gạch đầu dòng thực chiến.
**Áp dụng ngay**: 2-3 hành động cụ thể có thể làm hôm nay.`;

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
// Static + uploads + health
// ==========================================================================
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Sale app chạy tại http://localhost:${PORT}  (DATA_DIR=${DATA_DIR})`);
});
