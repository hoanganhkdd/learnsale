# 🚀 Deploy & Lưu trữ bền vững (Cloud)

App chạy tốt với file JSON khi dùng local. Khi deploy lên host **miễn phí** (ổ đĩa tạm — Render free…), dữ liệu file sẽ reset khi restart. Để **không mất dữ liệu** (kể cả ảnh), bật **MongoDB** và (tuỳ chọn) đồng bộ **Google Sheets**.

---

## ☁️ 1) MongoDB Atlas (lưu trữ bền vững, miễn phí M0)

Khi đặt biến môi trường `MONGODB_URI`, server tự động:
- **Nạp (hydrate)** skills / thư viện / template từ Mongo khi khởi động (Mongo là nguồn sự thật).
- **Đồng bộ (mirror)** mọi thay đổi lên Mongo ngay khi ghi.
- Lưu **ảnh & PDF** dạng base64 trong collection `files` (theo tên file). Khi ổ đĩa host bị xoá, ảnh vẫn phục vụ được **trực tiếp từ Mongo** qua `/uploads/<tên file>`.

> Không đặt `MONGODB_URI` → app chạy y như cũ (chỉ file JSON).

### Cách lấy connection string
1. Tạo tài khoản **MongoDB Atlas** → tạo **Cluster M0 (Free)**.
2. **Database Access** → tạo user + mật khẩu.
3. **Network Access** → Add IP `0.0.0.0/0` (cho phép mọi nơi) — hoặc IP của host.
4. **Connect → Drivers** → copy chuỗi dạng:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. Đặt biến môi trường trên host (hoặc `.env` khi chạy local):
   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB=learnsale
   ```

Chạy local với Mongo:
```bash
MONGODB_URI="mongodb+srv://..." MONGODB_DB=learnsale npm start
```
Log `[mongo] ✅ Đã kết nối & đồng bộ DB "learnsale".` là thành công.

**Collections tạo ra:** `kv` (skills/library/templates), `files` (ảnh/PDF base64).

---

## 🔗 2) Đồng bộ Google Sheets (Apps Script webhook)

Dùng để **thống kê link & tài liệu** trong một Google Sheet, đồng bộ 1 chiều (App → Sheet).

### Bước 1 — Tạo Google Apps Script
1. Tạo 1 **Google Sheet** mới.
2. Menu **Extensions → Apps Script**, dán đoạn sau:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Resources')
           || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Resources');
  var headers = ['id','title','type','url','tags','skillId','note','createdAt'];
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  var body = JSON.parse(e.postData.contents || '{}');
  var rows = body.rows || [];
  // Lập chỉ mục theo id (cột A) để upsert
  var data = sheet.getDataRange().getValues();
  var idIndex = {};
  for (var i = 1; i < data.length; i++) idIndex[data[i][0]] = i + 1;
  rows.forEach(function (r) {
    var line = headers.map(function (h) { return r[h] != null ? r[h] : ''; });
    if (idIndex[r.id]) sheet.getRange(idIndex[r.id], 1, 1, headers.length).setValues([line]);
    else sheet.appendRow(line);
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, count: rows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. **Deploy → New deployment → Type: Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Copy URL dạng `https://script.google.com/macros/s/…/exec`.

### Bước 2 — Cấu hình trong app
- Mở **⚙️ Cài đặt** → dán URL vào ô **Google Sheets webhook** → Lưu.
- Hoặc đặt env `SHEETS_WEBHOOK_URL=...`.

### Cách dùng
- Mỗi khi **thêm tài liệu** mới → tự đẩy 1 dòng lên Sheet.
- Nút **🔗 Đồng bộ Sheets** trong Thư viện chung → đẩy **toàn bộ** danh sách (upsert theo `id`).

---

## 🖥️ 3) Host

- **Render** (Blueprint `render.yaml`): New → Blueprint → chọn repo → đặt `OPENAI_API_KEY`, `MONGODB_URI` (+ `MONGODB_DB`, `SHEETS_WEBHOOK_URL` nếu dùng). Health check `/healthz`.
- **Railway / Fly / VPS**: `npm install && npm start`, đặt các env như trên.
- Cần host **chạy Node** (không dùng Netlify tĩnh nếu muốn MongoDB + giấu key + upload file).

---

## 🔒 Bảo mật
- Không commit secret. `.gitignore` đã bỏ `.env`, `server/data/settings.json`.
- `MONGODB_URI`, `OPENAI_API_KEY`, `SHEETS_WEBHOOK_URL` đặt qua **biến môi trường** của host.
