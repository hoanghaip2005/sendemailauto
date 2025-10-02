# Email Automation Tool

Công cụ tự động gửi email từ Google Sheets với giao diện web đẹp mắt, hỗ trợ chạy dưới dạng service.

## 🌟 Tính năng

- ✅ Giao diện web đẹp mắt với vanilla HTML/CSS/JS
- ✅ Tự động đọc dữ liệu từ Google Sheets
- ✅ Gửi email thông qua Gmail API
- ✅ Cronjob tự động với chu kỳ có thể cấu hình
- ✅ Logging và theo dõi lịch sử gửi email
- ✅ Thống kê và báo cáo chi tiết
- ✅ Quản lý trạng thái email trong Google Sheets
- ✅ Preview email trước khi gửi
- ✅ Rate limiting và retry mechanism
- ✅ **Chạy dưới dạng daemon service với PM2**
- ✅ **Cấu hình batch size cho số lượng email mỗi lần gửi**

## 🚀 Cài đặt

### Yêu cầu hệ thống
- Node.js 18.0.0 trở lên
- NPM hoặc Yarn
- PM2 (sẽ được cài tự động)
- Tài khoản Google với quyền truy cập Gmail và Google Sheets

### 1. Clone project
```bash
git clone <repository-url>
cd sendemail
```

### 2. Cài đặt dependencies
```bash
npm install
```

### 3. Cài đặt PM2 (nếu chưa có)
```bash
npm run pm2:install
```

### 4. Cấu hình môi trường
```bash
cp .env.example .env
```

Chỉnh sửa file `.env` với thông tin của bạn:

```env
# Gmail của bạn
GMAIL_USER_EMAIL=your-email@gmail.com

# Google Sheets URL (thay thế bằng URL của bạn)
GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit

# Google API credentials (thay thế bằng thông tin của bạn)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_API_KEY=your-google-api-key

# Cấu hình batch size (số email gửi mỗi lần)
EMAIL_BATCH_SIZE=5
```

### 5. Xác thực Gmail API

#### Bước 1: Lấy authorization URL
```bash
npm run get-auth-url
```

#### Bước 2: Truy cập URL và lấy authorization code
1. Truy cập URL được hiển thị
2. Đăng nhập với tài khoản Gmail của bạn
3. Cho phép ứng dụng truy cập
4. Copy authorization code

#### Bước 3: Lưu refresh token
```bash
npm run save-token <authorization-code>
```

Refresh token sẽ được lưu tự động vào file `.env`.

## 🔧 Khởi chạy Service

### Service Management Commands

#### Khởi động service (daemon mode)
```bash
npm run service:start
```

#### Dừng service
```bash
npm run service:stop
```

#### Restart service
```bash
npm run service:restart
```

#### Kiểm tra trạng thái service
```bash
npm run service:status
```

#### Xem logs realtime
```bash
npm run service:logs
```

### Development Mode
```bash
npm run dev
```

### Manual Start (foreground)
```bash
npm start
```

## 🎛️ Cấu hình Batch Processing

Trong file `.env`, bạn có thể cấu hình:

```env
# Số lượng email gửi mỗi lần Cloud Scheduler trigger
EMAIL_BATCH_SIZE=5

# Rate limit giữa các email (milliseconds)
EMAIL_RATE_LIMIT_MS=1000

# Số lần retry khi gửi email thất bại
MAX_RETRY_ATTEMPTS=3
```

### Cloud Scheduler Configuration
Khi sử dụng Google Cloud Scheduler, bạn có thể điều chỉnh batch size bằng cách gửi body:

```json
{
  "batchSize": 10
}
```

Truy cập: http://localhost:3000

## 📊 Cấu trúc Google Sheets

### Sheet 1: Dữ liệu người nhận
| Cột | Tên | Mô tả |
|-----|-----|-------|
| A | Từ khóa | Từ khóa liên quan |
| B | Tên | Tên người/công ty |
| C | Địa chỉ | Địa chỉ |
| D | Trang web | Website |
| E | Email | Email chính |
| F | Trạng thái | new/sent/failed |
| G→ | Emails | Các email bổ sung |

### Sheet 2: Mẫu email
| Cột | Tên | Mô tả |
|-----|-----|-------|
| A | Title | "subject" hoặc "content" |
| B | Content | Nội dung tương ứng |

