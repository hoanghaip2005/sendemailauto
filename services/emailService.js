class EmailService {
    constructor(sheetsService, gmailService, logger) {
        this.sheetsService = sheetsService;
        this.gmailService = gmailService;
        this.logger = logger;
        this.processing = false;
    }

    // NEW METHOD: Process only 1 email per run
    async processSingleEmail() {
        if (this.processing) {
            throw new Error('Email processing already in progress');
        }

        this.processing = true;
        
        try {
            this.logger.info('Starting single email processing...');
            
            // Get unprocessed recipients
            const recipients = await this.sheetsService.getUnprocessedRecipients();
            if (recipients.length === 0) {
                this.logger.info('No unprocessed recipients found');
                return { sent: 0, failed: 0, message: 'No emails to send' };
            }

            // Take only the FIRST recipient
            const singleRecipient = [recipients[0]];
            this.logger.info(`Processing 1 email for: ${singleRecipient[0].name || singleRecipient[0].email}`);

            // Get email template
            const template = await this.sheetsService.getEmailTemplate();
            if (!template || !template.subject || !template.content) {
                throw new Error('Invalid email template');
            }

            // Prepare single email
            const emails = this.gmailService.prepareEmailBatch(singleRecipient, template);
            this.logger.info(`Prepared 1 email for sending`);

            // Send single email
            const results = await this.sendEmailsWithRetry(emails);
            
            // Update recipient status
            await this.updateRecipientStatuses(singleRecipient, results.details);

            this.logger.info(`Single email processing completed. Sent: ${results.sent}, Failed: ${results.failed}`);

            return {
                sent: results.sent,
                failed: results.failed,
                total: 1,
                remainingEmails: recipients.length - 1,
                details: results.details
            };

        } catch (error) {
            this.logger.error('Single email processing failed:', error);
            throw error;
        } finally {
            this.processing = false;
        }
    }

    async processEmails() {
        if (this.processing) {
            throw new Error('Email processing already in progress');
        }

        this.processing = true;
        
        try {
            this.logger.info('Starting email processing...');
            
            // Get unprocessed recipients
            const recipients = await this.sheetsService.getUnprocessedRecipients();
            if (recipients.length === 0) {
                this.logger.info('No unprocessed recipients found');
                return { sent: 0, failed: 0, message: 'No emails to send' };
            }

            this.logger.info(`Found ${recipients.length} recipients to process`);

            // Get email template
            const template = await this.sheetsService.getEmailTemplate();
            if (!template || !template.subject || !template.content) {
                throw new Error('Invalid email template');
            }

            // Prepare emails
            const emails = this.gmailService.prepareEmailBatch(recipients, template);
            this.logger.info(`Prepared ${emails.length} emails for sending`);

            // Send emails
            const results = await this.sendEmailsWithRetry(emails);
            
            // Update recipient statuses
            await this.updateRecipientStatuses(recipients, results.details);

            this.logger.info(`Email processing completed. Sent: ${results.sent}, Failed: ${results.failed}`);

            return {
                sent: results.sent,
                failed: results.failed,
                total: emails.length,
                details: results.details
            };

        } catch (error) {
            this.logger.error('Email processing failed:', error);
            throw error;
        } finally {
            this.processing = false;
        }
    }

    async sendEmailsWithRetry(emails, maxRetries = 3) {
        const results = {
            sent: 0,
            failed: 0,
            details: []
        };

        for (const email of emails) {
            let lastError = null;
            let sent = false;

            for (let attempt = 1; attempt <= maxRetries && !sent; attempt++) {
                try {
                    this.logger.info(`Sending email to ${email.to} (attempt ${attempt}/${maxRetries})`);
                    
                    const result = await this.gmailService.sendEmail(
                        email.to,
                        email.subject,
                        email.html,
                        email.text
                    );

                    if (result.success) {
                        results.sent++;
                        results.details.push({
                            recipientId: email.recipientId,
                            email: email.to,
                            status: 'sent',
                            messageId: result.messageId,
                            attempt: attempt
                        });
                        sent = true;
                        this.logger.info(`Email sent successfully to ${email.to}`);
                    } else {
                        lastError = result.error;
                        this.logger.warn(`Email sending failed to ${email.to}: ${result.error}`);
                    }

                } catch (error) {
                    lastError = error.message;
                    this.logger.warn(`Email sending error to ${email.to}: ${error.message}`);
                }

                // Wait before retry (exponential backoff)
                if (!sent && attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
                    await this.delay(delay);
                }
            }

            if (!sent) {
                results.failed++;
                results.details.push({
                    recipientId: email.recipientId,
                    email: email.to,
                    status: 'failed',
                    error: lastError,
                    attempts: maxRetries
                });
                this.logger.error(`Failed to send email to ${email.to} after ${maxRetries} attempts: ${lastError}`);
            }

            // Rate limiting - wait between emails
            await this.gmailService.waitForRateLimit();
        }

        return results;
    }

    async updateRecipientStatuses(recipients, emailResults) {
        for (const result of emailResults) {
            const recipient = recipients.find(r => r.rowIndex === result.recipientId);
            if (recipient) {
                const status = result.status === 'sent' ? 'sent' : 'failed';
                try {
                    // Log to Sheet3 with Name | Email | Status | Timestamp format
                    await this.sheetsService.logEmailResult(
                        recipient.name,
                        result.email,
                        status,
                        new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
                    );
                    
                    // Also update original method (though it may be commented out)
                    await this.sheetsService.updateRecipientStatus(recipient.rowIndex, status);
                    
                    this.logger.info(`Logged result to Sheet3 for ${recipient.name} (${result.email}): ${status}`);
                } catch (error) {
                    this.logger.warn(`Failed to log result for ${recipient.name}: ${error.message}`);
                }
            }
        }
    }

    async getEmailPreview() {
        try {
            // Get email template
            const template = await this.sheetsService.getEmailTemplate();
            
            // Get a sample recipient for preview
            const recipients = await this.sheetsService.getRecipientData();
            const sampleRecipient = recipients.length > 0 ? recipients[0] : {
                name: 'Ví dụ',
                keyword: 'từ khóa mẫu',
                address: 'địa chỉ mẫu',
                website: 'website-mau.com',
                primaryEmail: 'email@example.com'
            };

            // Personalize the template
            const personalizedTemplate = this.sheetsService.personalizeContent(template, sampleRecipient);

            return {
                subject: personalizedTemplate.subject,
                content: personalizedTemplate.content,
                recipient: sampleRecipient
            };

        } catch (error) {
            this.logger.error('Failed to get email preview:', error);
            return {
                subject: 'Error loading preview',
                content: 'Unable to load email preview',
                recipient: null
            };
        }
    }

    async getProcessingStatus() {
        return {
            processing: this.processing,
            canProcess: !this.processing && await this.gmailService.isAuthenticated()
        };
    }

    async validateConfiguration() {
        const issues = [];

        try {
            // Check Google Sheets connection
            const sheetsConnected = await this.sheetsService.testConnection();
            if (!sheetsConnected) {
                issues.push('Google Sheets connection failed');
            }

            // Check Gmail authentication
            const gmailAuth = await this.gmailService.isAuthenticated();
            if (!gmailAuth) {
                issues.push('Gmail authentication failed');
            }

            // Check if we have recipients
            const recipients = await this.sheetsService.getRecipientData();
            if (recipients.length === 0) {
                issues.push('No recipients found in Google Sheets');
            }

            // Check email template
            const template = await this.sheetsService.getEmailTemplate();
            if (!template || !template.subject || !template.content) {
                issues.push('Invalid or missing email template');
            }

        } catch (error) {
            issues.push(`Configuration validation error: ${error.message}`);
        }

        return {
            valid: issues.length === 0,
            issues: issues
        };
    }

    async getStatistics() {
        try {
            const sheetStats = await this.sheetsService.getRecipientStats();
            const gmailQuota = await this.gmailService.getQuotaInfo();

            return {
                recipients: sheetStats,
                quota: gmailQuota,
                lastProcessed: this.lastProcessedTime || null
            };

        } catch (error) {
            this.logger.error('Failed to get statistics:', error);
            return null;
        }
    }

    async testEmailSend(testEmail) {
        try {
            if (!this.gmailService.isValidEmail(testEmail)) {
                throw new Error('Invalid test email address');
            }

            const template = await this.sheetsService.getEmailTemplate();
            const testSubject = `[TEST] ${template.subject}`;
            const testContent = `<p><strong>This is a test email from Email Automation Tool</strong></p><hr>${this.gmailService.formatEmailContent(template.content)}`;

            const result = await this.gmailService.sendEmail(
                testEmail,
                testSubject,
                testContent
            );

            if (result.success) {
                this.logger.info(`Test email sent successfully to ${testEmail}`);
                return { success: true, messageId: result.messageId };
            } else {
                throw new Error(result.error);
            }

        } catch (error) {
            this.logger.error(`Test email failed: ${error.message}`);
            throw error;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Email queue management (for future enhancement)
    async addToQueue(recipients) {
        // This could be implemented with a proper queue system like Redis
        // For now, we process emails immediately
        return this.processEmails();
    }

    async getQueueStatus() {
        return {
            pending: 0,
            processing: this.processing ? 1 : 0,
            completed: 0,
            failed: 0
        };
    }
}

module.exports = EmailService;