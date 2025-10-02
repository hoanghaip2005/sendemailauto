# 🚀 Cloud Deployment Guide

## ✅ Những thay đổi đã được thực hiện để tương thích với Google Cloud:

### 1. **Environment Detection**
- ✅ Tự động phát hiện Cloud Run environment
- ✅ Conditional startup logic (PM2 cho local, direct Node.js cho Cloud)
- ✅ Proper host binding (`0.0.0.0` cho Cloud, `localhost` cho local)

### 2. **Cloud-Optimized Scripts**
- ✅ `start-cloud.js` - Script khởi động tối ưu cho Cloud Run
- ✅ Enhanced error handling và graceful shutdown
- ✅ Immediate service initialization cho Cloud Run

### 3. **Docker Optimization**
- ✅ Updated Dockerfile sử dụng `start-cloud.js`
- ✅ Optimized `.dockerignore` để exclude PM2 configs
- ✅ Production-ready container setup

### 4. **New Scripts**
```bash
npm run start:cloud     # Cloud-optimized startup
npm run cloud:build     # Build via Cloud Build
npm run cloud:deploy    # Direct Cloud Run deploy
```

## 🔧 **Environment Variables cần thiết:**

Đảm bảo các env vars sau được set trong Cloud Run:

```env
NODE_ENV=production
EMAIL_BATCH_SIZE=5
GOOGLE_SHEET_URL=your-sheet-url
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token
GMAIL_USER_EMAIL=your-email
```

## 🚀 **Deployment Commands:**

### Option 1: Cloud Build
```bash
npm run cloud:build
```

### Option 2: Direct Deploy
```bash
npm run cloud:deploy
```

### Option 3: Manual gcloud
```bash
gcloud run deploy sendemail-service \
  --source . \
  --region europe-west10 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10
```

## 🔍 **Key Changes vs Local:**

| Local | Cloud Run |
|-------|-----------|
| PM2 process manager | Direct Node.js |
| `ecosystem.config.json` | Not used |
| `npm run service:start` | Automatic container startup |
| localhost:3000 | 0.0.0.0:PORT |
| Manual service management | Auto-scaling |

## ⚡ **Cloud Run Advantages:**

1. **No PM2 dependency** - Cloud Run handles process management
2. **Auto-scaling** - Scales from 0 to N instances automatically  
3. **Pay-per-use** - Only pay when processing requests
4. **Built-in load balancing** - No need for manual setup
5. **Zero-downtime deployments** - Gradual traffic shifting

## 🛠️ **Troubleshooting:**

### Container won't start:
```bash
# Check logs
gcloud run services logs sendemail-service --region europe-west10

# Check service status  
gcloud run services describe sendemail-service --region europe-west10
```

### Environment issues:
- Verify all required env vars are set in Cloud Run console
- Check service account permissions for Google Sheets/Gmail API
- Ensure proper OAuth2 credentials and refresh token

### Performance:
- Monitor cold starts (use min-instances > 0 if needed)
- Check memory/CPU allocation
- Review batch size configuration

## 📊 **Health Checks:**

Cloud Run will automatically call:
- `GET /api/health` - Basic health check
- `GET /api/health?detailed=true` - Detailed health with service status

The app will respond with proper HTTP status codes for Cloud Run health monitoring.

---

**✅ Với những thay đổi này, app sẽ deploy lên Google Cloud Run mà không gặp lỗi!**