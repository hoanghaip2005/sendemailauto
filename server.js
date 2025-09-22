// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables (no-op on Cloud Run, useful local)
dotenv.config();

// Custom modules
const GoogleSheetsService = require('./services/googleSheetsService');
const GmailService = require('./services/gmailService'); // App Password only
const EmailService = require('./services/emailService');
const Logger = require('./utils/logger');
const CronJobManager = require('./utils/cronJobManager');

class EmailAutomationServer {
  constructor() {
    this.app = express();
    // PORT: Cloud Run injects (e.g., 8080). Local fallback = 8080
    this.port = process.env["SERVICE_PORT"];
    this.logger = new Logger();

    // Services (heavy init after listen)
    this.sheetsService = new GoogleSheetsService();
    this.gmailService = new GmailService();
    this.emailService = new EmailService(this.sheetsService, this.gmailService, this.logger);
    this.cronManager = new CronJobManager(this.emailService, this.logger);

    this.stats = { total: 0, sent: 0, failed: 0, lastRun: null };

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname)));

    this.app.use((req, _res, next) => {
      try { this.logger.info(`${req.method} ${req.path}`); } catch {}
      next();
    });
  }

  setupRoutes() {
    // Root
    this.app.get('/', (_req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    // Explicit health for probes
    this.app.get('/_healthz', (_req, res) => res.status(200).send('ok'));

    // OAuth disabled (App Password path only)
    this.app.get('/auth/gmail', (_req, res) =>
      res.status(501).send('OAuth2 is disabled. Using Gmail App Password.'));
    this.app.get('/auth/callback', (_req, res) =>
      res.status(501).send('OAuth2 is disabled. Using Gmail App Password.'));

    const api = express.Router();

    api.get('/auth/gmail/start', (_req, res) =>
      res.status(501).json({ error: 'OAuth2 is disabled. Using App Password.' }));

    api.get('/status', async (_req, res) => {
      try {
        const sheetsOk = await this.safeCall(() => this.sheetsService.testConnection(), false);
        const gmailOk = await this.safeCall(() => this.gmailService.isAuthenticated(), false);
        res.json({
          cronjob: {
            active: this.cronManager.isActive(),
            nextRun: this.cronManager.getNextRun(),
            interval: this.cronManager.getInterval()
          },
          sheets: { connected: sheetsOk },
          gmail: { authenticated: gmailOk },
          lastRun: this.stats.lastRun,
          uptime: process.uptime()
        });
      } catch (e) {
        this.logger.error('Error /status:', e);
        res.status(500).json({ error: 'Failed to get system status' });
      }
    });

    api.get('/stats', (_req, res) => {
      try {
        const successRate = this.stats.total ? Math.round((this.stats.sent / this.stats.total) * 100) : 0;
        res.json({ ...this.stats, successRate });
      } catch (e) {
        this.logger.error('Error /stats:', e);
        res.status(500).json({ error: 'Failed to get statistics' });
      }
    });

    api.get('/email-preview', async (_req, res) => {
      try {
        const preview = await this.emailService.getEmailPreview();
        res.json(preview);
      } catch (e) {
        this.logger.error('Error /email-preview:', e);
        res.status(500).json({ error: 'Failed to get email preview' });
      }
    });

    // Cloud Scheduler should call this
    api.post('/send-emails', async (_req, res) => {
      try {
        this.logger.info('Manual email sending triggered');
        const result = await this.emailService.processEmails();
        this.updateStats(result);
        res.json(result);
      } catch (e) {
        this.logger.error('Error /send-emails:', e);
        res.status(500).json({ error: 'Failed to send emails' });
      }
    });

    // Cron controls (optional in Cloud Run)
    api.post('/cronjob/start', async (req, res) => {
      try {
        const { interval = 30 } = req.body || {};
        const started = await this.cronManager.start(interval);
        if (started) return res.json({ success: true, message: 'Cronjob started' });
        return res.status(400).json({ error: 'Cronjob is already running' });
      } catch (e) {
        this.logger.error('Error starting cronjob:', e);
        res.status(500).json({ error: 'Failed to start cronjob' });
      }
    });

    api.post('/cronjob/stop', (_req, res) => {
      try {
        const stopped = this.cronManager.stop();
        if (stopped) return res.json({ success: true, message: 'Cronjob stopped' });
        return res.status(400).json({ error: 'No cronjob is currently running' });
      } catch (e) {
        this.logger.error('Error stopping cronjob:', e);
        res.status(500).json({ error: 'Failed to stop cronjob' });
      }
    });

    api.put('/cronjob/interval', (req, res) => {
      try {
        const { interval } = req.body || {};
        if (!interval || interval < 1) return res.status(400).json({ error: 'Invalid interval value' });
        const ok = this.cronManager.updateInterval(interval);
        if (ok) return res.json({ success: true, message: 'Interval updated' });
        return res.status(400).json({ error: 'Failed to update interval' });
      } catch (e) {
        this.logger.error('Error updating interval:', e);
        res.status(500).json({ error: 'Failed to update interval' });
      }
    });

    // Logs
    api.get('/logs/recent', (req, res) => {
      try {
        const limit = parseInt(req.query.limit, 10) || 50;
        res.json(this.logger.getRecentLogs(limit));
      } catch (e) {
        this.logger.error('Error /logs/recent:', e);
        res.status(500).json({ error: 'Failed to get logs' });
      }
    });

    api.get('/logs/export', (_req, res) => {
      try {
        res.json({ data: this.logger.exportLogs() });
      } catch (e) {
        this.logger.error('Error /logs/export:', e);
        res.status(500).json({ error: 'Failed to export logs' });
      }
    });

    api.delete('/logs', (_req, res) => {
      try {
        this.logger.clearLogs();
        res.json({ success: true, message: 'Logs cleared' });
      } catch (e) {
        this.logger.error('Error DELETE /logs:', e);
        res.status(500).json({ error: 'Failed to clear logs' });
      }
    });

    // Health
    api.get('/health', (_req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    this.app.use('/api', api);

    // Fallback
    this.app.use('*', (req, res) => {
      if (req.originalUrl.startsWith('/api')) return res.status(404).json({ error: 'API endpoint not found' });
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    // Error handler
    // eslint-disable-next-line no-unused-vars
    this.app.use((err, _req, res, _next) => {
      this.logger.error('Unhandled error:', err);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });
  }

  async safeCall(fn, fallback) {
    try { return await fn(); } catch { return fallback; }
  }

  // Local-only helper; Cloud Run ignores .env files at runtime
  async updateEnvFile(key, value) {
    try {
      const fs = require('fs');
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      envContent = envContent.includes(`${key}=`) ?
        envContent.replace(new RegExp(`${key}=.*`), `${key}=${value}`) :
        `${envContent}\n${key}=${value}`;
      fs.writeFileSync(envPath, envContent);
      process.env[key] = value;
      this.logger.info(`Updated env var: ${key}`);
    } catch (e) {
      this.logger.error(`Failed to update env file: ${e.message}`);
    }
  }

  // Initialize services AFTER server is listening
  async initializeServicesNonBlocking() {
    this.logger.info('Post-start initializing services...');
    this.sheetsService.initialize()
      .then(() => this.logger.info('Google Sheets service initialized'))
      .catch(e => this.logger.warn(`Google Sheets init failed: ${e.message}`));
    this.gmailService.initialize()
      .then(() => this.logger.info('Gmail service initialized'))
      .catch(e => this.logger.warn(`Gmail init failed: ${e.message}`));
  }

  updateStats(result) {
    this.stats.sent += result.sent || 0;
    this.stats.failed += result.failed || 0;
    this.stats.total = this.stats.sent + this.stats.failed;
    this.stats.lastRun = new Date().toISOString();
    this.logger.info(`Stats updated - Total: ${this.stats.total}, Sent: ${this.stats.sent}, Failed: ${this.stats.failed}`);
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        const base = process.env.BASE_URL || `http://localhost:${this.port}`;
        console.log(`Listening on ${this.port}`); // ensure visible in Cloud Run logs
        this.logger.info(`🚀 Email Automation Server listening on ${this.port}`);
        this.logger.info(`📱 Web interface: ${base}`);
        this.logger.info(`🔗 API base URL: ${base}/api`);
        this.initializeServicesNonBlocking();
        resolve();
      });
    });
  }

  async stop() {
    if (this.server) {
      this.cronManager.stop();
      await new Promise((resolve) =>
        this.server.close(() => { this.logger.info('Server stopped'); resolve(); })
      );
    }
  }
}

// Graceful shutdown
const graceful = async () => {
  try {
    console.log('Shutting down gracefully...');
    if (global.emailServer) await global.emailServer.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);

// Run
if (require.main === module) {
  const server = new EmailAutomationServer();
  global.emailServer = server;
  server.start().catch((e) => {
    console.error('Failed to start server:', e);
  });
}

module.exports = EmailAutomationServer;
