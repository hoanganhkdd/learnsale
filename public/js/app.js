/* ==========================================================================
   Sale Self-Learning App — app.js (toàn bộ logic frontend, vanilla JS)
   ========================================================================== */
(() => {
  'use strict';

  const LS_PREFIX = 'sale_';
  const State = {
    skills: [],
    meta: {},
    view: { type: 'home' }, // {type:'home'} | {type:'skill',id} | {type:'lesson',skillId,lessonId,tab}
  };

  // ---------- Utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      n.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  };
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // markdown nhẹ: **đậm**, *nghiêng*, xuống dòng
  const mdLite = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\n/g, '<br>');

  const lsGet = (k, d) => {
    try { const v = localStorage.getItem(LS_PREFIX + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  };
  const lsSet = (k, v) => { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch {} };

  const doneKey = (skillId, lessonId) => `done_${skillId}_${lessonId}`;
  const isDone = (s, l) => lsGet(doneKey(s, l), false);
  const setDone = (s, l, v) => lsSet(doneKey(s, l), v);

  let toastTimer;
  const toast = (msg, kind = '') => {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
  };

  // ---------- API ----------
  const api = {
    async skills() { return (await fetch('/api/skills')).json(); },
    async addSkill(body) { return jpost('/api/skills', body); },
    async delSkill(id) { return jdel(`/api/skills/${id}`); },
    async addLesson(id, body) { return jpost(`/api/skills/${id}/lessons`, body); },
    async delLesson(id, lid) { return jdel(`/api/skills/${id}/lessons/${lid}`); },
    async resources(params = {}) {
      const q = new URLSearchParams(params).toString();
      return (await fetch('/api/resources' + (q ? '?' + q : ''))).json();
    },
    async addResource(body) { return jpost('/api/resources', body); },
    async uploadResource(formData) { return (await fetch('/api/resources/upload', { method: 'POST', body: formData })).json(); },
    async delResource(id) { return jdel(`/api/resources/${id}`); },
    async getSettings() { return (await fetch('/api/settings')).json(); },
    async saveSettings(body) { return jpost('/api/settings', body); },
    async chat(body) { return jpost('/api/chat', body); },
    async insight(resourceId) { return jpost('/api/insight', { resourceId }); },
    async genKnowledge(body) { return jpost('/api/knowledge/generate', body); },
    async quizGen(body) { return jpost('/api/quiz/generate', body); },
    async quizGrade(body) { return jpost('/api/quiz/grade', body); },
  };
  async function jpost(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }
  async function jdel(url) {
    const r = await fetch(url, { method: 'DELETE' });
    return r.json();
  }

  // ---------- Data helpers ----------
  const findSkill = (id) => State.skills.find((s) => s.id === id);
  const findLesson = (skill, lid) => skill && skill.lessons.find((l) => l.id === lid);
  const skillProgress = (skill) => {
    const total = skill.lessons.length || 0;
    const done = skill.lessons.filter((l) => isDone(skill.id, l.id)).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  };

  async function loadSkills() {
    const data = await api.skills();
    State.skills = data.skills || [];
    State.meta = data.meta || {};
  }

  // ==========================================================================
  // RENDER: Sidebar
  // ==========================================================================
  function renderSidebar(filter = '') {
    const tree = $('#skillTree');
    tree.innerHTML = '';
    const f = filter.trim().toLowerCase();
    const openState = lsGet('treeOpen', {});

    State.skills.forEach((skill) => {
      const lessons = skill.lessons.filter((l) => {
        if (!f) return true;
        return (
          (l.title_vi + l.title_en).toLowerCase().includes(f) ||
          (skill.name_vi + skill.name_en).toLowerCase().includes(f)
        );
      });
      const skillMatches = (skill.name_vi + skill.name_en).toLowerCase().includes(f);
      if (f && !skillMatches && lessons.length === 0) return;

      const open = f ? true : openState[skill.id] !== false;
      const wrap = el('div', { class: 'tree-skill' + (open ? ' open' : '') });
      const head = el('button', { class: 'tree-skill-head', onclick: () => {
        wrap.classList.toggle('open');
        const st = lsGet('treeOpen', {});
        st[skill.id] = wrap.classList.contains('open');
        lsSet('treeOpen', st);
      } },
        el('span', { class: 'ic' }, skill.icon || '📌'),
        el('span', {}, skill.name_vi),
        el('span', { class: 'caret' }, '▶')
      );
      const lessBox = el('div', { class: 'tree-lessons' });
      (f ? lessons : skill.lessons).forEach((l) => {
        const done = isDone(skill.id, l.id);
        const active = State.view.type === 'lesson' && State.view.lessonId === l.id;
        lessBox.append(
          el('button', {
            class: 'tree-lesson' + (done ? ' done' : '') + (active ? ' active' : ''),
            onclick: () => go({ type: 'lesson', skillId: skill.id, lessonId: l.id, tab: 'learn' }),
          }, el('span', { class: 'dot' }), l.title_vi)
        );
      });
      // click skill name area -> open skill page too (double role): add small link
      head.addEventListener('dblclick', () => go({ type: 'skill', id: skill.id }));
      wrap.append(head, lessBox);
      tree.append(wrap);
    });

    if (!tree.children.length) {
      tree.append(el('div', { class: 'empty' }, el('div', { class: 'big' }, '🔍'), el('p', {}, 'Không tìm thấy.')));
    }
  }

  // ==========================================================================
  // RENDER: Home
  // ==========================================================================
  async function renderHome() {
    const main = $('#main');
    main.innerHTML = '';
    const totalLessons = State.skills.reduce((a, s) => a + s.lessons.length, 0);
    const doneLessons = State.skills.reduce((a, s) => a + s.lessons.filter((l) => isDone(s.id, l.id)).length, 0);
    let resCount = 0;
    try { resCount = (await api.resources()).resources.length; } catch {}

    main.append(
      el('section', { class: 'hero' },
        el('h1', {}, State.meta.title || 'Tự học Sale'),
        el('p', {}, (State.meta.subtitle || 'Self-learning Sales') + ' — Học kỹ năng bán hàng thực chiến, song ngữ Việt–Anh. Chọn một kỹ năng để bắt đầu.'),
        el('div', { class: 'stats' },
          stat(State.skills.length, 'Kỹ năng / Skills'),
          stat(totalLessons, 'Bài học / Lessons'),
          stat(doneLessons, 'Đã hoàn thành / Done'),
          stat(resCount, 'Tài liệu / Resources'),
        )
      )
    );

    main.append(el('div', { class: 'section-title' }, el('h2', {}, '📚 Kỹ năng của bạn'), el('div', { class: 'line' })));

    const grid = el('div', { class: 'skill-grid' });
    for (const skill of State.skills) {
      const p = skillProgress(skill);
      let rc = 0;
      grid.append(
        el('div', { class: 'skill-card', onclick: () => go({ type: 'skill', id: skill.id }) },
          el('div', { class: 'ic' }, skill.icon || '📌'),
          el('h3', {}, skill.name_vi),
          el('div', { class: 'en' }, skill.name_en),
          el('p', {}, skill.summary || ''),
          el('div', { class: 'meta' },
            el('span', {}, el('b', {}, String(p.total)), ' bài'),
            el('span', {}, el('b', {}, String(p.done)), ' xong'),
            el('span', { 'data-rescount': skill.id }, el('b', {}, '…'), ' tài liệu'),
          ),
          el('div', { class: 'progress' }, el('i', { style: `width:${p.pct}%` }))
        )
      );
    }
    main.append(grid);

    // 🔁 Cần ôn lại
    const dueList = [];
    State.skills.forEach((s) => s.lessons.forEach((l) => { if (isDone(s.id, l.id) && needsReview(l)) dueList.push({ s, l }); }));
    main.append(el('div', { class: 'section-title', style: 'margin-top:28px' }, el('h2', {}, '🔁 Cần ôn lại'), el('div', { class: 'line' })));
    if (!dueList.length) {
      main.append(el('div', { style: 'color:var(--text-soft);font-size:14px' }, 'Tuyệt vời! Không có bài nào cần ôn ngay. (Bài đã học sẽ hiện ở đây khi quá 3 ngày, chưa kiểm tra, hoặc điểm < 7.)'));
    } else {
      const chips = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
      dueList.slice(0, 20).forEach(({ s, l }) => chips.append(
        el('button', { class: 'chip', title: 'Kiểm tra nhanh để ôn', onclick: () => startQuiz({ context: quizContextLesson(s, l), title: 'Ôn nhanh: ' + l.title_vi, mcq: 4, essay: 0, skillId: s.id, review: { key: l.id } }) },
          s.icon + ' ' + l.title_vi)
      ));
      main.append(chips);
    }

    // 📝 Thu hoạch / Kiểm tra tổng kết
    main.append(el('div', { class: 'section-title', style: 'margin-top:28px' }, el('h2', {}, '📝 Thu hoạch / Kiểm tra'), el('div', { class: 'line' })));
    main.append(
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        el('button', { class: 'btn btn-accent', onclick: () => startQuiz({ context: quizContextAll(), title: 'Kiểm tra tổng kết toàn khoá', mcq: 8, essay: 2 }) }, '🎓 Kiểm tra tổng kết toàn khoá'),
        ...State.skills.map((s) => el('button', { class: 'btn btn-sm', onclick: () => startQuiz({ context: quizContextSkill(s), title: 'Kiểm tra: ' + s.name_vi, mcq: 6, essay: 1, skillId: s.id }) }, '🧪 ' + s.name_vi)),
      )
    );

    main.append(
      el('div', { style: 'margin-top:26px' },
        el('button', { class: 'btn btn-primary', onclick: openAddSkill }, '➕ Thêm kỹ năng mới')
      )
    );

    // lazy fill resource counts per skill
    try {
      const all = (await api.resources()).resources;
      $$('[data-rescount]').forEach((n) => {
        const id = n.getAttribute('data-rescount');
        const c = all.filter((r) => r.skillId === id).length;
        n.innerHTML = `<b>${c}</b> tài liệu`;
      });
    } catch {}

    function stat(v, label) {
      return el('div', { class: 'stat' }, el('b', {}, String(v)), el('span', {}, label));
    }
  }

  // ==========================================================================
  // RENDER: Skill page
  // ==========================================================================
  async function renderSkill(id) {
    const skill = findSkill(id);
    const main = $('#main');
    main.innerHTML = '';
    if (!skill) { main.append(el('div', { class: 'empty' }, 'Không tìm thấy kỹ năng.')); return; }
    const p = skillProgress(skill);

    main.append(
      el('div', { class: 'crumbs' }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); go({ type: 'home' }); } }, '🏠 Trang chủ'), ' / ', skill.name_vi),
      el('div', { class: 'page-head' },
        el('div', { class: 'ic' }, skill.icon || '📌'),
        el('div', {},
          el('h1', {}, skill.name_vi),
          el('div', { class: 'en' }, skill.name_en),
        )
      ),
      el('p', { style: 'color:var(--text-soft);max-width:680px' }, skill.summary || ''),
      el('div', { class: 'progress', style: 'max-width:420px' }, el('i', { style: `width:${p.pct}%` })),
      el('div', { style: 'font-size:13px;color:var(--text-soft);margin-top:6px' }, `Tiến độ: ${p.done}/${p.total} bài (${p.pct}%)`),
      el('div', { class: 'page-actions' },
        el('button', { class: 'btn btn-primary', onclick: () => openAddLesson(skill.id) }, '➕ Thêm bài học'),
        el('button', { class: 'btn btn-accent', onclick: () => openAddResource(skill.id) }, '📎 Thêm tài liệu'),
        el('button', { class: 'btn', onclick: () => openLibrary(skill.id) }, '📚 Thư viện kỹ năng'),
        el('button', { class: 'btn', onclick: () => startQuiz({ context: quizContextSkill(skill), title: 'Kiểm tra module: ' + skill.name_vi, mcq: 6, essay: 1, skillId: skill.id }) }, '🧪 Kiểm tra module'),
        !skill.builtin && el('button', { class: 'btn btn-danger', onclick: () => confirmDelSkill(skill) }, '🗑 Xóa kỹ năng'),
      )
    );

    main.append(el('div', { class: 'section-title' }, el('h2', {}, '📖 Danh sách bài học'), el('div', { class: 'line' })));

    if (!skill.lessons.length) {
      main.append(el('div', { class: 'empty' }, el('div', { class: 'big' }, '📝'), el('p', {}, 'Chưa có bài học. Bấm “➕ Thêm bài học” để tạo.')));
    } else {
      const list = el('div', { class: 'lesson-list' });
      skill.lessons.forEach((l, i) => {
        const done = isDone(skill.id, l.id);
        list.append(
          el('div', { class: 'lesson-row' + (done ? ' done' : ''), onclick: () => go({ type: 'lesson', skillId: skill.id, lessonId: l.id, tab: 'learn' }) },
            el('div', { class: 'num' }, done ? '✓' : String(i + 1)),
            el('div', { class: 'lr-body' },
              el('b', {}, l.title_vi),
              el('span', {}, l.title_en + (l.objective ? ' — ' + l.objective.slice(0, 70) + (l.objective.length > 70 ? '…' : '') : '')),
            ),
            el('span', { class: 'chev' }, '›')
          )
        );
      });
      main.append(list);
    }
  }

  // ==========================================================================
  // RENDER: Lesson page (3 tabs)
  // ==========================================================================
  async function renderLesson(skillId, lessonId, tab = 'learn') {
    const skill = findSkill(skillId);
    const lesson = findLesson(skill, lessonId);
    const main = $('#main');
    main.innerHTML = '';
    if (!lesson) { main.append(el('div', { class: 'empty' }, 'Không tìm thấy bài học.')); return; }

    main.append(
      el('div', { class: 'crumbs' },
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); go({ type: 'home' }); } }, '🏠'),
        ' / ',
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); go({ type: 'skill', id: skill.id }); } }, skill.name_vi),
        ' / ', lesson.title_vi),
      el('div', { class: 'page-head' },
        el('div', {},
          el('h1', {}, lesson.title_vi),
          el('div', { class: 'en' }, lesson.title_en),
        ),
        el('div', { style: 'margin-left:auto;display:flex;gap:8px;flex-wrap:wrap' },
          el('button', { class: 'btn btn-sm', onclick: () => startQuiz({ context: quizContextLesson(skill, lesson), title: 'Kiểm tra nhanh: ' + lesson.title_vi, mcq: 4, essay: 0, skillId: skill.id, review: { key: lesson.id } }) }, '🧠 Kiểm tra nhanh'),
          reviewBadge(skill, lesson),
          el('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmDelLesson(skill, lesson) }, '🗑 Xóa bài'),
        )
      )
    );

    const tabs = el('div', { class: 'tabs' },
      tabBtn('learn', '📖 Bài học', tab),
      tabBtn('deep', '🧠 Đào sâu', tab),
      tabBtn('library', '📚 Thư viện', tab),
      tabBtn('ai', '🤖 Hỏi AI', tab),
    );
    main.append(tabs);
    const body = el('div', { id: 'tabBody' });
    main.append(body);

    if (tab === 'learn') renderLearnTab(body, skill, lesson);
    else if (tab === 'deep') renderDeepTab(body, skill, lesson);
    else if (tab === 'library') renderLibraryTab(body, skill, lesson);
    else renderAiTab(body, skill, lesson);

    function tabBtn(key, label, cur) {
      return el('button', { class: 'tab' + (key === cur ? ' active' : ''), onclick: () => go({ type: 'lesson', skillId, lessonId, tab: key }) }, label);
    }
  }

  const BLOCK_ICON = { concept: '💡', steps: '🪜', technique: '🛠️', example: '📌', practice: '✍️', pitfall: '⚠️', terms: '🔤' };

  function renderLearnTab(root, skill, lesson) {
    root.append(
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px' },
        el('button', { class: 'btn btn-sm', onclick: () => TTS.play(lessonSpeechText(skill, lesson), '🎧 ' + lesson.title_vi) }, '🎧 Nghe bài (chế độ ngồi xe)'),
      )
    );
    if (lesson.objective) {
      root.append(el('div', { class: 'objective-box' }, el('b', {}, '🎯 Mục tiêu / Objective: '), el('span', { class: 'markdown', html: mdLite(lesson.objective) })));
    }
    (lesson.blocks || []).forEach((b) => {
      const box = el('div', { class: 'block type-' + b.type });
      box.append(el('div', { class: 'block-label' }, (BLOCK_ICON[b.type] || '•') + ' ' + (b.label || b.type)));
      if (b.type === 'example' && b.text) {
        box.append(el('div', { class: 'example-text markdown', html: mdLite(b.text) }));
      } else if (Array.isArray(b.items)) {
        const ul = el('ul');
        b.items.forEach((it) => ul.append(el('li', { class: 'markdown', html: mdLite(it) })));
        box.append(ul);
      } else if (b.text) {
        box.append(el('div', { class: 'markdown', html: mdLite(b.text) }));
      }
      root.append(box);
    });

    const done = isDone(skill.id, lesson.id);
    root.append(
      el('div', { class: 'done-bar' },
        el('label', { class: 'switch' },
          Object.assign(el('input', { type: 'checkbox' }), { checked: done, onchange: (e) => {
            setDone(skill.id, lesson.id, e.target.checked);
            toast(e.target.checked ? '✅ Đã đánh dấu hoàn thành!' : 'Đã bỏ đánh dấu.', e.target.checked ? 'ok' : '');
            renderSidebar($('#searchInput').value);
          } }),
          el('span', { class: 'track' }),
          el('span', {}, 'Đánh dấu hoàn thành bài học này / Mark as complete')
        )
      )
    );
  }

  async function renderLibraryTab(root, skill, lesson) {
    root.append(
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px' },
        el('button', { class: 'btn btn-accent', onclick: () => openAddResource(skill.id) }, '➕ Thêm tài liệu'),
        el('button', { class: 'btn', id: 'insightAllBtn', onclick: () => insightAll(skill.id) }, '✨ Rút insight tất cả'),
      )
    );
    const holder = el('div', { id: 'resHolder' }, el('div', { class: 'empty' }, el('span', { class: 'spinner' }), ' Đang tải…'));
    root.append(holder);
    try {
      const { resources } = await api.resources({ skill: skill.id });
      renderResourceGrid(holder, resources, skill.id);
    } catch (e) {
      holder.innerHTML = '';
      holder.append(el('div', { class: 'empty' }, 'Lỗi tải thư viện.'));
    }
  }

  function renderResourceGrid(holder, resources, skillId) {
    holder.innerHTML = '';
    if (!resources.length) {
      holder.append(el('div', { class: 'empty' }, el('div', { class: 'big' }, '📭'), el('p', {}, 'Chưa có tài liệu. Bấm “➕ Thêm tài liệu”.')));
      return;
    }
    const grid = el('div', { class: 'res-grid' });
    resources.forEach((r) => grid.append(resourceCard(r, skillId)));
    holder.append(grid);
  }

  function ytId(url) {
    const m = String(url).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function resourceCard(r, skillId) {
    const media = el('div', { class: 'res-media' });
    if (r.type === 'image') {
      media.append(el('img', { src: r.url, alt: r.title, loading: 'lazy' }));
    } else if (r.type === 'youtube') {
      const id = ytId(r.url);
      if (id) media.append(el('iframe', { src: `https://www.youtube.com/embed/${id}`, allowfullscreen: '', title: r.title }));
      else media.append(el('div', { class: 'placeholder' }, '▶️'));
    } else if (r.type === 'facebook') {
      media.append(el('iframe', { src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(r.url)}&show_text=false`, allowfullscreen: '', title: r.title }));
    } else if (r.type === 'pdf') {
      media.append(el('div', { class: 'placeholder' }, '📄'));
    } else if (r.type === 'text') {
      media.append(el('div', { class: 'placeholder' }, '📝'));
    } else {
      media.append(el('div', { class: 'placeholder' }, '🔗'));
    }

    const body = el('div', { class: 'res-body' },
      el('span', { class: 'res-type' }, TYPE_LABEL[r.type] || r.type),
      el('h4', {}, r.title),
      r.note && el('div', { class: 'note markdown', html: mdLite(r.note) }),
      r.url && r.type !== 'image' && el('div', { class: 'res-src' }, el('a', { href: r.url, target: '_blank', rel: 'noopener' }, '🔗 ' + shortUrl(r.url))),
      r.tags && r.tags.length && el('div', { class: 'res-tags' }, ...r.tags.map((t) => el('span', {}, '#' + t))),
    );
    const insightBox = el('div', {});
    if (r.insight) insightBox.append(renderInsight(r));
    body.append(insightBox);

    const foot = el('div', { class: 'res-foot' },
      el('button', { class: 'btn btn-sm btn-accent', onclick: (e) => doInsight(r, e.target, insightBox) }, r.insight ? '✨ Làm mới insight' : '✨ Rút insight bài học'),
      r.type === 'pdf' && el('a', { class: 'btn btn-sm', href: r.url, target: '_blank', rel: 'noopener' }, '📄 Mở PDF'),
      el('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmDelResource(r, skillId) }, '🗑'),
    );

    return el('div', { class: 'res-card' }, media, body, foot);
  }
  const TYPE_LABEL = { text: '📝 Text', image: '🖼️ Ảnh', pdf: '📄 PDF', youtube: '▶️ YouTube', facebook: '📘 Facebook', link: '🔗 Link' };
  const shortUrl = (u) => { try { return new URL(u, location.origin).host + '…'; } catch { return u; } };

  function renderInsight(r) {
    const box = el('div', { class: 'insight-box' });
    box.append(el('div', { class: 'markdown', html: mdLite(r.insight) }));
    if (r.insightCitations && r.insightCitations.length) {
      const c = el('div', { class: 'cite' }, '🔎 Nguồn: ');
      r.insightCitations.forEach((ct, i) => { c.append(el('a', { href: ct.url, target: '_blank', rel: 'noopener' }, `[${i + 1}] `)); });
      box.append(c);
    }
    return box;
  }
  async function doInsight(r, btn, box) {
    const old = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang rút…';
    try {
      const res = await api.insight(r.id);
      if (res.error === 'no_key') { toast(res.insight, 'err'); }
      else {
        r.insight = res.insight; r.insightCitations = res.citations || [];
        box.innerHTML = ''; box.append(renderInsight(r));
        toast('✨ Đã rút insight!', 'ok');
      }
    } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }
  async function insightAll(skillId) {
    const btn = $('#insightAllBtn');
    btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Đang xử lý…';
    try {
      const { resources } = await api.resources({ skill: skillId });
      let ok = 0;
      for (const r of resources) {
        const res = await api.insight(r.id);
        if (res.error === 'no_key') { toast(res.insight, 'err'); break; }
        if (!res.error) ok++;
      }
      toast(`✨ Đã rút insight cho ${ok} tài liệu.`, 'ok');
      go(State.view); // refresh
    } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  // ---------- AI tab ----------
  function renderAiTab(root, skill, lesson) {
    const historyKey = `chat_${skill.id}_${lesson.id}`;
    let history = lsGet(historyKey, []);

    const wrap = el('div', { class: 'chat-wrap' });
    const head = el('div', { class: 'chat-head' },
      el('span', {}, '🤖 Coach Sale — bối cảnh: '), el('b', {}, lesson.title_vi),
      el('label', { class: 'switch', style: 'margin-left:auto', title: 'Bật để AI tìm kiếm web kèm nguồn' },
        el('input', { type: 'checkbox', id: 'webSearchToggle' }), el('span', { class: 'track' }), el('span', {}, '🔎 Tìm web')
      ),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { history = []; lsSet(historyKey, []); renderLog(); toast('Đã xóa hội thoại.'); } }, '🗑 Xóa')
    );
    const log = el('div', { class: 'chat-log', id: 'chatLog' });
    const suggest = el('div', { class: 'chat-suggest' },
      ...suggestFor(skill, lesson).map((q) => el('button', { class: 'chip', onclick: () => { input.value = q; send(); } }, q))
    );
    const input = el('textarea', { placeholder: 'Hỏi coach về bài học này… (Enter để gửi, Shift+Enter xuống dòng)', rows: 1 });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    const sendBtn = el('button', { class: 'btn btn-primary', onclick: () => send() }, 'Gửi');
    const inputRow = el('div', { class: 'chat-input' }, input, sendBtn);

    wrap.append(head, log, suggest, inputRow);
    root.append(wrap);
    renderLog();

    function renderLog() {
      log.innerHTML = '';
      if (!history.length) {
        log.append(el('div', { class: 'empty', style: 'margin:auto' }, el('div', { class: 'big' }, '💬'), el('p', {}, 'Hỏi coach bất cứ điều gì về bài học, hoặc chọn gợi ý bên dưới.')));
      }
      history.forEach((m) => log.append(msgEl(m)));
      log.scrollTop = log.scrollHeight;
    }
    function msgEl(m) {
      const node = el('div', { class: 'msg ' + (m.role === 'user' ? 'user' : 'ai') });
      node.append(el('div', { class: 'markdown', html: mdLite(m.content) }));
      if (m.citations && m.citations.length) {
        const c = el('div', { class: 'cites' }, '🔎 Nguồn:');
        m.citations.forEach((ct, i) => c.append(el('a', { href: ct.url, target: '_blank', rel: 'noopener' }, `[${i + 1}] ${ct.title || ct.url}`)));
        node.append(c);
      }
      return node;
    }
    async function send() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      history.push({ role: 'user', content: text });
      lsSet(historyKey, history);
      renderLog();
      const thinking = el('div', { class: 'msg ai' }, el('span', { class: 'spinner' }), ' Coach đang soạn…');
      log.append(thinking); log.scrollTop = log.scrollHeight;
      try {
        const webSearch = $('#webSearchToggle').checked;
        const res = await api.chat({
          message: text,
          context: `${skill.name_vi} > ${lesson.title_vi}. Mục tiêu: ${lesson.objective || ''}`,
          webSearch,
          history: history.slice(0, -1).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
        });
        thinking.remove();
        if (res.error === 'no_key') { toast(res.reply, 'err'); }
        history.push({ role: 'ai', content: res.reply || '(không có phản hồi)', citations: res.citations || [] });
        lsSet(historyKey, history);
        renderLog();
      } catch (e) {
        thinking.remove();
        history.push({ role: 'ai', content: 'Lỗi: ' + e.message });
        renderLog();
      }
    }
  }
  function suggestFor(skill, lesson) {
    return [
      `Giải thích ngắn gọn "${lesson.title_vi}" bằng ví dụ thực tế.`,
      'Cho tôi 3 bước hành động áp dụng ngay hôm nay.',
      'Những lỗi thường gặp và cách tránh?',
      'Tạo 3 câu hỏi luyện tập cho bài này.',
    ];
  }

  // ==========================================================================
  // TEXT HELPERS cho TTS / Quiz / Lưu
  // ==========================================================================
  const stripMd = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();

  function lessonPlainLines(skill, lesson) {
    const out = [`${lesson.title_vi}. ${lesson.title_en}.`];
    if (lesson.objective) out.push('Mục tiêu: ' + stripMd(lesson.objective));
    (lesson.blocks || []).forEach((b) => {
      out.push((b.label || b.type) + ':');
      if (b.text) out.push(stripMd(b.text));
      (b.items || []).forEach((it) => out.push(stripMd(it)));
    });
    return out;
  }
  const lessonSpeechText = (skill, lesson) => lessonPlainLines(skill, lesson);
  const lessonPlainText = (skill, lesson) => lessonPlainLines(skill, lesson).join('\n');

  function quizContextLesson(skill, lesson) {
    return `Kỹ năng: ${skill.name_vi}. Bài học: ${lesson.title_vi} (${lesson.title_en}).\n` + lessonPlainText(skill, lesson);
  }
  function quizContextSkill(skill) {
    return `Kỹ năng: ${skill.name_vi} (${skill.name_en}).\nCác bài học:\n` +
      skill.lessons.map((l) => `- ${l.title_vi}: ${stripMd(l.objective || '')}`).join('\n');
  }
  function quizContextAll() {
    return `Toàn khoá ${State.meta.title || 'Sale'}.\n` +
      State.skills.map((s) => `# ${s.name_vi}\n` + s.lessons.map((l) => `- ${l.title_vi}: ${stripMd(l.objective || '')}`).join('\n')).join('\n\n');
  }

  async function saveTextResource(skillId, title, text, tags, type = 'text', url = '') {
    const body = { skillId: skillId || null, type, title, note: text, tags, url };
    const res = await api.addResource(body);
    if (res.error) { toast(res.error, 'err'); return null; }
    toast('📚 Đã lưu vào Thư viện!', 'ok');
    return res;
  }

  // ---- Review log (nhắc nhớ) — localStorage ----
  const reviewGet = (lessonId) => lsGet('review_' + lessonId, null); // {ts, score}
  const reviewSet = (lessonId, obj) => lsSet('review_' + lessonId, obj);
  function needsReview(lesson) {
    const r = reviewGet(lesson.id);
    if (!r) return true;
    if ((r.score ?? 10) < 7) return true;
    if (Date.now() - r.ts > 3 * 24 * 3600 * 1000) return true;
    return false;
  }
  function reviewBadge(skill, lesson) {
    const r = reviewGet(lesson.id);
    if (!r) return el('span', { class: 'badge badge-mut' }, 'Chưa ôn');
    const d = new Date(r.ts).toLocaleDateString('vi-VN');
    return el('span', { class: 'badge ' + (r.score >= 7 ? 'badge-ok' : 'badge-warn') }, `✔ Ôn ${d} · ${r.score}/10`);
  }

  // ==========================================================================
  // 🧠 ĐÀO SÂU TAB
  // ==========================================================================
  const DEEP_PANELS = [
    { kind: 'examples', icon: '🌍', label: 'Ví dụ thực tế' },
    { kind: 'tools', icon: '🧰', label: 'Công cụ / Thư viện' },
    { kind: 'videos', icon: '🎬', label: 'Video liên quan' },
    { kind: 'practice', icon: '🏋️', label: 'Hướng dẫn thực hành' },
  ];
  const deepKey = (skillId, lessonId, kind) => `deep_${skillId}_${lessonId}_${kind}`;

  function renderDeepTab(root, skill, lesson) {
    root.append(
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px' },
        el('button', { class: 'btn btn-sm', onclick: () => TTS.play(deepSpeechText(skill, lesson), '🎧 Đào sâu: ' + lesson.title_vi) }, '🎧 Nghe toàn bộ đào sâu'),
        el('button', { class: 'btn btn-sm', onclick: () => go({ type: 'lesson', skillId: skill.id, lessonId: lesson.id, tab: 'ai' }) }, '🤔 Hỏi AI tra cứu'),
      )
    );

    // Bảng nội dung bài học (cuộn được)
    const contentBox = el('div', { class: 'deep-panel' },
      el('div', { class: 'deep-head' }, el('b', {}, '📖 Nội dung bài học')),
      el('div', { class: 'deep-scroll markdown', html: lessonPlainLines(skill, lesson).map((l) => mdLite(l)).join('<br>') })
    );
    root.append(contentBox);

    DEEP_PANELS.forEach((p) => root.append(deepPanel(skill, lesson, p)));
  }

  function deepPanel(skill, lesson, p) {
    const cacheKey = deepKey(skill.id, lesson.id, p.kind);
    let items = lsGet(cacheKey, []);
    const panel = el('div', { class: 'deep-panel' });
    const holder = el('div', { class: 'deep-items' });
    const genBtn = el('button', { class: 'btn btn-sm btn-accent', onclick: gen }, '✨ Gợi ý bằng AI');
    panel.append(
      el('div', { class: 'deep-head' },
        el('b', {}, p.icon + ' ' + p.label),
        el('div', { style: 'margin-left:auto;display:flex;gap:6px' }, genBtn,
          el('button', { class: 'btn btn-sm btn-ghost', title: 'Nghe mục này', onclick: () => TTS.play(panelSpeech(p, items), '🎧 ' + p.label) }, '🎧'))
      ),
      holder
    );
    renderItems();
    return panel;

    function renderItems() {
      holder.innerHTML = '';
      if (!items.length) { holder.append(el('div', { class: 'deep-empty' }, 'Chưa có. Bấm “✨ Gợi ý bằng AI”.')); return; }
      items.forEach((it, idx) => holder.append(deepItemCard(skill, lesson, p, it, idx, () => { items.splice(idx, 1); lsSet(cacheKey, items); renderItems(); })));
    }
    async function gen() {
      genBtn.disabled = true; const old = genBtn.textContent; genBtn.innerHTML = '<span class="spinner"></span> Đang tìm…';
      try {
        const res = await api.genKnowledge({ kind: p.kind, context: `${skill.name_vi} — ${lesson.title_vi}. ${stripMd(lesson.objective || '')}` });
        if (res.error === 'no_key') toast(res.message || res.error, 'err');
        else if (res.error) toast(res.message || 'Lỗi AI', 'err');
        else if (!res.items || !res.items.length) toast('AI chưa trả về kết quả, thử lại.', 'err');
        else { items = res.items; lsSet(cacheKey, items); renderItems(); toast(`✨ Đã gợi ý ${items.length} mục.`, 'ok'); }
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
      finally { genBtn.disabled = false; genBtn.textContent = old; }
    }
  }

  function deepItemCard(skill, lesson, p, it, idx, onRemove) {
    const isVideo = p.kind === 'videos' && /youtu/.test(it.url || '');
    const card = el('div', { class: 'deep-item' },
      el('div', { class: 'di-body' },
        el('b', {}, it.title || '(mục)'),
        it.detail && el('div', { class: 'di-detail markdown', html: mdLite(it.detail) }),
        it.url && el('a', { class: 'di-url', href: it.url, target: '_blank', rel: 'noopener' }, '🔗 ' + it.url),
      ),
      el('div', { class: 'di-foot' },
        el('button', { class: 'btn btn-sm btn-accent', onclick: save }, '💾 Lưu vào thư viện'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: onRemove }, '✕ Bỏ'),
      )
    );
    return card;
    async function save() {
      let type = 'text', url = it.url || '';
      if (isVideo) type = 'youtube';
      else if (/^https?:/.test(url) && p.kind !== 'practice') type = 'link';
      const title = `[${p.label}] ${it.title}`;
      const note = it.detail || it.title;
      const tags = ['đào-sâu', p.kind, skill.id];
      await saveTextResource(skill.id, title, note, tags, type, type === 'text' ? '' : url);
    }
  }

  const panelSpeech = (p, items) => [p.label + ':', ...items.flatMap((it) => [stripMd(it.title || ''), stripMd(it.detail || '')].filter(Boolean))];
  function deepSpeechText(skill, lesson) {
    const out = ['Nội dung bài học.', ...lessonPlainLines(skill, lesson)];
    DEEP_PANELS.forEach((p) => {
      const items = lsGet(deepKey(skill.id, lesson.id, p.kind), []);
      if (items.length) out.push(...panelSpeech(p, items));
    });
    return out;
  }

  // ==========================================================================
  // 🎧 TTS MINI-PLAYER (Web Speech API)
  // ==========================================================================
  const TTS = (() => {
    const synth = window.speechSynthesis;
    let queue = [], idx = 0, playing = false, rate = 1, voice = null, title = '';
    let bar = null;
    function voices() { return synth ? synth.getVoices() : []; }
    function pickVoice() {
      const vs = voices();
      const savedName = lsGet('tts_voice', '');
      voice = vs.find((v) => v.name === savedName) || vs.find((v) => /vi[-_]?VN/i.test(v.lang)) || vs.find((v) => /vi/i.test(v.lang)) || vs[0] || null;
    }
    function ensureBar() {
      if (bar) return;
      bar = el('div', { class: 'tts-bar', id: 'ttsBar' });
      document.body.append(bar);
    }
    function renderBar() {
      if (!bar) return;
      bar.innerHTML = '';
      bar.append(
        el('div', { class: 'tts-title' }, '🎧 ', el('span', {}, title)),
        el('div', { class: 'tts-ctrls' },
          el('button', { class: 'icon-btn', title: 'Câu trước', onclick: prev }, '⏮'),
          el('button', { class: 'icon-btn', title: (playing && !synth.paused) ? 'Tạm dừng' : 'Phát', onclick: toggle }, (playing && synth && !synth.paused) ? '⏸' : '▶'),
          el('button', { class: 'icon-btn', title: 'Câu sau', onclick: next }, '⏭'),
          rateSelect(),
          voiceSelect(),
          el('span', { class: 'tts-pos' }, `${Math.min(idx + 1, queue.length)}/${queue.length}`),
          el('button', { class: 'icon-btn', title: 'Đóng', onclick: stop }, '✕'),
        )
      );
    }
    function rateSelect() {
      const sel = el('select', { class: 'tts-sel', title: 'Tốc độ', onchange: (e) => { rate = parseFloat(e.target.value); lsSet('tts_rate', rate); if (playing) { synth.cancel(); speak(); } } });
      [0.8, 1, 1.15, 1.3, 1.5].forEach((r) => sel.append(el('option', { value: r, selected: r === rate ? '' : null }, r + '×')));
      return sel;
    }
    function voiceSelect() {
      const sel = el('select', { class: 'tts-sel', title: 'Giọng đọc', onchange: (e) => { const v = voices().find((x) => x.name === e.target.value); if (v) { voice = v; lsSet('tts_voice', v.name); if (playing) { synth.cancel(); speak(); } } } });
      voices().forEach((v) => sel.append(el('option', { value: v.name, selected: voice && v.name === voice.name ? '' : null }, `${v.name} (${v.lang})`)));
      if (!voices().length) sel.append(el('option', {}, 'Giọng mặc định'));
      return sel;
    }
    function speak() {
      if (idx >= queue.length) { stop(); return; }
      const u = new SpeechSynthesisUtterance(queue[idx]);
      u.rate = rate; u.lang = (voice && voice.lang) || 'vi-VN'; if (voice) u.voice = voice;
      u.onend = () => { if (playing) { idx++; renderBar(); speak(); } };
      u.onerror = () => { if (playing) { idx++; speak(); } };
      synth.speak(u);
      renderBar();
    }
    function play(sentences, t) {
      if (!synth) { toast('Trình duyệt không hỗ trợ đọc (TTS).', 'err'); return; }
      queue = (Array.isArray(sentences) ? sentences : [String(sentences)]).map((s) => stripMd(s)).filter(Boolean);
      if (!queue.length) { toast('Không có nội dung để đọc.', 'err'); return; }
      title = (t || 'Đang đọc').replace(/^🎧\s*/, ''); idx = 0; playing = true;
      rate = lsGet('tts_rate', 1); pickVoice();
      synth.cancel(); ensureBar(); bar.classList.add('show'); renderBar(); speak();
    }
    function toggle() {
      if (!playing) return;
      if (synth.paused) { synth.resume(); }
      else if (synth.speaking) { synth.pause(); }
      // toggle icon via a manual flag: use speaking/paused
      renderBar();
    }
    function next() { if (!queue.length) return; synth.cancel(); idx = Math.min(idx + 1, queue.length - 1); speak(); }
    function prev() { if (!queue.length) return; synth.cancel(); idx = Math.max(idx - 1, 0); speak(); }
    function stop() { playing = false; if (synth) synth.cancel(); if (bar) bar.classList.remove('show'); }
    if (synth && typeof synth.onvoiceschanged !== 'undefined') synth.onvoiceschanged = () => { if (bar && bar.classList.contains('show')) renderBar(); };
    return { play, stop };
  })();

  // ==========================================================================
  // 📝 QUIZ / KIỂM TRA
  // ==========================================================================
  // opts: {context, title, mcq, essay, skillId, review:{key}}
  async function startQuiz(opts) {
    const loading = openModal({
      title: '📝 ' + (opts.title || 'Kiểm tra'),
      bodyNodes: [el('div', { class: 'empty' }, el('span', { class: 'spinner' }), ' Đang soạn đề bằng AI…')],
    });
    let data;
    try {
      data = await api.quizGen({ context: opts.context, mcq: opts.mcq ?? 4, essay: opts.essay ?? 1 });
    } catch (e) { loading.close(); return toast('Lỗi: ' + e.message, 'err'); }
    loading.close();
    if (data.error === 'no_key') return toast(data.message || 'Chưa cấu hình OpenAI API key. Vào ⚙️ Cài đặt.', 'err');
    if (!data.questions || !data.questions.length) return toast(data.message || 'Không tạo được đề, thử lại.', 'err');
    renderQuizModal(opts, data.questions);
  }

  function renderQuizModal(opts, questions) {
    const answers = {}; // idx -> value (number for mcq, string for essay)
    const body = el('div', {});
    questions.forEach((q, i) => {
      const qb = el('div', { class: 'quiz-q' }, el('div', { class: 'quiz-qtitle' }, `Câu ${i + 1}. `, el('span', { class: 'markdown', html: mdLite(q.q) })));
      if (q.type === 'mcq' && Array.isArray(q.options)) {
        q.options.forEach((opt, oi) => {
          const id = `q${i}_${oi}`;
          const row = el('label', { class: 'quiz-opt', for: id },
            el('input', { type: 'radio', name: 'q' + i, id, onchange: () => { answers[i] = oi; } }),
            el('span', { class: 'markdown', html: mdLite(opt) }));
          qb.append(row);
        });
      } else {
        const ta = el('textarea', { class: 'quiz-essay', rows: 4, placeholder: 'Nhập câu trả lời của bạn…', oninput: (e) => { answers[i] = e.target.value; } });
        qb.append(ta);
      }
      body.append(qb);
    });

    const resultBox = el('div', { id: 'quizResult' });
    body.append(resultBox);

    const submitBtn = el('button', { class: 'btn btn-primary', onclick: submit }, '✅ Nộp bài & chấm');
    const m = openModal({
      title: '📝 ' + (opts.title || 'Kiểm tra'),
      wide: true,
      bodyNodes: [body],
      footNodes: [el('button', { class: 'btn', onclick: () => m.close() }, 'Đóng'), submitBtn],
    });

    async function submit() {
      submitBtn.disabled = true; const old = submitBtn.textContent; submitBtn.innerHTML = '<span class="spinner"></span> Đang chấm…';
      try {
        // chấm MCQ ở client
        let scoreSum = 0, scoreCount = 0;
        const review = [];
        const essays = [];
        questions.forEach((q, i) => {
          if (q.type === 'mcq') {
            const correct = answers[i] === q.answer;
            scoreSum += correct ? 10 : 0; scoreCount++;
            review.push({ i, type: 'mcq', correct, q, chosen: answers[i], });
          } else {
            essays.push({ i, q: q.q, guide: q.guide, answer: answers[i] || '' });
          }
        });
        // chấm tự luận qua AI
        let essayResults = [];
        if (essays.length) {
          const gr = await api.quizGrade({ items: essays.map((e) => ({ q: e.q, guide: e.guide, answer: e.answer })) });
          if (gr.error === 'no_key') toast(gr.message || 'Thiếu API key, câu tự luận không chấm được.', 'err');
          essayResults = gr.results || [];
        }
        essays.forEach((e, k) => {
          const r = essayResults[k] || { score: 0, feedback: '(chưa chấm được)' };
          scoreSum += Number(r.score) || 0; scoreCount++;
          review.push({ i: e.i, type: 'essay', score: r.score, feedback: r.feedback, q: questions[e.i], answer: e.answer });
        });
        const total = scoreCount ? Math.round((scoreSum / scoreCount) * 10) / 10 : 0;
        renderQuizResult(resultBox, opts, questions, review, total);
        // lưu reviewlog cho kiểm tra nhanh theo bài
        if (opts.review && opts.review.key) { reviewSet(opts.review.key, { ts: Date.now(), score: Math.round(total) }); }
        submitBtn.style.display = 'none';
      } catch (e) { toast('Lỗi chấm bài: ' + e.message, 'err'); }
      finally { submitBtn.disabled = false; submitBtn.textContent = old; }
    }
  }

  function renderQuizResult(box, opts, questions, review, total) {
    box.innerHTML = '';
    box.append(el('div', { class: 'quiz-score' }, `🏆 Điểm tổng: ${total}/10`));
    const detail = review.sort((a, b) => a.i - b.i);
    const lines = [`KẾT QUẢ KIỂM TRA: ${opts.title || ''} — Điểm ${total}/10`, ''];
    detail.forEach((r) => {
      const wrap = el('div', { class: 'quiz-review ' + (r.type === 'mcq' ? (r.correct ? 'ok' : 'bad') : '') });
      if (r.type === 'mcq') {
        wrap.append(el('div', {}, el('b', {}, `Câu ${r.i + 1}: `), r.correct ? '✅ Đúng' : '❌ Sai'));
        wrap.append(el('div', { class: 'markdown', html: '<b>Đáp án đúng:</b> ' + mdLite(r.q.options[r.q.answer] || '') }));
        if (r.q.explain) wrap.append(el('div', { class: 'markdown', html: '<i>Giải thích:</i> ' + mdLite(r.q.explain) }));
        lines.push(`Câu ${r.i + 1} (TN): ${r.correct ? 'Đúng' : 'Sai'}. Đáp án: ${stripMd(r.q.options[r.q.answer] || '')}. ${stripMd(r.q.explain || '')}`);
      } else {
        wrap.append(el('div', {}, el('b', {}, `Câu ${r.i + 1} (tự luận): `), `${r.score}/10`));
        if (r.feedback) wrap.append(el('div', { class: 'markdown', html: '<i>Nhận xét:</i> ' + mdLite(r.feedback) }));
        lines.push(`Câu ${r.i + 1} (TL): ${r.score}/10. Nhận xét: ${stripMd(r.feedback || '')}`);
      }
      box.append(wrap);
    });
    box.append(
      el('div', { style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' },
        el('button', { class: 'btn btn-sm btn-accent', onclick: () => saveTextResource(opts.skillId || null, '📝 ' + (opts.title || 'Kết quả kiểm tra'), lines.join('\n'), ['kiểm-tra', 'nhắc-nhớ']) }, '📚 Lưu kết quả vào thư viện'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => TTS.play(lines, '🎧 Kết quả kiểm tra') }, '🎧 Nghe kết quả'),
      )
    );
  }

  // ==========================================================================
  // MODALS
  // ==========================================================================
  function openModal({ title, bodyNodes, footNodes, wide }) {
    const root = $('#modalRoot');
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
    const modal = el('div', { class: 'modal' + (wide ? ' wide' : '') },
      el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'icon-btn x', onclick: close }, '✕')),
      el('div', { class: 'modal-body' }, ...bodyNodes),
      footNodes && el('div', { class: 'modal-foot' }, ...footNodes),
    );
    overlay.append(modal);
    root.append(overlay);
    function close() { overlay.remove(); }
    return { close, modal };
  }

  function field(label, input, hint) {
    return el('div', { class: 'field' }, el('label', {}, label), input, hint && el('div', { class: 'hint' }, hint));
  }

  function openAddSkill() {
    const nameVi = el('input', { placeholder: 'VD: Telesale — Bán hàng qua điện thoại' });
    const nameEn = el('input', { placeholder: 'e.g. Telesales' });
    const icon = el('input', { placeholder: '📞', maxlength: 4, value: '📌' });
    const summary = el('textarea', { placeholder: 'Mô tả ngắn về kỹ năng…' });
    const m = openModal({
      title: '➕ Thêm kỹ năng mới / New Skill',
      bodyNodes: [
        field('Tên (Tiếng Việt) *', nameVi),
        field('Name (English)', nameEn),
        el('div', { class: 'grid-2' }, field('Icon (emoji)', icon), el('div')),
        field('Mô tả / Summary', summary),
      ],
      footNodes: [
        el('button', { class: 'btn', onclick: () => m.close() }, 'Hủy'),
        el('button', { class: 'btn btn-primary', onclick: submit }, '✅ Tạo kỹ năng'),
      ],
    });
    async function submit() {
      if (!nameVi.value.trim() && !nameEn.value.trim()) return toast('Nhập tên kỹ năng.', 'err');
      const res = await api.addSkill({ name_vi: nameVi.value.trim(), name_en: nameEn.value.trim(), icon: icon.value.trim() || '📌', summary: summary.value.trim() });
      if (res.error) return toast(res.error, 'err');
      await loadSkills(); renderSidebar($('#searchInput').value);
      m.close(); toast('✅ Đã thêm kỹ năng!', 'ok');
      go({ type: 'skill', id: res.id });
    }
  }

  function openAddLesson(skillId) {
    const titleVi = el('input', { placeholder: 'VD: Kỹ thuật chốt đơn nhanh' });
    const titleEn = el('input', { placeholder: 'e.g. Fast closing techniques' });
    const objective = el('input', { placeholder: 'Mục tiêu bài học…' });
    const mkArea = (ph) => el('textarea', { placeholder: ph, rows: 3 });
    const concept = mkArea('Mỗi dòng 1 ý khái niệm…');
    const steps = mkArea('Mỗi dòng 1 bước…');
    const technique = mkArea('Mỗi dòng 1 kỹ thuật…');
    const example = mkArea('Một ví dụ thực tế (đoạn văn)…');
    const practice = mkArea('Mỗi dòng 1 bài tập…');
    const pitfall = mkArea('Mỗi dòng 1 lỗi thường gặp…');
    const terms = mkArea('Mỗi dòng 1 thuật ngữ, VD: SKU = đơn vị lưu kho');

    const m = openModal({
      title: '➕ Thêm bài học / New Lesson',
      wide: true,
      bodyNodes: [
        el('div', { class: 'grid-2' }, field('Tiêu đề (VI) *', titleVi), field('Title (EN)', titleEn)),
        field('🎯 Mục tiêu / Objective', objective),
        el('div', { class: 'grid-2' },
          field('💡 Khái niệm (mỗi dòng 1 ý)', concept),
          field('🪜 Quy trình (mỗi dòng 1 bước)', steps),
        ),
        el('div', { class: 'grid-2' },
          field('🛠️ Kỹ thuật (mỗi dòng 1 ý)', technique),
          field('✍️ Bài tập (mỗi dòng 1 ý)', practice),
        ),
        field('📌 Ví dụ (đoạn văn)', example),
        el('div', { class: 'grid-2' },
          field('⚠️ Lỗi thường gặp (mỗi dòng 1 ý)', pitfall),
          field('🔤 Thuật ngữ (mỗi dòng 1 ý)', terms),
        ),
      ],
      footNodes: [
        el('button', { class: 'btn', onclick: () => m.close() }, 'Hủy'),
        el('button', { class: 'btn btn-primary', onclick: submit }, '✅ Tạo bài học'),
      ],
    });
    const lines = (t) => t.value.split('\n').map((s) => s.trim()).filter(Boolean);
    async function submit() {
      if (!titleVi.value.trim() && !titleEn.value.trim()) return toast('Nhập tiêu đề bài học.', 'err');
      const blocks = [];
      const push = (type, label, area) => { const it = lines(area); if (it.length) blocks.push({ type, label, items: it }); };
      push('concept', 'Khái niệm', concept);
      push('steps', 'Quy trình', steps);
      push('technique', 'Kỹ thuật', technique);
      if (example.value.trim()) blocks.push({ type: 'example', label: 'Ví dụ', text: example.value.trim() });
      push('practice', 'Bài tập', practice);
      push('pitfall', 'Lỗi thường gặp', pitfall);
      push('terms', 'Thuật ngữ', terms);
      const res = await api.addLesson(skillId, { title_vi: titleVi.value.trim(), title_en: titleEn.value.trim(), objective: objective.value.trim(), blocks });
      if (res.error) return toast(res.error, 'err');
      await loadSkills(); renderSidebar($('#searchInput').value);
      m.close(); toast('✅ Đã thêm bài học!', 'ok');
      go({ type: 'lesson', skillId, lessonId: res.id, tab: 'learn' });
    }
  }

  function openAddResource(skillId, onDone) {
    const type = el('select', {},
      el('option', { value: 'text' }, '📝 Text (ghi chú)'),
      el('option', { value: 'image' }, '🖼️ Ảnh (upload)'),
      el('option', { value: 'pdf' }, '📄 PDF (upload)'),
      el('option', { value: 'youtube' }, '▶️ YouTube (link nhúng)'),
      el('option', { value: 'facebook' }, '📘 Facebook Reel/Video (link nhúng)'),
      el('option', { value: 'link' }, '🔗 Link (website)'),
    );
    const title = el('input', { placeholder: 'Tiêu đề tài liệu' });
    const url = el('input', { placeholder: 'Dán link (YouTube/Facebook/website)…' });
    const fileInput = el('input', { type: 'file', accept: 'image/*,application/pdf' });
    const note = el('textarea', { placeholder: 'Ghi chú / nội dung (hỗ trợ **đậm**, *nghiêng*)…' });
    const tags = el('input', { placeholder: 'tag1, tag2, tag3' });

    const urlField = field('🔗 Link', url, 'Dùng cho YouTube / Facebook / Link.');
    const fileField = field('📎 Chọn file (≤50MB)', fileInput, 'Dùng cho Ảnh / PDF.');
    const noteField = field('📝 Nội dung / Ghi chú', note);

    function sync() {
      const t = type.value;
      urlField.style.display = ['youtube', 'facebook', 'link', 'text'].includes(t) ? '' : 'none';
      urlField.style.display = ['youtube', 'facebook', 'link'].includes(t) ? '' : 'none';
      fileField.style.display = ['image', 'pdf'].includes(t) ? '' : 'none';
      noteField.style.display = t === 'text' ? '' : noteField.style.display; // note luôn hiển thị
    }
    type.addEventListener('change', sync);

    const m = openModal({
      title: '📎 Thêm tài liệu / Add Resource',
      bodyNodes: [ field('Loại / Type', type), field('Tiêu đề / Title', title), urlField, fileField, noteField, field('🏷 Tags (phân cách bằng dấu phẩy)', tags) ],
      footNodes: [
        el('button', { class: 'btn', onclick: () => m.close() }, 'Hủy'),
        el('button', { class: 'btn btn-accent', onclick: submit }, '✅ Lưu tài liệu'),
      ],
    });
    sync();

    async function submit() {
      const t = type.value;
      try {
        let res;
        if (t === 'image' || t === 'pdf') {
          if (!fileInput.files[0]) return toast('Chọn file để upload.', 'err');
          const fd = new FormData();
          fd.append('file', fileInput.files[0]);
          fd.append('skillId', skillId || '');
          fd.append('title', title.value.trim());
          fd.append('note', note.value.trim());
          fd.append('tags', tags.value.trim());
          res = await api.uploadResource(fd);
        } else {
          if ((t === 'youtube' || t === 'facebook' || t === 'link') && !url.value.trim()) return toast('Dán link vào.', 'err');
          res = await api.addResource({ skillId: skillId || null, type: t, title: title.value.trim(), url: url.value.trim(), note: note.value.trim(), tags: tags.value.trim() });
        }
        if (res.error) return toast(res.error, 'err');
        m.close(); toast('✅ Đã thêm tài liệu!', 'ok');
        if (onDone) onDone(); else go(State.view);
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    }
  }

  async function openLibrary(presetSkill = '') {
    const search = el('input', { type: 'search', placeholder: '🔎 Tìm tài liệu…' });
    const typeSel = el('select', {}, el('option', { value: '' }, 'Tất cả loại'),
      ...['text', 'image', 'pdf', 'youtube', 'facebook', 'link'].map((t) => el('option', { value: t }, TYPE_LABEL[t])));
    const skillSel = el('select', {}, el('option', { value: '' }, 'Tất cả kỹ năng'),
      ...State.skills.map((s) => el('option', { value: s.id, selected: s.id === presetSkill ? '' : null }, s.icon + ' ' + s.name_vi)));
    if (presetSkill) skillSel.value = presetSkill;

    const holder = el('div', {}, el('div', { class: 'empty' }, el('span', { class: 'spinner' }), ' Đang tải…'));
    const m = openModal({
      title: '📚 Thư viện chung / Library',
      wide: true,
      bodyNodes: [
        el('div', { class: 'filter-row' }, search, typeSel, skillSel,
          el('button', { class: 'btn btn-accent btn-sm', onclick: () => openAddResource(skillSel.value || '', load) }, '➕ Thêm')),
        holder,
      ],
    });
    const load = debounce(async () => {
      holder.innerHTML = '<div class="empty"><span class="spinner"></span> Đang tải…</div>';
      const params = {};
      if (search.value.trim()) params.q = search.value.trim();
      if (typeSel.value) params.type = typeSel.value;
      if (skillSel.value) params.skill = skillSel.value;
      const { resources } = await api.resources(params);
      renderResourceGrid(holder, resources, skillSel.value);
    }, 250);
    [search, typeSel, skillSel].forEach((n) => n.addEventListener('input', load));
    load();
  }

  // ---------- Confirms ----------
  function confirmModal(msg, onYes, yesLabel = 'Xóa') {
    const m = openModal({
      title: '⚠️ Xác nhận',
      bodyNodes: [el('p', {}, msg)],
      footNodes: [
        el('button', { class: 'btn', onclick: () => m.close() }, 'Hủy'),
        el('button', { class: 'btn btn-danger', onclick: async () => { await onYes(); m.close(); } }, '🗑 ' + yesLabel),
      ],
    });
  }
  function confirmDelSkill(skill) {
    confirmModal(`Xóa kỹ năng "${skill.name_vi}" cùng toàn bộ bài học & tài liệu của nó? Không thể hoàn tác.`, async () => {
      const res = await api.delSkill(skill.id);
      if (res.error) return toast(res.error, 'err');
      await loadSkills(); renderSidebar(); toast('Đã xóa kỹ năng.', 'ok'); go({ type: 'home' });
    });
  }
  function confirmDelLesson(skill, lesson) {
    confirmModal(`Xóa bài học "${lesson.title_vi}"?`, async () => {
      const res = await api.delLesson(skill.id, lesson.id);
      if (res.error) return toast(res.error, 'err');
      await loadSkills(); renderSidebar(); toast('Đã xóa bài học.', 'ok'); go({ type: 'skill', id: skill.id });
    });
  }
  function confirmDelResource(r, skillId) {
    confirmModal(`Xóa tài liệu "${r.title}"?`, async () => {
      const res = await api.delResource(r.id);
      if (res.error) return toast(res.error, 'err');
      toast('Đã xóa tài liệu.', 'ok'); go(State.view);
    });
  }

  // ---------- Settings ----------
  async function openSettings() {
    const s = await api.getSettings().catch(() => ({}));
    const key = el('input', { type: 'password', placeholder: s.hasKey ? '•••••••• (đã có key)' : 'sk-...' });
    const model = el('input', { value: s.model || 'gpt-4o-mini', placeholder: 'gpt-4o-mini' });
    const m = openModal({
      title: '⚙️ Cài đặt AI / Settings',
      bodyNodes: [
        el('p', { style: 'font-size:13px;color:var(--text-soft)' }, 'Nhập OpenAI API key để bật tính năng 🤖 Hỏi AI và ✨ Rút insight. Key chỉ lưu tại máy chủ (server/data/settings.json), không hiển thị lại.'),
        field('OpenAI API Key', key, s.keyFromEnv ? 'Đang dùng key từ biến môi trường (env).' : (s.hasKey ? 'Đã lưu key. Để trống nếu không đổi.' : '')),
        field('Model', model, 'Mặc định: gpt-4o-mini. Có thể dùng gpt-4o, gpt-4.1-mini…'),
        el('p', { style: 'font-size:12.5px;color:var(--text-mut)' }, 'Lấy key tại: '), el('a', { href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener' }, 'platform.openai.com/api-keys'),
      ],
      footNodes: [
        el('button', { class: 'btn', onclick: () => m.close() }, 'Đóng'),
        el('button', { class: 'btn btn-primary', onclick: submit }, '💾 Lưu'),
      ],
    });
    async function submit() {
      const body = { model: model.value.trim() };
      if (key.value.trim()) body.apiKey = key.value.trim();
      const res = await api.saveSettings(body);
      if (res.error) return toast(res.error, 'err');
      m.close(); toast('💾 Đã lưu cài đặt.', 'ok');
    }
  }

  // ==========================================================================
  // ROUTER
  // ==========================================================================
  function go(view) {
    State.view = view;
    lsSet('lastView', view);
    if (window.innerWidth <= 860) closeSidebar();
    if (view.type === 'home') renderHome();
    else if (view.type === 'skill') renderSkill(view.id);
    else if (view.type === 'lesson') renderLesson(view.skillId, view.lessonId, view.tab || 'learn');
    renderSidebar($('#searchInput').value);
    window.scrollTo(0, 0);
  }

  // ---------- Theme ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
    lsSet('theme', t);
  }

  // ---------- Sidebar toggle (mobile) ----------
  function openSidebar() { $('#sidebar').classList.add('open'); $('#backdrop').classList.add('show'); }
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('show'); }

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ==========================================================================
  // INIT
  // ==========================================================================
  async function init() {
    applyTheme(lsGet('theme', window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

    $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#libraryBtn').addEventListener('click', () => openLibrary());
    $('#addSkillBtn').addEventListener('click', openAddSkill);
    $('#menuBtn').addEventListener('click', () => ($('#sidebar').classList.contains('open') ? closeSidebar() : openSidebar()));
    $('#backdrop').addEventListener('click', closeSidebar);
    $('#searchInput').addEventListener('input', debounce((e) => renderSidebar(e.target.value), 150));

    try {
      await loadSkills();
    } catch (e) {
      $('#main').innerHTML = '<div class="empty"><div class="big">⚠️</div><p>Không tải được dữ liệu. Kiểm tra server.</p></div>';
      return;
    }
    renderSidebar();
    const last = lsGet('lastView', { type: 'home' });
    // đảm bảo view còn hợp lệ
    if (last.type === 'skill' && !findSkill(last.id)) go({ type: 'home' });
    else if (last.type === 'lesson' && !(findSkill(last.skillId) && findLesson(findSkill(last.skillId), last.lessonId))) go({ type: 'home' });
    else go(last);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
