const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import custom modules
const GoogleSheetsService = require('./services/googleSheetsService');
const GmailService = require('./services/gmailService');
const EmailService = require('./services/emailService');
const Logger = require('./utils/logger');

class EmailAutomationServer {
    constructor() {
        this.app = express();
        // Cloud Run requires binding to the PORT environment variable
        this.port = parseInt(process.env.PORT) || 3000;
        this.host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
        this.logger = new Logger();
        
        // Initialize services
        this.sheetsService = new GoogleSheetsService();
        this.gmailService = new GmailService();
        this.emailService = new EmailService(this.sheetsService, this.gmailService, this.logger);
        
        // Application state
        this.stats = {
            total: 0,
            sent: 0,
            failed: 0,
            lastRun: null
        };
        
        this.setupMiddleware();
        this.setupRoutes();
        // Don't initialize services in constructor - do it after server starts
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
                    scheduler: {
                        type: 'cloud-scheduler',
                        note: 'Using Google Cloud Scheduler for automated email sending'
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

        // Cloud Scheduler Information endpoint
        apiRouter.get('/scheduler/info', (req, res) => {
            res.json({
                type: 'Google Cloud Scheduler',
                endpoint: '/api/send-email',
                method: 'POST',
                description: 'Automated email sending managed by Google Cloud Scheduler',
                status: 'Active',
                configuration: 'Configure schedule in Google Cloud Console > Cloud Scheduler'
            });
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

        // Cloud Scheduler trigger endpoint - matches the URL in your scheduler
        apiRouter.post('/send-email', async (req, res) => {
            try {
                this.logger.info('Email sending triggered by Cloud Scheduler');
                
                // Log scheduler information if available
                const schedulerInfo = {
                    timestamp: new Date().toISOString(),
                    source: 'cloud-scheduler',
                    headers: req.headers,
                    body: req.body
                };
                
                this.logger.info('Scheduler trigger info:', schedulerInfo);
                
                const result = await this.emailService.processEmails();
                
                // Update stats
                this.updateStats(result);
                
                // Return success response for Cloud Scheduler
                res.status(200).json({
                    success: true,
                    message: 'Email processing completed',
                    timestamp: new Date().toISOString(),
                    ...result
                });
                
            } catch (error) {
                this.logger.error('Error processing scheduled emails:', error);
                
                // Return error response for Cloud Scheduler
                res.status(500).json({ 
                    success: false,
                    error: 'Failed to process emails',
                    message: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Health check endpoint for Cloud Scheduler (GET version)
        apiRouter.get('/send-email', (req, res) => {
            res.status(200).json({
                message: 'Email service endpoint is ready',
                timestamp: new Date().toISOString(),
                method: 'Use POST to trigger email sending'
            });
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

        // Health check - optimized for Cloud Run
        apiRouter.get('/health', async (req, res) => {
            try {
                // Quick health check without heavy operations
                const healthStatus = {
                    status: 'OK',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    version: process.env.npm_package_version || '1.0.0'
                };

                // Add memory info only if requested
                if (req.query.detailed) {
                    healthStatus.memory = process.memoryUsage();
                    
                    // Optional service status (don't fail health check if services are down)
                    try {
                        healthStatus.services = {
                            sheets: await Promise.race([
                                this.sheetsService.testConnection(),
                                new Promise(resolve => setTimeout(() => resolve(false), 2000))
                            ]),
                            gmail: await Promise.race([
                                this.gmailService.isAuthenticated(),
                                new Promise(resolve => setTimeout(() => resolve(false), 2000))
                            ])
                        };
                    } catch (error) {
                        // Don't fail health check due to service status
                        healthStatus.services = { error: 'Service check timeout' };
                    }
                }

                res.status(200).json(healthStatus);
            } catch (error) {
                this.logger.error('Health check failed:', error);
                res.status(500).json({ 
                    status: 'ERROR',
                    error: 'Health check failed',
                    timestamp: new Date().toISOString()
                });
            }
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
            
            // Initialize Google Sheets service with timeout
            try {
                await Promise.race([
                    this.sheetsService.initialize(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Sheets service initialization timeout')), 10000)
                    )
                ]);
                this.logger.info('Google Sheets service initialized');
            } catch (error) {
                this.logger.warn('Google Sheets service initialization failed:', error.message);
                // Don't fail server startup, service can be initialized later
            }
            
            // Initialize Gmail service with timeout
            try {
                await Promise.race([
                    this.gmailService.initialize(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Gmail service initialization timeout')), 10000)
                    )
                ]);
                this.logger.info('Gmail service initialized');
            } catch (error) {
                this.logger.warn('Gmail service initialization failed:', error.message);
                // Don't fail server startup, service can be initialized later
            }
            
            this.logger.info('Service initialization completed');
            
        } catch (error) {
            this.logger.error('Error during service initialization:', error);
            // Don't throw error to prevent server startup failure
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
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, this.host, () => {
                    this.logger.info(`🚀 Email Automation Server started on ${this.host}:${this.port}`);
                    this.logger.info(`📱 Web interface: http://${this.host === '0.0.0.0' ? 'localhost' : this.host}:${this.port}`);
                    this.logger.info(`🔗 API base URL: http://${this.host === '0.0.0.0' ? 'localhost' : this.host}:${this.port}/api`);
                    resolve();
                });
                
                this.server.on('error', (error) => {
                    this.logger.error('Server failed to start:', error);
                    reject(error);
                });
            } catch (error) {
                this.logger.error('Error starting server:', error);
                reject(error);
            }
        });
    }

    async stop() {
        if (this.server) {
            // Close server gracefully
            await new Promise((resolve) => {
                this.server.close(() => {
                    this.logger.info('Server stopped gracefully');
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
    
    // Start server first, then initialize services in background
    server.start()
        .then(() => {
            console.log('✅ Server started successfully');
            // Initialize services in background - don't wait for completion
            server.initializeServices().catch(error => {
                console.error('❌ Service initialization failed:', error);
            });
        })
        .catch(error => {
            console.error('❌ Server failed to start:', error);
            process.exit(1);
        });
}

module.exports = EmailAutomationServer;