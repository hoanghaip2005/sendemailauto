FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only for Cloud Run)
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create logs directory with proper permissions
RUN mkdir -p logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S emailapp -u 1001

# Change ownership
RUN chown -R emailapp:nodejs /app

# Switch to non-root user
USER emailapp

# Cloud Run automatically sets PORT, but we expose both common ports
EXPOSE 8080
EXPOSE 3000

# Health check optimized for Cloud Run
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e " \
        const http = require('http'); \
        const port = process.env.PORT || 3000; \
        const req = http.get(\`http://localhost:\${port}/api/health\`, (res) => { \
            process.exit(res.statusCode === 200 ? 0 : 1); \
        }); \
        req.on('error', () => process.exit(1)); \
        req.setTimeout(3000, () => { req.destroy(); process.exit(1); }); \
    "

# Use cloud-optimized startup script
CMD ["node", "start-cloud.js"]