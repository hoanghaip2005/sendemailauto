const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const fs = require('fs-extra');
const path = require('path');

class GmailService {
    constructor() {
        this.gmail = null;
        this.auth = null;
        this.transporter = null;
        this.initialized = false;
        this.authenticated = false;
    }

    async initialize() {
        try {
            console.log('Initializing Gmail service...');
            
            // Setup OAuth2 authentication for Gmail API
            this.auth = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'
            );

            // Check if we have stored credentials
            if (process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_REFRESH_TOKEN !== 'your-refresh-token-here') {
                this.auth.setCredentials({
                    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
                });
                
                try {
                    // Get fresh access token to verify credentials
                    const { credentials } = await this.auth.refreshAccessToken();
                    this.auth.setCredentials(credentials);
                    this.authenticated = true;
                    console.log('Gmail authentication successful');
                } catch (error) {
                    console.warn('Stored refresh token invalid, need to re-authenticate:', error.message);
                    this.authenticated = false;
                }
            } else {
                console.log('No valid refresh token found - authentication required');
                this.authenticated = false;
            }

            // Initialize Gmail API
            this.gmail = google.gmail({ version: 'v1', auth: this.auth });

            // Setup Nodemailer transporter for sending emails
            if (this.authenticated) {
                await this.setupTransporter();
            }

            this.initialized = true;
            console.log('Gmail service initialized, authenticated:', this.authenticated);

        } catch (error) {
            console.error('Failed to initialize Gmail service:', error);
            throw error;
        }
    }

    async setupTransporter() {
        try {
            // Get fresh access token
            const tokenInfo = await this.auth.getAccessToken();
            
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    type: 'OAuth2',
                    user: process.env.GMAIL_USER_EMAIL,
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
                    accessToken: tokenInfo.token
                }
            });

            // Verify the transporter
            await this.transporter.verify();
            console.log('Gmail transporter verified successfully');

        } catch (error) {
            console.error('Failed to setup Gmail transporter:', error);
            throw error;
        }
    }

    async isAuthenticated() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            if (!this.authenticated) {
                return false;
            }

            // Test by getting user profile
            await this.gmail.users.getProfile({
                userId: 'me'
            });

            return true;
        } catch (error) {
            console.error('Gmail authentication check failed:', error);
            return false;
        }
    }

    async getAuthUrl() {
        if (!this.initialized) {
            await this.initialize();
        }

        const scopes = [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.readonly'
        ];

        const authUrl = this.auth.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent' // Force consent to get refresh token
        });

        return authUrl;
    }

    async exchangeCodeForTokens(code) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            const { tokens } = await this.auth.getToken(code);
            this.auth.setCredentials(tokens);

            // Store the refresh token securely
            if (tokens.refresh_token) {
                console.log('Received refresh token - store this securely in your environment variables:');
                console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
            }

            this.authenticated = true;
            await this.setupTransporter();

            return tokens;
        } catch (error) {
            console.error('Failed to exchange code for tokens:', error);
            throw error;
        }
    }

    async sendEmail(to, subject, htmlContent, textContent = null) {
        try {
            if (!this.authenticated) {
                throw new Error('Gmail service not authenticated');
            }

            // Refresh transporter if needed
            if (!this.transporter) {
                await this.setupTransporter();
            }

            const mailOptions = {
                from: `"Email Automation Tool" <${process.env.GMAIL_USER_EMAIL}>`,
                to: Array.isArray(to) ? to.join(', ') : to,
                subject: subject,
                html: htmlContent,
                text: textContent || this.htmlToText(htmlContent)
            };

            const result = await this.transporter.sendMail(mailOptions);
            
            return {
                success: true,
                messageId: result.messageId,
                response: result.response
            };

        } catch (error) {
            console.error('Failed to send email:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async sendBulkEmails(emails) {
        const results = {
            sent: 0,
            failed: 0,
            details: []
        };

        for (const email of emails) {
            try {
                const result = await this.sendEmail(
                    email.to,
                    email.subject,
                    email.html,
                    email.text
                );

                if (result.success) {
                    results.sent++;
                    results.details.push({
                        email: email.to,
                        status: 'sent',
                        messageId: result.messageId
                    });
                } else {
                    results.failed++;
                    results.details.push({
                        email: email.to,
                        status: 'failed',
                        error: result.error
                    });
                }

                // Add delay between emails to avoid rate limiting
                await this.delay(1000); // 1 second delay

            } catch (error) {
                results.failed++;
                results.details.push({
                    email: email.to,
                    status: 'failed',
                    error: error.message
                });
            }
        }

        return results;
    }

    async getUserProfile() {
        try {
            if (!this.authenticated) {
                throw new Error('Not authenticated');
            }

            const response = await this.gmail.users.getProfile({
                userId: 'me'
            });

            return {
                emailAddress: response.data.emailAddress,
                messagesTotal: response.data.messagesTotal,
                threadsTotal: response.data.threadsTotal
            };

        } catch (error) {
            console.error('Failed to get user profile:', error);
            throw error;
        }
    }

    async getQuotaInfo() {
        try {
            // Gmail API doesn't directly provide quota info
            // This is a placeholder for quota monitoring
            return {
                dailyLimit: 100, // Default Gmail API limit for sending
                sent: 0, // Would need to track this ourselves
                remaining: 100
            };

        } catch (error) {
            console.error('Failed to get quota info:', error);
            return null;
        }
    }

    htmlToText(html) {
        if (!html) return '';
        
        // Simple HTML to text conversion
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
    }

    formatEmailContent(content) {
        // Convert plain text to HTML if needed
        if (!content.includes('<')) {
            return content
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>');
        }
        return content;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Email validation
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Rate limiting helper
    async waitForRateLimit() {
        // Gmail API allows 1 billion quota units per day
        // Sending an email costs about 100 quota units
        // This is a simple rate limiter
        
        const now = Date.now();
        const lastSent = this.lastSentTime || 0;
        const timeSinceLastSent = now - lastSent;
        
        // Ensure at least 1 second between emails
        if (timeSinceLastSent < 1000) {
            await this.delay(1000 - timeSinceLastSent);
        }
        
        this.lastSentTime = Date.now();
    }

    // Template processing
    processEmailTemplate(template, variables = {}) {
        let processed = template;
        
        Object.keys(variables).forEach(key => {
            const placeholder = new RegExp(`{{${key}}}`, 'g');
            processed = processed.replace(placeholder, variables[key] || '');
        });
        
        return processed;
    }

    // Email tracking (basic)
    generateTrackingPixel(recipientId) {
        const trackingUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/track/${recipientId}`;
        return `<img src="${trackingUrl}" width="1" height="1" style="display:none;" alt="">`;
    }

    // Batch email preparation
    prepareEmailBatch(recipients, template) {
        return recipients.map(recipient => {
            const personalizedSubject = this.processEmailTemplate(template.subject, recipient);
            const personalizedContent = this.processEmailTemplate(template.content, recipient);
            const htmlContent = this.formatEmailContent(personalizedContent);
            
            return {
                to: recipient.allEmails || [recipient.primaryEmail],
                subject: personalizedSubject,
                html: htmlContent + (recipient.id ? this.generateTrackingPixel(recipient.id) : ''),
                text: this.htmlToText(htmlContent),
                recipientId: recipient.id || recipient.rowIndex
            };
        });
    }
}

module.exports = GmailService;