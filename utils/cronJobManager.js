const cron = require('node-cron');

class CronJobManager {
    constructor(emailService, logger) {
        this.emailService = emailService;
        this.logger = logger;
        this.currentJob = null;
        this.interval = 30; // Default 30 minutes
        this.active = false;
        this.nextRunTime = null;
    }

    start(intervalMinutes = 30) {
        if (this.active) {
            this.logger.warn('Cronjob is already running');
            return false;
        }

        try {
            this.interval = intervalMinutes;
            
            // Create cron expression for the specified interval
            const cronExpression = this.createCronExpression(intervalMinutes);
            
            this.currentJob = cron.schedule(cronExpression, async () => {
                await this.executeEmailJob();
            }, {
                scheduled: false, // Don't start immediately
                timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh'
            });

            // Start the job
            this.currentJob.start();
            this.active = true;
            this.updateNextRunTime();

            this.logger.info(`Cronjob started with ${intervalMinutes} minute interval`);
            this.logger.info(`Next run: ${this.nextRunTime}`);

            // Run immediately on start (optional)
            if (process.env.RUN_ON_START === 'true') {
                setTimeout(() => this.executeEmailJob(), 5000); // Wait 5 seconds then run
            }

            return true;

        } catch (error) {
            this.logger.error('Failed to start cronjob:', error);
            return false;
        }
    }

    stop() {
        if (!this.active || !this.currentJob) {
            this.logger.warn('No cronjob is currently running');
            return false;
        }

        try {
            this.currentJob.stop();
            this.currentJob.destroy();
            this.currentJob = null;
            this.active = false;
            this.nextRunTime = null;

            this.logger.info('Cronjob stopped successfully');
            return true;

        } catch (error) {
            this.logger.error('Failed to stop cronjob:', error);
            return false;
        }
    }

    updateInterval(intervalMinutes) {
        if (!this.active) {
            this.interval = intervalMinutes;
            this.logger.info(`Cronjob interval updated to ${intervalMinutes} minutes (not active)`);
            return true;
        }

        try {
            // Stop current job
            this.stop();
            
            // Start with new interval
            const started = this.start(intervalMinutes);
            
            if (started) {
                this.logger.info(`Cronjob restarted with new interval: ${intervalMinutes} minutes`);
            }
            
            return started;

        } catch (error) {
            this.logger.error('Failed to update cronjob interval:', error);
            return false;
        }
    }

    async executeEmailJob() {
        try {
            this.logger.info('Cronjob: Starting automated email processing...');
            
            // Check if another email processing is already running
            const status = await this.emailService.getProcessingStatus();
            if (status.processing) {
                this.logger.warn('Cronjob: Email processing already in progress, skipping this run');
                return;
            }

            // Validate configuration before processing
            const validation = await this.emailService.validateConfiguration();
            if (!validation.valid) {
                this.logger.error(`Cronjob: Configuration issues found: ${validation.issues.join(', ')}`);
                return;
            }

            // Process emails
            const result = await this.emailService.processEmails();
            
            this.logger.info(`Cronjob completed: ${result.sent} sent, ${result.failed} failed`);
            
            // Update next run time
            this.updateNextRunTime();

        } catch (error) {
            this.logger.error('Cronjob execution failed:', error);
        }
    }

    createCronExpression(intervalMinutes) {
        // Convert interval to cron expression
        if (intervalMinutes < 60) {
            // For intervals less than 1 hour, run every N minutes
            return `*/${intervalMinutes} * * * *`;
        } else {
            // For intervals 1 hour or more, run every N hours
            const hours = Math.floor(intervalMinutes / 60);
            return `0 */${hours} * * *`;
        }
    }

    updateNextRunTime() {
        if (!this.active || !this.currentJob) {
            this.nextRunTime = null;
            return;
        }

        try {
            // Calculate next run time based on cron expression and current time
            const now = new Date();
            const nextRun = new Date(now.getTime() + (this.interval * 60 * 1000));
            this.nextRunTime = nextRun.toISOString();
        } catch (error) {
            this.logger.warn('Failed to calculate next run time:', error);
            this.nextRunTime = 'Unknown';
        }
    }

    isActive() {
        return this.active;
    }

    getInterval() {
        return this.interval;
    }

    getNextRun() {
        return this.nextRunTime;
    }

    getStatus() {
        return {
            active: this.active,
            interval: this.interval,
            nextRun: this.nextRunTime,
            lastRun: this.lastRunTime || null
        };
    }

    // Manual trigger
    async triggerNow() {
        try {
            this.logger.info('Manual cronjob trigger requested');
            await this.executeEmailJob();
            return true;
        } catch (error) {
            this.logger.error('Manual cronjob trigger failed:', error);
            return false;
        }
    }

    // Schedule one-time job
    scheduleOneTime(dateTime, description = 'One-time job') {
        try {
            const scheduledDate = new Date(dateTime);
            const now = new Date();

            if (scheduledDate <= now) {
                throw new Error('Scheduled time must be in the future');
            }

            const cronExpression = this.dateTimeToCron(scheduledDate);
            
            const oneTimeJob = cron.schedule(cronExpression, async () => {
                this.logger.info(`Executing one-time job: ${description}`);
                await this.executeEmailJob();
                oneTimeJob.destroy(); // Clean up after execution
            }, {
                scheduled: true,
                timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh'
            });

            this.logger.info(`One-time job scheduled for ${scheduledDate.toISOString()}: ${description}`);
            return true;

        } catch (error) {
            this.logger.error('Failed to schedule one-time job:', error);
            return false;
        }
    }

    dateTimeToCron(date) {
        const minute = date.getMinutes();
        const hour = date.getHours();
        const day = date.getDate();
        const month = date.getMonth() + 1;
        
        return `${minute} ${hour} ${day} ${month} *`;
    }

    // Get job statistics
    getStatistics() {
        return {
            active: this.active,
            interval: this.interval,
            nextRun: this.nextRunTime,
            lastRun: this.lastRunTime,
            totalRuns: this.totalRuns || 0,
            successfulRuns: this.successfulRuns || 0,
            failedRuns: this.failedRuns || 0
        };
    }

    // Cleanup on shutdown
    destroy() {
        this.stop();
        this.logger.info('CronJobManager destroyed');
    }
}

module.exports = CronJobManager;