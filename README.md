# 🛒 Tự học Sale — Ứng dụng web tự học Bán hàng & Thương mại

Ứng dụng web **tự học kỹ năng Sale** song ngữ **Việt–Anh**, kiến trúc nhẹ (Node.js + Express + Vanilla JS, không framework nặng, không build step). Học theo **kỹ năng → bài học → block nội dung**, kèm **thư viện tài liệu**, **rút insight bằng AI** và **coach AI hỏi–đáp**.

> Tham chiếu app mẫu: Leadership Skills — https://leadership-skills-app.onrender.com

---

## ✨ Tính năng chính

- **3 kỹ năng seed sẵn nội dung thực chiến** (mở rộng thêm được):
  - 🏪 **General Trade** — kênh truyền thống (chợ, tạp hoá, NPP)
  - 🏬 **Modern Trade** — kênh hiện đại (siêu thị, chuỗi, MT/KA)
  - 🤝 **B2B Sales** — bán hàng doanh nghiệp (SPIN, bán tư vấn)
- Mỗi kỹ năng **5 bài học**, mỗi bài đủ block: Khái niệm / Quy trình / Kỹ thuật / Ví dụ / Bài tập / Lỗi thường gặp / Thuật ngữ.
- **Sidebar** gập/mở theo kỹ năng + ô tìm kiếm; **trang chủ** hero + lưới thẻ kỹ năng (số bài, đã xong, số tài liệu).
- **Trang bài học 4 tab**: 📖 Bài học · 🧠 Đào sâu · 📚 Thư viện · 🤖 Hỏi AI (có công tắc 🔎 tìm web kèm nguồn).
- **🧠 Đào sâu** (AI gợi ý): Ví dụ thực tế · Công cụ/Thư viện · **🎬 Video liên quan (tìm YouTube đúng chủ đề)** · Hướng dẫn thực hành. Mỗi gợi ý có **💾 Lưu vào Thư viện**.
- **🎧 Text-to-Speech (chế độ ngồi xe)**: nghe cả bài học **và toàn bộ nội dung đào sâu** (nội dung bài + ví dụ + công cụ + video + thực hành) qua mini-player cố định đáy màn hình (phát/dừng, câu trước/sau, chỉnh tốc độ, chọn giọng ưu tiên vi-VN).
- **📝 Thu hoạch / Kiểm tra**: trắc nghiệm (tự chấm) + tự luận (AI chấm điểm /10 kèm nhận xét), theo **bài (kiểm tra nhanh)**, **module** và **tổng kết toàn khoá**. Có **🔁 Cần ôn lại** (nhắc ôn bài đã học quá 3 ngày / chưa kiểm tra / điểm < 7).
- **Mọi kết quả AI** (đào sâu + kết quả kiểm tra) đều **lưu được vào Thư viện** làm nguồn tài liệu (feature theo yêu cầu).
- **Thư viện tài liệu**: text / ảnh / PDF / YouTube / Facebook Reel / link. Video dán link **nhúng xem trực tiếp**; ảnh/PDF **upload**. Có tag + source link.
- **Thư viện chung** (modal): tìm kiếm + lọc theo loại + theo kỹ năng.
- **✨ Rút insight bằng AI** cho từng tài liệu (cache lại, có nút *Làm mới*) + *Rút insight tất cả*.
- **Thêm/Xóa** kỹ năng·bài học·tài liệu (kỹ năng builtin không xóa được).
- **Đánh dấu hoàn thành** từng bài + **thanh tiến độ %** (lưu `localStorage`, prefix `sale_`).
- **Dark/Light theme**, **responsive** (sidebar thu gọn trên mobile, nút ☰).
- **Chạy 2 nơi**: host Node (đầy đủ) **hoặc** hosting tĩnh Netlify (tự dùng `localStorage` + gọi thẳng OpenAI).

---

## 🚀 Cách chạy (local)

```bash
npm install
npm start
```

Mặc định chạy tại `http://localhost:3000`. Nếu cổng bận, đặt cổng khác:

```bash
PORT=3100 npm start
```

## 🤖 Bật AI (Hỏi AI + Rút insight)

- Mở **⚙️ Cài đặt** trên app → dán **OpenAI API Key** → Lưu.
  (Key lưu tại `server/data/settings.json`, đã nằm trong `.gitignore`, không hiển thị lại.)
- Hoặc dùng biến môi trường: `OPENAI_API_KEY=sk-...` (và tuỳ chọn `OPENAI_MODEL`, mặc định `gpt-4o-mini`).
- Bật công tắc **🔎 Tìm web** trong tab Hỏi AI để trả lời kèm **nguồn (citations)** — dùng OpenAI Responses API + `web_search`.
- Lấy key: https://platform.openai.com/api-keys

---

## 🗂 Cấu trúc thư mục