#### Ví dụ Sheet 2:
```
subject | Chào mừng {{name}} - Cơ hội hợp tác
content | Xin chào {{name}},

Chúng tôi đã tìm hiểu về {{website}} và rất ấn tượng...

Trân trọng,
Team Marketing
```

## 🎯 Sử dụng

### 1. Dashboard
- Xem thống kê tổng quan (tổng số email, đã gửi, thất bại, tỷ lệ thành công)
- Theo dõi trạng thái hệ thống
- Preview email mẫu

### 2. Điều khiển
- **Bắt đầu tự động gửi**: Khởi động cronjob
- **Dừng tự động gửi**: Dừng cronjob
- **Gửi ngay**: Gửi email thủ công
- **Làm mới dữ liệu**: Cập nhật từ Google Sheets

### 3. Cấu hình
- Chu kỳ gửi email: 5 phút → 2 giờ
- Tự động lưu cấu hình

### 4. Logs
- Xem lịch sử gửi email real-time
- Xuất logs ra file
- Xóa logs cũ

## 🔧 Cấu hình nâng cao

### Biến môi trường quan trọng

```env
# Chu kỳ mặc định (phút)
DEFAULT_INTERVAL_MINUTES=30

# Chạy ngay khi khởi động
RUN_ON_START=false

# Giới hạn tốc độ gửi (ms)
EMAIL_RATE_LIMIT_MS=1000

# Số lần thử lại
MAX_RETRY_ATTEMPTS=3

# Kích thước batch
BATCH_SIZE=10
```

### Personalization variables

Bạn có thể sử dụng các biến sau trong email template:

- `{{name}}` - Tên người nhận
- `{{keyword}}` - Từ khóa
- `{{address}}` - Địa chỉ
- `{{website}}` - Website
- `{{email}}` - Email chính

## 📁 Cấu trúc project

```
sendemail/
├── services/
│   ├── googleSheetsService.js  # Google Sheets API
│   ├── gmailService.js         # Gmail API
│   └── emailService.js         # Email processing logic
├── utils/
│   ├── cronJobManager.js       # Cronjob management
│   └── logger.js              # Logging system
├── logs/                      # Log files
├── index.html                 # Web interface
├── styles.css                 # Styles
├── script.js                  # Frontend JavaScript
├── server.js                  # Express server
├── package.json               # Dependencies
└── .env                       # Configuration
```

## 🚀 Deployment

### Heroku
```bash
# Cài đặt Heroku CLI và login
heroku create your-app-name
heroku config:set NODE_ENV=production
heroku config:set GOOGLE_CLIENT_ID=your-client-id
heroku config:set GOOGLE_CLIENT_SECRET=your-client-secret
# ... other environment variables
git push heroku main
```

### VPS/Server
```bash
# Install Node.js and PM2
npm install -g pm2

# Start application
pm2 start server.js --name "email-automation"

# Setup auto-restart
pm2 startup
pm2 save

# Monitor
pm2 monit
```

### Docker
```bash
# Build image
docker build -t email-automation .

# Run container
docker run -d \
  --name email-automation \
  -p 3000:3000 \
  --env-file .env \
  email-automation
```

## 🔍 Troubleshooting

### Lỗi thường gặp

**1. "Gmail authentication failed"**
- Kiểm tra `GOOGLE_REFRESH_TOKEN` trong `.env`
- Chạy lại quá trình xác thực Gmail

**2. "Google Sheets connection failed"**
- Kiểm tra `GOOGLE_API_KEY` và `GOOGLE_SHEET_URL`
- Đảm bảo Google Sheet được share public hoặc có quyền truy cập

**3. "Email sending rate limited"**
- Tăng `EMAIL_RATE_LIMIT_MS` trong cấu hình
- Giảm số email gửi đồng thời

**4. Port đã được sử dụng**
- Thay đổi `PORT` trong file `.env`
- Hoặc kill process đang sử dụng port 3000

### Logs
Kiểm tra logs để debug:
```bash
# Xem logs real-time
tail -f logs/app.log

# Xem error logs
tail -f logs/error.log

# Xem email logs
tail -f logs/email.log
```

## 📞 Support

Nếu gặp vấn đề, vui lòng:

1. Kiểm tra logs
2. Xem phần Troubleshooting
3. Tạo issue với thông tin chi tiết

## 📝 License

MIT License - xem file LICENSE để biết chi tiết.

---

**Lưu ý**: Đảm bảo tuân thủ chính sách của Google và Gmail khi sử dụng công cụ này. Tránh spam và chỉ gửi email đến những người đã đồng ý nhận.