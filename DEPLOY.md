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

> 📌 **File lưu vào Drive của tài khoản NÀO?** = tài khoản **sở hữu Apps Script** (Web App chạy *Execute as: Me*). Muốn lưu vào Drive của **hoanganhkdd@gmail.com** → hãy **đăng nhập đúng tài khoản đó** rồi mới tạo Sheet + Apps Script + Deploy. Mở URL `/exec` sẽ in ra `account` để bạn xác nhận đang chạy bằng tài khoản nào. (Tuỳ chọn: dán `FOLDER_ID` để lưu vào đúng 1 thư mục có sẵn.)

### Bước 1 — Tạo Google Apps Script
1. **Đăng nhập tài khoản Google bạn muốn dùng** (vd hoanganhkdd@gmail.com), rồi tạo 1 **Google Sheet** mới.
2. Menu **Extensions → Apps Script**, dán đoạn sau (thay toàn bộ):

```javascript
var FOLDER_NAME = 'LearnSale Library';
var FOLDER_ID = ''; // (tuỳ chọn) dán ID 1 folder có sẵn trong Drive của bạn để lưu vào đúng đó

function doPost(e) {
  // Guard: khi bấm ▶ Run trực tiếp, Google KHÔNG truyền e → tránh lỗi 'postData'
  var body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
  if (body.action === 'upload' && body.file) return handleUpload_(body.file);
  if (body.action === 'remove') return handleRemove_(body);
  return handleRows_(body.rows || []);
}

// Xoá: bỏ file Drive vào thùng rác + xoá dòng trong Sheet theo id (cột ID = cột J)
function handleRemove_(body) {
  if (body.driveId) { try { DriveApp.getFileById(body.driveId).setTrashed(true); } catch (err) {} }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Links');
  if (sheet && body.id) {
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][9] === body.id) sheet.deleteRow(i + 1);
    }
  }
  return json_({ ok: true });
}

// Lưu 1 file lên Google Drive, trả link xem trực tiếp
function handleUpload_(file) {
  var folder = getFolder_();
  // Đóng gói mỗi kỹ năng vào 1 folder con (tên = tiêu đề kỹ năng)
  if (file.folder) {
    var sub = folder.getFoldersByName(file.folder);
    folder = sub.hasNext() ? sub.next() : folder.createFolder(file.folder);
  }
  var bytes = Utilities.base64Decode(file.data);
  var blob = Utilities.newBlob(bytes, file.mimetype || 'application/octet-stream', file.title || file.name || 'file');
  var f = folder.createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var id = f.getId();
  return json_({ ok: true, id: id,
    url: 'https://drive.google.com/uc?export=view&id=' + id,
    viewUrl: 'https://drive.google.com/file/d/' + id + '/view' });
}

// Tab "Links" với header tiếng Việt (tự tạo/di trú nếu khác)
function getLinksSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Links') || ss.insertSheet('Links');
  var headers = ['Thời gian','Module','Bài học','Loại','Tiêu đề','Link','Ảnh','Tags','Ghi chú','ID'];
  var cur = sheet.getLastRow() ? sheet.getRange(1, 1, 1, 10).getValues()[0] : [];
  if (cur[0] !== 'Thời gian') {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1); sheet.setColumnWidth(7, 240);
  }
  return sheet;
}

// Ghi/upsert dòng vào tab Links; cột "Ảnh" hiện thumbnail =IMAGE()
function handleRows_(rows) {
  var sheet = getLinksSheet_();
  var data = sheet.getDataRange().getValues();
  var idIndex = {};
  for (var i = 1; i < data.length; i++) idIndex[data[i][9]] = i + 1; // cột J = ID
  (rows || []).forEach(function (r) {
    var line = [r.time || '', r.module || '', r.lesson || '', r.type || '', r.title || '', r.url || '', '', r.tags || '', r.note || '', r.id || ''];
    var row;
    if (idIndex[r.id]) { row = idIndex[r.id]; sheet.getRange(row, 1, 1, 10).setValues([line]); }
    else { sheet.appendRow(line); row = sheet.getLastRow(); }
    if (r.imageId) {
      sheet.getRange(row, 7).setFormula('=IMAGE("https://drive.google.com/thumbnail?id=' + r.imageId + '&sz=w600")');
      sheet.setRowHeight(row, 120);
    } else { sheet.getRange(row, 7).setValue(''); }
  });
  return json_({ ok: true, count: (rows || []).length });
}

function getFolder_() {
  if (FOLDER_ID) { try { return DriveApp.getFolderById(FOLDER_ID); } catch (e) {} }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Mở URL /exec: tạo folder nếu chưa có và TRẢ LUÔN LINK FOLDER + email tài khoản đang chạy
function doGet() {
  var f = getFolder_();
  return json_({ ok: true, msg: 'Webhook alive', account: Session.getEffectiveUser().getEmail(), folder: f.getUrl() });
}

// ▶ Chạy hàm này 1 lần (bấm Run) để TẠO folder + IN LINK & EMAIL ra Execution log
function showFolderLink() {
  var f = getFolder_();
  Logger.log('ACCOUNT: ' + Session.getEffectiveUser().getEmail());
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
- Sheet dùng tab **`Links`** với cột tiếng Việt: `Thời gian · Module · Bài học · Loại · Tiêu đề · Link · Ảnh · Tags · Ghi chú · ID`. Cột **Ảnh** hiện **thumbnail** bằng `=IMAGE()`. (Tab `Resources` cũ nếu có thì bỏ qua/xoá tay.)
- Nút **🔗 Đồng bộ Sheets** → đẩy lại **toàn bộ** danh sách (upsert theo `id`, cột ID).
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
