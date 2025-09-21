const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const cron = require('node-cron');

// Load environment variables
dotenv.config();

// Import custom modules
const GoogleSheetsService = require('./services/googleSheetsService');
const GmailService = require('./services/gmailService');
const EmailService = require('./services/emailService');
const Logger = require('./utils/logger');
const CronJobManager = require('./utils/cronJobManager');

class EmailAutomationServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.logger = new Logger();
        
        // Initialize services
        this.sheetsService = new GoogleSheetsService();
        this.gmailService = new GmailService();
        this.emailService = new EmailService(this.sheetsService, this.gmailService, this.logger);
        this.cronManager = new CronJobManager(this.emailService, this.logger);
        
        // Application state
        this.stats = {
            total: 0,
            sent: 0,
            failed: 0,
            lastRun: null
        };
        
        this.setupMiddleware();
        this.setupRoutes();
        this.initializeServices();
    }

    setupMiddleware() {
        // Enable CORS
        this.app.use(cors());
        
        // Parse JSON requests
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // Serve static files
        this.app.use(express.static(path.join(__dirname)));
        
        // Request logging
        this.app.use((req, res, next) => {
            this.logger.info(`${req.method} ${req.path} - ${req.ip}`);
            next();
        });
    }

    setupRoutes() {
        // Serve main page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        // OAuth2 Authentication Routes
        this.app.get('/auth/gmail', async (req, res) => {
            try {
                const authUrl = await this.gmailService.getAuthUrl();
                res.redirect(authUrl);
            } catch (error) {
                this.logger.error('Failed to get auth URL:', error);
                res.status(500).send('Authentication error. Please try again.');
            }
        });

        this.app.get('/auth/callback', async (req, res) => {
            try {
                const { code, error } = req.query;
                
                if (error) {
                    this.logger.error('OAuth2 error:', error);
                    res.status(400).send(`Authentication failed: ${error}`);
                    return;
                }

                if (!code) {
                    res.status(400).send('No authorization code received');
                    return;
                }

                // Exchange code for tokens
                const tokens = await this.gmailService.exchangeCodeForTokens(code);
                
                // Update .env file with refresh token
                await this.updateEnvFile('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
                
                this.logger.info('Gmail authentication completed successfully');
                
                // Redirect to success page
                res.send(`
                    <html>
                        <head><title>Authentication Successful</title></head>
                        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                            <h2>✅ Gmail Authentication Successful!</h2>
                            <p>Your Gmail account has been successfully authenticated.</p>
                            <p>You can now close this tab and return to the application.</p>
                            <a href="/" style="background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Return to App</a>
                        </body>
                    </html>
                `);
                
            } catch (error) {
                this.logger.error('Failed to complete authentication:', error);
                res.status(500).send(`Authentication failed: ${error.message}`);
            }
        });

        // API Routes
        const apiRouter = express.Router();

        // Gmail authentication endpoint
        apiRouter.get('/auth/gmail/start', async (req, res) => {
            try {
                const authUrl = await this.gmailService.getAuthUrl();
                res.json({ authUrl });
            } catch (error) {
                this.logger.error('Failed to get Gmail auth URL:', error);
                res.status(500).json({ error: 'Failed to get authentication URL' });
            }
        });

        // System status
        apiRouter.get('/status', async (req, res) => {
            try {
                const status = {
                    cronjob: {
                        active: this.cronManager.isActive(),
                        nextRun: this.cronManager.getNextRun(),
                        interval: this.cronManager.getInterval()
                    },
                    sheets: {
                        connected: await this.sheetsService.testConnection()
                    },
                    gmail: {
                        authenticated: await this.gmailService.isAuthenticated()
                    },
                    lastRun: this.stats.lastRun,
                    uptime: process.uptime()
                };
                
                res.json(status);
            } catch (error) {
                this.logger.error('Error getting system status:', error);
                res.status(500).json({ error: 'Failed to get system status' });
            }
        });

        // Get statistics
        apiRouter.get('/stats', (req, res) => {
            try {
                const successRate = this.stats.total > 0 
                    ? Math.round((this.stats.sent / this.stats.total) * 100) 
                    : 0;
                    
                res.json({
                    ...this.stats,
                    successRate
                });
            } catch (error) {
                this.logger.error('Error getting stats:', error);
                res.status(500).json({ error: 'Failed to get statistics' });
            }
        });

        // Email preview
        apiRouter.get('/email-preview', async (req, res) => {
            try {
                const preview = await this.emailService.getEmailPreview();
                res.json(preview);
            } catch (error) {
                this.logger.error('Error getting email preview:', error);
                res.status(500).json({ error: 'Failed to get email preview' });
            }
        });

        // Cronjob management
        apiRouter.post('/cronjob/start', async (req, res) => {
            try {
                const { interval = 30 } = req.body;
                
                const started = await this.cronManager.start(interval);
                if (started) {
                    this.logger.info(`Cronjob started with ${interval} minute interval`);
                    res.json({ success: true, message: 'Cronjob started successfully' });
                } else {
                    res.status(400).json({ error: 'Cronjob is already running' });
                }
            } catch (error) {
                this.logger.error('Error starting cronjob:', error);
                res.status(500).json({ error: 'Failed to start cronjob' });
            }
        });

        apiRouter.post('/cronjob/stop', async (req, res) => {
            try {
                const stopped = this.cronManager.stop();
                if (stopped) {
                    this.logger.info('Cronjob stopped');
                    res.json({ success: true, message: 'Cronjob stopped successfully' });
                } else {
                    res.status(400).json({ error: 'No cronjob is currently running' });
                }
            } catch (error) {
                this.logger.error('Error stopping cronjob:', error);
                res.status(500).json({ error: 'Failed to stop cronjob' });
            }
        });

        apiRouter.put('/cronjob/interval', async (req, res) => {
            try {
                const { interval } = req.body;
                
                if (!interval || interval < 1) {
                    return res.status(400).json({ error: 'Invalid interval value' });
                }
                
                const updated = this.cronManager.updateInterval(interval);
                if (updated) {
                    this.logger.info(`Cronjob interval updated to ${interval} minutes`);
                    res.json({ success: true, message: 'Interval updated successfully' });
                } else {
                    res.status(400).json({ error: 'Failed to update interval' });
                }
            } catch (error) {
                this.logger.error('Error updating cronjob interval:', error);
                res.status(500).json({ error: 'Failed to update interval' });
            }
        });

        // Manual email sending
        apiRouter.post('/send-emails', async (req, res) => {
            try {
                this.logger.info('Manual email sending triggered');
                const result = await this.emailService.processEmails();
                
                // Update stats
                this.updateStats(result);
                
                res.json(result);
            } catch (error) {
                this.logger.error('Error sending emails manually:', error);
                res.status(500).json({ error: 'Failed to send emails' });
            }
        });

        // Log management
        apiRouter.get('/logs/recent', (req, res) => {
            try {
                const limit = parseInt(req.query.limit) || 50;
                const logs = this.logger.getRecentLogs(limit);
                res.json(logs);
            } catch (error) {
                this.logger.error('Error getting recent logs:', error);
                res.status(500).json({ error: 'Failed to get logs' });
            }
        });

        apiRouter.get('/logs/export', (req, res) => {
            try {
                const logs = this.logger.exportLogs();
                res.json({ data: logs });
            } catch (error) {
                this.logger.error('Error exporting logs:', error);
                res.status(500).json({ error: 'Failed to export logs' });
            }
        });

        apiRouter.delete('/logs', (req, res) => {
            try {
                this.logger.clearLogs();
                res.json({ success: true, message: 'Logs cleared successfully' });
            } catch (error) {
                this.logger.error('Error clearing logs:', error);
                res.status(500).json({ error: 'Failed to clear logs' });
            }
        });

        // Health check
        apiRouter.get('/health', (req, res) => {
            res.json({
                status: 'OK',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: process.env.npm_package_version || '1.0.0'
            });
        });

        this.app.use('/api', apiRouter);

        // 404 handler
        this.app.use('*', (req, res) => {
            if (req.originalUrl.startsWith('/api')) {
                res.status(404).json({ error: 'API endpoint not found' });
            } else {
                res.sendFile(path.join(__dirname, 'index.html'));
            }
        });

        // Error handler
        this.app.use((err, req, res, next) => {
            this.logger.error('Unhandled error:', err);
            res.status(500).json({ 
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        });
    }

    async updateEnvFile(key, value) {
        try {
            const envPath = path.join(__dirname, '.env');
            const fs = require('fs');
            let envContent = fs.readFileSync(envPath, 'utf8');
            
            if (envContent.includes(`${key}=`)) {
                envContent = envContent.replace(
                    new RegExp(`${key}=.*`),
                    `${key}=${value}`
                );
            } else {
                envContent += `\n${key}=${value}`;
            }
            
            fs.writeFileSync(envPath, envContent);
            
            // Update process.env
            process.env[key] = value;
            
            this.logger.info(`Updated environment variable: ${key}`);
        } catch (error) {
            this.logger.error(`Failed to update env file: ${error.message}`);
            throw error;
        }
    }

    async initializeServices() {
        try {
            this.logger.info('Initializing services...');
            
            // Initialize Google Sheets service
            await this.sheetsService.initialize();
            this.logger.info('Google Sheets service initialized');
            
            // Initialize Gmail service
            await this.gmailService.initialize();
            this.logger.info('Gmail service initialized');
            
            this.logger.info('All services initialized successfully');
            
        } catch (error) {
            this.logger.error('Error initializing services:', error);
        }
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
            this.server = this.app.listen(this.port, () => {
                this.logger.info(`🚀 Email Automation Server started on port ${this.port}`);
                this.logger.info(`📱 Web interface: http://localhost:${this.port}`);
                this.logger.info(`🔗 API base URL: http://localhost:${this.port}/api`);
                resolve();
            });
        });
    }

    async stop() {
        if (this.server) {
            // Stop cronjob first
            this.cronManager.stop();
            
            // Close server
            await new Promise((resolve) => {
                this.server.close(() => {
                    this.logger.info('Server stopped');
                    resolve();
                });
            });
        }
    }
}

// Handle process signals
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    if (global.emailServer) {
        await global.emailServer.stop();
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\nSIGINT received, shutting down gracefully');
    if (global.emailServer) {
        await global.emailServer.stop();
    }
    process.exit(0);
});

// Start server if this file is run directly
if (require.main === module) {
    const server = new EmailAutomationServer();
    global.emailServer = server;
    server.start().catch(console.error);
}

module.exports = EmailAutomationServer;