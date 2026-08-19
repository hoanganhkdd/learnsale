/* ==========================================================================
   api-static.js — Lớp giả lập backend cho hosting TĨNH (Netlify...)
   Ghi đè window.fetch: với request /api/*:
     1) Thử gọi server thật. Nếu trả JSON hợp lệ -> dùng server (chế độ backend).
     2) Nếu không có backend (404 HTML / lỗi mạng) -> xử lý trong trình duyệt bằng
        localStorage (seed từ /data/*.json) và GỌI THẲNG OpenAI cho chat/insight.
   Nhờ vậy app.js KHÔNG cần sửa; chạy được cả 2 nơi.
   ========================================================================== */
(() => {
  'use strict';
  const realFetch = window.fetch.bind(window);
  const LS = 'sale_static_';
  let BACKEND = null; // null=chưa biết, true=có backend, false=static mode

  const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const slugify = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || uid('skill');
  const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  const store = {
    get skills() { return JSON.parse(localStorage.getItem(LS + 'skills') || 'null'); },
    set skills(v) { localStorage.setItem(LS + 'skills', JSON.stringify(v)); },
    get library() { return JSON.parse(localStorage.getItem(LS + 'library') || 'null'); },
    set library(v) { localStorage.setItem(LS + 'library', JSON.stringify(v)); },
    get settings() { return JSON.parse(localStorage.getItem(LS + 'settings') || '{}'); },
    set settings(v) { localStorage.setItem(LS + 'settings', JSON.stringify(v)); },
  };

  async function seedIfNeeded() {
    if (!store.skills) {
      try { store.skills = await (await realFetch('/data/skills.json')).json(); }
      catch { store.skills = { meta: {}, skills: [] }; }
    }
    if (!store.library) {
      try { store.library = await (await realFetch('/data/library.json')).json(); }
      catch { store.library = { resources: [] }; }
    }
  }

  // ---- Kiểm tra có backend không (1 lần) ----
  async function hasBackend() {
    if (BACKEND !== null) return BACKEND;
    try {
      const r = await realFetch('/healthz', { method: 'GET' });
      const ct = r.headers.get('content-type') || '';
      BACKEND = r.ok && ct.includes('application/json');
    } catch { BACKEND = false; }
    if (!BACKEND) { await seedIfNeeded(); console.info('[api-static] Chạy ở chế độ TĨNH (localStorage).'); }
    return BACKEND;
  }

  // ==========================================================================
  // OpenAI trực tiếp từ trình duyệt (static mode)
  // ==========================================================================
  const NO_KEY = 'Chưa cấu hình OpenAI API key. Vào ⚙️ Cài đặt để thêm.';
  const SUBJECT = 'Sale (Bán hàng / Thương mại)';
  function openaiCfg() {
    const s = store.settings;
    return { apiKey: (s.apiKey || '').trim(), model: (s.model || 'gpt-4o-mini').trim() };
  }
  async function chatCompletions(apiKey, model, messages) {
    const r = await realFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.5 }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `OpenAI ${r.status}`);
    return { text: d.choices?.[0]?.message?.content?.trim() || '', citations: [] };
  }
  async function responsesWebSearch(apiKey, model, instructions, input) {
    const r = await realFetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, instructions, input, tools: [{ type: 'web_search' }] }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `OpenAI ${r.status}`);
    let text = d.output_text || '';
    const citations = [];
    if (Array.isArray(d.output)) {
      for (const item of d.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === 'output_text' && !d.output_text) text += c.text || '';
            for (const ann of (c.annotations || [])) {
              if (ann.type === 'url_citation') citations.push({ url: ann.url, title: ann.title || ann.url });
            }
          }
        }
      }
    }
    return { text: text.trim(), citations };
  }

  // ==========================================================================
  // Router tĩnh: xử lý /api/* bằng localStorage
  // ==========================================================================
  async function handleStatic(url, method, body) {
    await seedIfNeeded();
    const path = url.pathname;
    const qp = url.searchParams;

    // ----- SKILLS -----
    if (path === '/api/skills' && method === 'GET') return jsonRes(store.skills);
    if (path === '/api/skills' && method === 'POST') {
      const data = store.skills; const b = body || {};
      const base = slugify(b.name_en || b.name_vi); let id = base, i = 1;
      while (data.skills.some((s) => s.id === id)) id = `${base}-${i++}`;
      const skill = { id, icon: b.icon || '📌', name_vi: b.name_vi || b.name_en, name_en: b.name_en || b.name_vi, summary: b.summary || '', builtin: false, lessons: [] };
      data.skills.push(skill); store.skills = data; return jsonRes(skill, 201);
    }
    let mm;
    if ((mm = path.match(/^\/api\/skills\/([^/]+)$/)) && method === 'DELETE') {
      const id = mm[1]; const data = store.skills;
      const sk = data.skills.find((s) => s.id === id);
      if (!sk) return jsonRes({ error: 'Không tìm thấy kỹ năng' }, 404);
      if (sk.builtin) return jsonRes({ error: 'Không thể xóa kỹ năng mặc định' }, 403);
      data.skills = data.skills.filter((s) => s.id !== id); store.skills = data;
      const lib = store.library; lib.resources = lib.resources.filter((r) => r.skillId !== id); store.library = lib;
      return jsonRes({ ok: true });
    }
    if ((mm = path.match(/^\/api\/skills\/([^/]+)\/lessons$/)) && method === 'POST') {
      const id = mm[1]; const data = store.skills; const sk = data.skills.find((s) => s.id === id);
      if (!sk) return jsonRes({ error: 'Không tìm thấy kỹ năng' }, 404);
      const b = body || {};
      const lesson = { id: uid('lesson'), title_vi: b.title_vi || b.title_en || 'Bài học mới', title_en: b.title_en || b.title_vi || 'New lesson', objective: b.objective || '', blocks: Array.isArray(b.blocks) ? b.blocks : [] };
      sk.lessons.push(lesson); store.skills = data; return jsonRes(lesson, 201);
    }
    if ((mm = path.match(/^\/api\/skills\/([^/]+)\/lessons\/([^/]+)$/)) && method === 'DELETE') {
      const [, id, lid] = mm; const data = store.skills; const sk = data.skills.find((s) => s.id === id);
      if (!sk) return jsonRes({ error: 'Không tìm thấy kỹ năng' }, 404);
      sk.lessons = sk.lessons.filter((l) => l.id !== lid); store.skills = data; return jsonRes({ ok: true });
    }

    // ----- RESOURCES -----
    if (path === '/api/resources' && method === 'GET') {
      let list = store.library.resources;
      const skill = qp.get('skill'), type = qp.get('type'), q = qp.get('q');
      if (skill) list = list.filter((r) => r.skillId === skill);
      if (type) list = list.filter((r) => r.type === type);
      if (q) { const n = q.toLowerCase(); list = list.filter((r) => [r.title, r.note, r.url, (r.tags || []).join(' ')].filter(Boolean).join(' ').toLowerCase().includes(n)); }
      return jsonRes({ resources: list });
    }
    if (path === '/api/resources' && method === 'POST') {
      const b = body || {}; const lib = store.library;
      const r = { id: uid('res'), skillId: b.skillId || null, type: b.type, title: b.title || b.url || 'Tài liệu', url: b.url || '', note: b.note || '', tags: normTags(b.tags), file: null, createdAt: new Date().toISOString() };
      lib.resources.push(r); store.library = lib; return jsonRes(r, 201);
    }
    if (path === '/api/resources/upload' && method === 'POST') {
      // static mode: không có server lưu file -> nhúng bằng dataURL (đã đọc sẵn trong fetch override)
      const b = body || {}; const lib = store.library;
      const r = { id: uid('res'), skillId: b.skillId || null, type: b.type || 'image', title: b.title || 'File', url: b.dataUrl || '', note: b.note || '', tags: normTags(b.tags), file: null, createdAt: new Date().toISOString() };
      lib.resources.push(r); store.library = lib; return jsonRes(r, 201);
    }
    if ((mm = path.match(/^\/api\/resources\/([^/]+)$/)) && method === 'DELETE') {
      const id = mm[1]; const lib = store.library;
      lib.resources = lib.resources.filter((r) => r.id !== id); store.library = lib; return jsonRes({ ok: true });
    }

    // ----- SETTINGS -----
    if (path === '/api/settings' && method === 'GET') {
      const s = store.settings; return jsonRes({ model: s.model || 'gpt-4o-mini', hasKey: Boolean((s.apiKey || '').trim()), keyFromEnv: false });
    }
    if (path === '/api/settings' && method === 'POST') {
      const s = store.settings; const b = body || {};
      if (typeof b.apiKey === 'string') s.apiKey = b.apiKey.trim();
      if (typeof b.model === 'string' && b.model.trim()) s.model = b.model.trim();
      store.settings = s; return jsonRes({ model: s.model || 'gpt-4o-mini', hasKey: Boolean((s.apiKey || '').trim()) });
    }

    // ----- CHAT -----
    if (path === '/api/chat' && method === 'POST') {
      const { apiKey, model } = openaiCfg();
      if (!apiKey) return jsonRes({ reply: NO_KEY, citations: [], error: 'no_key' });
      const b = body || {};
      const system = `Bạn là COACH chuyên môn ${SUBJECT}. Luôn trả lời bằng TIẾNG VIỆT, thực chiến, ngắn gọn có cấu trúc: (1) giải thích ngắn, (2) ví dụ, (3) BƯỚC HÀNH ĐỘNG. ${b.context ? 'Bối cảnh: ' + b.context : ''}`;
      try {
        if (b.webSearch) { const o = await responsesWebSearch(apiKey, model, system, b.message); return jsonRes({ reply: o.text, citations: o.citations }); }
        const messages = [{ role: 'system', content: system }];
        (b.history || []).slice(-8).forEach((h) => { if (h?.role && h?.content) messages.push({ role: h.role, content: String(h.content) }); });
        messages.push({ role: 'user', content: b.message });
        const o = await chatCompletions(apiKey, model, messages);
        return jsonRes({ reply: o.text, citations: [] });
      } catch (e) { return jsonRes({ reply: 'Lỗi gọi AI: ' + e.message, citations: [], error: 'ai_error' }); }
    }

    // ----- INSIGHT -----
    if (path === '/api/insight' && method === 'POST') {
      const { apiKey, model } = openaiCfg();
      if (!apiKey) return jsonRes({ insight: NO_KEY, citations: [], error: 'no_key' });
      const b = body || {}; const lib = store.library; const r = lib.resources.find((x) => x.id === b.resourceId);
      if (!r) return jsonRes({ error: 'Không tìm thấy tài liệu' }, 404);
      const frame = `Hãy RÚT INSIGHT BÀI HỌC cho môn ${SUBJECT} theo khung (tiếng Việt): **Tóm tắt** (2-3 câu). **Bài học chính** (3-5 gạch đầu dòng). **Áp dụng ngay** (2-3 hành động).`;
      try {
        let o;
        if (r.type === 'text') o = await chatCompletions(apiKey, model, [{ role: 'system', content: frame }, { role: 'user', content: `${r.title}\n\n${r.note || ''}` }]);
        else if (r.url && /^https?:/.test(r.url)) o = await responsesWebSearch(apiKey, model, frame, `Tra cứu URL rồi rút insight: ${r.url}\nTiêu đề: ${r.title}\nGhi chú: ${r.note || ''}`);
        else o = await chatCompletions(apiKey, model, [{ role: 'system', content: frame }, { role: 'user', content: `${r.title}\n${r.note || ''}` }]);
        r.insight = o.text; r.insightCitations = o.citations || []; r.insightAt = new Date().toISOString();
        store.library = lib;
        return jsonRes({ insight: r.insight, citations: r.insightCitations, insightAt: r.insightAt });
      } catch (e) { return jsonRes({ insight: 'Lỗi gọi AI: ' + e.message, citations: [], error: 'ai_error' }); }
    }

    return jsonRes({ error: 'Không hỗ trợ (static): ' + method + ' ' + path }, 404);
  }
  const normTags = (t) => Array.isArray(t) ? t.map((x) => String(x).trim()).filter(Boolean) : (typeof t === 'string' ? t.split(',').map((x) => x.trim()).filter(Boolean) : []);

  // ==========================================================================
  // fetch override
  // ==========================================================================
  window.fetch = async function (input, opts = {}) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.origin); } catch { return realFetch(input, opts); }
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, opts);

    const method = (opts.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();

    // Nếu đã biết có backend -> dùng thẳng server thật
    if (BACKEND === true) return realFetch(input, opts);

    // Chưa biết: thử server thật trước (trừ khi đã xác định static)
    if (BACKEND === null) {
      const ok = await hasBackend();
      if (ok) return realFetch(input, opts);
    }

    // ----- STATIC MODE -----
    let body = null;
    if (opts.body instanceof FormData) {
      // upload trong static: đọc file thành dataURL để nhúng
      const fd = opts.body; const file = fd.get('file');
      body = { skillId: fd.get('skillId'), title: fd.get('title'), note: fd.get('note'), tags: fd.get('tags') };
      if (file && file.size) {
        body.type = /pdf/.test(file.type) ? 'pdf' : 'image';
        body.title = body.title || file.name;
        body.dataUrl = await readAsDataURL(file);
      }
    } else if (typeof opts.body === 'string') {
      try { body = JSON.parse(opts.body); } catch { body = null; }
    }
    try { return await handleStatic(url, method, body); }
    catch (e) { return jsonRes({ error: e.message }, 500); }
  };

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(file); });
  }
})();