```
├─ server/
│  ├─ server.js        ← Express: API kỹ năng/giáo trình, thư viện, proxy ChatGPT, insight
│  └─ data/
│     ├─ skills.json   ← giáo trình (seed nội dung thật)
│     ├─ library.json  ← tài liệu thư viện (seed nguồn thật)
│     ├─ settings.json ← API key + model (tự sinh, .gitignore)
│     └─ uploads/      ← ảnh & PDF upload
├─ public/
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/app.js          ← toàn bộ logic frontend
│  ├─ js/api-static.js   ← lớp giả lập backend cho hosting tĩnh
│  └─ data/              ← bản seed tĩnh (copy skills.json + library.json)
├─ package.json
├─ render.yaml
├─ netlify.toml
├─ Procfile
├─ .nvmrc
└─ README.md
```

---

## 🔌 Bảng API (Express)

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/skills` | Toàn bộ giáo trình |
| POST | `/api/skills` | Thêm kỹ năng `{name_vi,name_en,icon,summary}` |
| DELETE | `/api/skills/:id` | Xóa kỹ năng (kèm tài liệu của nó; builtin không xóa) |
| POST | `/api/skills/:id/lessons` | Thêm bài học |
| DELETE | `/api/skills/:id/lessons/:lessonId` | Xóa bài học |
| GET | `/api/resources?skill=&type=&q=` | Thư viện (lọc/tìm) |
| POST | `/api/resources` | Thêm text/youtube/facebook/link |
| POST | `/api/resources/upload` | Upload ảnh/PDF (multer, ≤50MB) |
| DELETE | `/api/resources/:id` | Xóa tài liệu (xóa cả file upload) |
| GET/POST | `/api/settings` | OpenAI key + model (key lưu local) |
| POST | `/api/chat` | Proxy ChatGPT (coach; tuỳ chọn web_search) |
| POST | `/api/insight` | Rút insight 1 tài liệu (cache vào library.json) |
| POST | `/api/knowledge/generate` | Sinh gợi ý AI theo `kind` = examples / tools / videos / practice (web_search cho examples/tools/videos) |
| POST | `/api/quiz/generate` | Sinh đề kiểm tra JSON (trắc nghiệm + tự luận) theo ngữ cảnh |
| POST | `/api/quiz/grade` | Chấm câu tự luận → điểm /10 + nhận xét |
| GET | `/healthz` | Health check |

> Static server đặt `Cache-Control: no-store`; link CSS/JS gắn `?v=N` để chống cache bản cũ.

**Mô hình dữ liệu**: xem `server/data/skills.json` và `server/data/library.json`.
Block bài học: `concept | steps | technique | example | practice | pitfall | terms`.
Loại tài liệu: `text | image | pdf | youtube | facebook | link`.
Nội dung hỗ trợ **markdown nhẹ**: `**đậm**`, `*nghiêng*`, xuống dòng.

---

## ☁️ Deploy

### A. Render.com (khuyến nghị — chạy Node đầy đủ)

1. Push repo lên GitHub.
2. Render → **New → Blueprint** → chọn repo (đọc `render.yaml`).
3. Đặt env `OPENAI_API_KEY` (và `OPENAI_MODEL` nếu muốn).
4. Health check: `/healthz`.

> ⚠️ **Gói free KHÔNG có Disk** → dữ liệu thêm mới (skills/library/uploads) sẽ **reset khi service restart**.
> Muốn bền: nâng gói trả phí, bật **Disk**, đặt `DATA_DIR` trỏ vào mount path (ví dụ `/var/data`).
> Khi `DATA_DIR` là ổ ngoài & trống, server **tự copy seed** `skills.json` + `library.json` vào đó ở lần chạy đầu.
> (Xem phần comment trong `render.yaml`.)

Cũng dùng được **Procfile** (`web: npm start`) cho các PaaS khác. Node version cố định ở `.nvmrc` (20).

### B. Netlify (bản static thuần — không backend)

1. Netlify → New site → chọn repo. `netlify.toml` đặt `publish = public`.
2. Không có backend Node: `api-static.js` tự xử lý `/api/*` bằng `localStorage` (seed từ `public/data/*.json`) và **gọi thẳng OpenAI** cho chat/insight.
3. Nhập OpenAI key trong ⚙️ (lưu ở localStorage của trình duyệt).

> Hạn chế chế độ static: mất **upload file lớn** (ảnh/PDF nhúng bằng dataURL, nên chỉ hợp file nhỏ), mất **thư viện dùng chung** giữa nhiều máy, và **không giấu được key** ở server.

---

## 🛡 Độ bền

- `process.on('uncaughtException')` + `unhandledRejection` → 1 lỗi request không làm sập tiến trình.
- `app.listen(PORT, '0.0.0.0')`; middleware bắt lỗi Express trả JSON 500.
- `.gitignore`: `node_modules`, `.env`, `server/data/settings.json`, `server/data/uploads/*` (giữ `.gitkeep`).

---

## 📄 License

MIT.
