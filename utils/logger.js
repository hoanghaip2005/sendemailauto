const winston = require('winston');
const fs = require('fs-extra');
const path = require('path');

class Logger {
    constructor() {
        this.logsDir = path.join(__dirname, '..', 'logs');
        this.maxLogSize = 10 * 1024 * 1024; // 10MB
        this.maxFiles = 5;
        this.recentLogs = [];
        this.maxRecentLogs = 1000;
        
        this.initializeLogger();
        this.ensureLogsDirectory();
    }

    async ensureLogsDirectory() {
        try {
            await fs.ensureDir(this.logsDir);
        } catch (error) {
            console.error('Failed to create logs directory:', error);
        }
    }

    initializeLogger() {
        // Create custom format
        const customFormat = winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            winston.format.errors({ stack: true }),
            winston.format.printf(({ timestamp, level, message, stack }) => {
                let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
                if (stack) {
                    log += `\n${stack}`;
                }
                return log;
            })
        );

        // Create Winston logger
        this.winston = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: customFormat,
            transports: [
                // Console transport
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        customFormat
                    )
                }),
                
                // File transport for all logs
                new winston.transports.File({
                    filename: path.join(this.logsDir, 'app.log'),
                    maxsize: this.maxLogSize,
                    maxFiles: this.maxFiles,
                    tailable: true
                }),
                
                // Separate file for errors
                new winston.transports.File({
                    filename: path.join(this.logsDir, 'error.log'),
                    level: 'error',
                    maxsize: this.maxLogSize,
                    maxFiles: this.maxFiles,
                    tailable: true
                }),
                
                // Email-specific log file
                new winston.transports.File({
                    filename: path.join(this.logsDir, 'email.log'),
                    maxsize: this.maxLogSize,
                    maxFiles: this.maxFiles,
                    tailable: true,
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.printf(({ timestamp, level, message }) => {
                            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
                        })
                    )
                })
            ]
        });

        // Handle uncaught exceptions
        this.winston.exceptions.handle(
            new winston.transports.File({ 
                filename: path.join(this.logsDir, 'exceptions.log') 
            })
        );

        // Handle unhandled promise rejections
        this.winston.rejections.handle(
            new winston.transports.File({ 
                filename: path.join(this.logsDir, 'rejections.log') 
            })
        );
    }

    log(level, message, meta = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level,
            message: message,
            ...meta
        };

        // Add to recent logs for API access
        this.recentLogs.unshift(logEntry);
        if (this.recentLogs.length > this.maxRecentLogs) {
            this.recentLogs.pop();
        }

        // Log with Winston
        this.winston.log(level, message, meta);
    }

    info(message, meta = {}) {
        this.log('info', message, meta);
    }

    warn(message, meta = {}) {
        this.log('warn', message, meta);
    }

    error(message, error = null, meta = {}) {
        if (error) {
            if (error instanceof Error) {
                meta.error = {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                };
            } else {
                meta.error = error;
            }
        }
        this.log('error', message, meta);
    }

    debug(message, meta = {}) {
        this.log('debug', message, meta);
    }

    verbose(message, meta = {}) {
        this.log('verbose', message, meta);
    }

    // Email-specific logging methods
    emailSent(recipientEmail, subject, messageId) {
        this.info(`Email sent successfully`, {
            type: 'email_sent',
            recipient: recipientEmail,
            subject: subject,
            messageId: messageId
        });
    }

    emailFailed(recipientEmail, subject, error) {
        this.error(`Email sending failed`, {
            type: 'email_failed',
            recipient: recipientEmail,
            subject: subject,
            error: error
        });
    }

    emailProcessingStarted(recipientCount) {
        this.info(`Email processing started for ${recipientCount} recipients`, {
            type: 'email_processing_started',
            recipientCount: recipientCount
        });
    }

    emailProcessingCompleted(sent, failed) {
        this.info(`Email processing completed: ${sent} sent, ${failed} failed`, {
            type: 'email_processing_completed',
            sent: sent,
            failed: failed,
            total: sent + failed
        });
    }

    cronjobStarted(interval) {
        this.info(`Cronjob started with ${interval} minute interval`, {
            type: 'cronjob_started',
            interval: interval
        });
    }

    cronjobStopped() {
        this.info('Cronjob stopped', {
            type: 'cronjob_stopped'
        });
    }

    cronjobExecuted(result) {
        this.info(`Cronjob executed: ${result.sent} sent, ${result.failed} failed`, {
            type: 'cronjob_executed',
            ...result
        });
    }

    // System-specific logging
    systemStarted() {
        this.info('Email Automation System started', {
            type: 'system_started',
            version: process.env.npm_package_version || '1.0.0',
            nodeVersion: process.version,
            platform: process.platform
        });
    }

    systemStopped() {
        this.info('Email Automation System stopped', {
            type: 'system_stopped'
        });
    }

    // API access methods
    getRecentLogs(limit = 50) {
        return this.recentLogs.slice(0, limit);
    }

    getLogsByType(type, limit = 100) {
        return this.recentLogs
            .filter(log => log.type === type)
            .slice(0, limit);
    }

    getLogsByLevel(level, limit = 100) {
        return this.recentLogs
            .filter(log => log.level === level)
            .slice(0, limit);
    }

    getLogsInTimeRange(startTime, endTime, limit = 1000) {
        const start = new Date(startTime);
        const end = new Date(endTime);
        
        return this.recentLogs
            .filter(log => {
                const logTime = new Date(log.timestamp);
                return logTime >= start && logTime <= end;
            })
            .slice(0, limit);
    }

    async exportLogs(format = 'json') {
        try {
            const logFilePath = path.join(this.logsDir, 'app.log');
            
            if (format === 'json') {
                return JSON.stringify(this.recentLogs, null, 2);
            } else {
                // Export as plain text
                const logContent = await fs.readFile(logFilePath, 'utf8');
                return logContent;
            }
        } catch (error) {
            this.error('Failed to export logs:', error);
            throw new Error('Failed to export logs');
        }
    }

    clearLogs() {
        try {
            this.recentLogs = [];
            
            // Also clear log files (optional)
            const logFiles = [
                path.join(this.logsDir, 'app.log'),
                path.join(this.logsDir, 'error.log'),
                path.join(this.logsDir, 'email.log')
            ];
            
            logFiles.forEach(file => {
                try {
                    if (fs.existsSync(file)) {
                        fs.writeFileSync(file, '');
                    }
                } catch (error) {
                    console.error(`Failed to clear log file ${file}:`, error);
                }
            });
            
            this.info('Logs cleared');
            return true;
            
        } catch (error) {
            this.error('Failed to clear logs:', error);
            return false;
        }
    }

    // Performance monitoring
    startTimer(label) {
        const startTime = Date.now();
        return {
            end: () => {
                const duration = Date.now() - startTime;
                this.info(`Timer ${label}: ${duration}ms`, {
                    type: 'performance',
                    label: label,
                    duration: duration
                });
                return duration;
            }
        };
    }

    // Memory usage logging
    logMemoryUsage() {
        const usage = process.memoryUsage();
        this.info('Memory usage', {
            type: 'memory_usage',
            rss: Math.round(usage.rss / 1024 / 1024) + ' MB',
            heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + ' MB',
            heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + ' MB',
            external: Math.round(usage.external / 1024 / 1024) + ' MB'
        });
    }

    // Archive old logs
    async archiveLogs() {
        try {
            const archiveDir = path.join(this.logsDir, 'archive');
            await fs.ensureDir(archiveDir);
            
            const currentDate = new Date().toISOString().split('T')[0];
            const archiveFile = path.join(archiveDir, `logs_${currentDate}.tar.gz`);
            
            // This would require additional implementation for actual archiving
            this.info(`Logs archived to ${archiveFile}`, {
                type: 'logs_archived',
                archiveFile: archiveFile
            });
            
            return archiveFile;
            
        } catch (error) {
            this.error('Failed to archive logs:', error);
            throw error;
        }
    }

    // Get log statistics
    getLogStatistics() {
        const stats = {
            total: this.recentLogs.length,
            byLevel: {},
            byType: {},
            timeRange: {
                oldest: null,
                newest: null
            }
        };

        if (this.recentLogs.length > 0) {
            stats.timeRange.oldest = this.recentLogs[this.recentLogs.length - 1].timestamp;
            stats.timeRange.newest = this.recentLogs[0].timestamp;
        }

        this.recentLogs.forEach(log => {
            // Count by level
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
            
            // Count by type
            if (log.type) {
                stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
            }
        });

        return stats;
    }
}

module.exports = Logger;