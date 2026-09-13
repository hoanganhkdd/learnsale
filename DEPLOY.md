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

## 🔗 2) Google Drive (lưu file) + Google Sheets (thống kê) — 1 Apps Script

Một Apps Script Web App làm cả 2 việc:
- **Lưu ảnh/PDF lên Google Drive** (thư mục `LearnSale Library`), chia sẻ "anyone with link", trả về link Drive.
- **Ghi metadata + link** vào Google Sheet (tab `Resources`) để thống kê/truy xuất.

### Bước 1 — Tạo Google Apps Script
1. Tạo 1 **Google Sheet** mới.
2. Menu **Extensions → Apps Script**, dán đoạn sau (thay toàn bộ):

```javascript
var FOLDER_NAME = 'LearnSale Library';

function doPost(e) {
  // Guard: khi bấm ▶ Run trực tiếp, Google KHÔNG truyền e → tránh lỗi 'postData'
  var body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
  if (body.action === 'upload' && body.file) return handleUpload_(body.file);
  if (body.action === 'remove') return handleRemove_(body);
  return handleRows_(body.rows || []);
}

// Xoá: bỏ file Drive vào thùng rác + xoá dòng trong Sheet theo id
function handleRemove_(body) {
  if (body.driveId) { try { DriveApp.getFileById(body.driveId).setTrashed(true); } catch (err) {} }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Resources');
  if (sheet && body.id) {
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === body.id) sheet.deleteRow(i + 1);
    }
  }
  return json_({ ok: true });
}

// Lưu 1 file lên Google Drive, trả link xem trực tiếp
function handleUpload_(file) {
  var folder = getFolder_(FOLDER_NAME);
  var bytes = Utilities.base64Decode(file.data);
  var blob = Utilities.newBlob(bytes, file.mimetype || 'application/octet-stream', file.title || file.name || 'file');
  var f = folder.createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var id = f.getId();
  return json_({ ok: true, id: id,
    url: 'https://drive.google.com/uc?export=view&id=' + id,
    viewUrl: 'https://drive.google.com/file/d/' + id + '/view' });
}

// Ghi/upsert các dòng metadata vào tab Resources
function handleRows_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Resources') || ss.insertSheet('Resources');
  var headers = ['id','title','type','url','tags','skillId','images','note','createdAt'];
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  else if (sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].indexOf('images') === -1) {
    // Sheet cũ thiếu cột images → chèn cột trước 'note'
    var noteCol = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].indexOf('note') + 1;
    if (noteCol > 0) { sheet.insertColumnBefore(noteCol); sheet.getRange(1, noteCol).setValue('images'); }
  }
  var data = sheet.getDataRange().getValues();
  var idIndex = {};
  for (var i = 1; i < data.length; i++) idIndex[data[i][0]] = i + 1;
  rows.forEach(function (r) {
    var line = headers.map(function (h) { return r[h] != null ? r[h] : ''; });
    if (idIndex[r.id]) sheet.getRange(idIndex[r.id], 1, 1, headers.length).setValues([line]);
    else sheet.appendRow(line);
  });
  return json_({ ok: true, count: rows.length });
}

function getFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Mở URL /exec: tạo folder nếu chưa có và TRẢ LUÔN LINK FOLDER
function doGet() {
  var f = getFolder_(FOLDER_NAME);
  return json_({ ok: true, msg: 'Webhook alive', folder: f.getUrl() });
}

// ▶ Chạy hàm này 1 lần (bấm Run) để TẠO folder + IN LINK ra Execution log
function showFolderLink() {
  var f = getFolder_(FOLDER_NAME);
  Logger.log('FOLDER: ' + f.getUrl());
  return f.getUrl();
}
```

> ⚠️ **KHÔNG test bằng nút ▶ Run** — chạy tay báo lỗi `postData` vì thiếu `e`. Đó là bình thường. Chỉ test qua **URL Web App**.

3. **Deploy → New deployment → Type: Web app**
   - *Execute as*: **Me** · *Who has access*: **Anyone** → Deploy.
   - Lần đầu Google hỏi cấp quyền **Drive + Sheets** → Authorize → Advanced → Allow.
   - Copy URL `https://script.google.com/macros/s/…/exec`.

### Bước 2 — Cấu hình trong app
- Mở **⚙️ Cài đặt** → dán URL vào ô **Google Sheets webhook** → Lưu (URL này dùng cho cả Drive + Sheets).
- Hoặc đặt env `SHEETS_WEBHOOK_URL=...`.

### Cách hoạt động
- **Thêm ảnh/PDF** → app đẩy file lên **Google Drive** (thư mục `LearnSale Library`), lưu link Drive làm `url` của tài liệu, đồng thời ghi 1 dòng vào Sheet.
- **Thêm text/link** → chỉ ghi 1 dòng metadata vào Sheet.
- Nút **🔗 Đồng bộ Sheets** → đẩy lại **toàn bộ** danh sách (upsert theo `id`).
- **Xoá tài liệu** trong app → tự **xoá file trên Drive** (vào thùng rác) **và xoá dòng** tương ứng trong Sheet.

> Ghi chú hiển thị ảnh: link `uc?export=view&id=…` thường hiển thị được trong thẻ `<img>`. Nếu một ảnh không hiện (Google chặn hotlink), vẫn có link Drive để mở. Muốn hiển thị chắc chắn 100% → chọn phương án "Cả Drive + MongoDB".

---

## 🖥️ 3) Host

- **Render** (Blueprint `render.yaml`): New → Blueprint → chọn repo → đặt `OPENAI_API_KEY`, `MONGODB_URI` (+ `MONGODB_DB`, `SHEETS_WEBHOOK_URL` nếu dùng). Health check `/healthz`.
- **Railway / Fly / VPS**: `npm install && npm start`, đặt các env như trên.
- Cần host **chạy Node** (không dùng Netlify tĩnh nếu muốn MongoDB + giấu key + upload file).

---

## 🔒 Bảo mật
- Không commit secret. `.gitignore` đã bỏ `.env`, `server/data/settings.json`.
- `MONGODB_URI`, `OPENAI_API_KEY`, `SHEETS_WEBHOOK_URL` đặt qua **biến môi trường** của host.
