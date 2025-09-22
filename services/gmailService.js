// services/gmailService.js
const nodemailer = require('nodemailer');

class GmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.authenticated = false;
    this.lastSentTime = 0;
  }

  async initialize() {
    try {
      console.log('Initializing Gmail service (App Password only)...');

      const email = process.env.GMAIL_USER_EMAIL;
      const appPass = process.env.GMAIL_APP_PASSWORD;

      if (!email || !appPass) {
        throw new Error('GMAIL_USER_EMAIL or GMAIL_APP_PASSWORD is missing');
      }

      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: email,
          pass: appPass
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        socketTimeout: 60_000,
        connectionTimeout: 60_000,
        greetingTimeout: 30_000
      });

      await this.transporter.verify();
      this.initialized = true;
      this.authenticated = true;
      console.log('App Password Gmail transporter verified successfully');
    } catch (error) {
      console.error('Failed to initialize Gmail service:', error);
      throw error;
    }
  }

  async isAuthenticated() {
    if (!this.initialized) {
      await this.initialize();
    }
    return Boolean(this.authenticated && this.transporter);
  }

  // OAuth endpoints are not applicable anymore
  async getAuthUrl() {
    throw new Error('OAuth2 is disabled. Using App Password only.');
  }

  async exchangeCodeForTokens() {
    throw new Error('OAuth2 is disabled. Using App Password only.');
  }

  async sendEmail(to, subject, htmlContent, textContent = null) {
    try {
      if (!this.authenticated || !this.transporter) {
        throw new Error('Gmail service not authenticated');
      }

      const mailOptions = {
        from: `"Email Automation Tool" <${process.env.GMAIL_USER_EMAIL}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
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
      return { success: false, error: error.message };
    }
  }

  async sendBulkEmails(emails) {
    const results = { sent: 0, failed: 0, details: [] };

    for (const email of emails) {
      try {
        const result = await this.sendEmail(email.to, email.subject, email.html, email.text);

        if (result.success) {
          results.sent++;
          results.details.push({ email: email.to, status: 'sent', messageId: result.messageId });
        } else {
          results.failed++;
          results.details.push({ email: email.to, status: 'failed', error: result.error });
        }

        await this.waitForRateLimit();
      } catch (error) {
        results.failed++;
        results.details.push({ email: email.to, status: 'failed', error: error.message });
      }
    }

    return results;
  }

  // Quota info not available via SMTP; keep a simple placeholder
  async getQuotaInfo() {
    return {
      dailyLimit: null,  // unknown for SMTP
      sent: null,
      remaining: null
    };
  }

  htmlToText(html) {
    if (!html) return '';
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

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async waitForRateLimit() {
    // ensure ~1s between sends (or use EMAIL_RATE_LIMIT_MS env)
    const minGap = Number(process.env.EMAIL_RATE_LIMIT_MS || 1000);
    const now = Date.now();
    const since = now - (this.lastSentTime || 0);
    if (since < minGap) {
      await this.delay(minGap - since);
    }
    this.lastSentTime = Date.now();
  }

  processEmailTemplate(template, variables = {}) {
    let processed = template;
    Object.keys(variables).forEach(key => {
      const placeholder = new RegExp(`{{${key}}}`, 'g');
      processed = processed.replace(placeholder, variables[key] || '');
    });
    return processed;
  }

  generateTrackingPixel(recipientId) {
    const trackingUrl = `${process.env.BASE_URL || 'http://localhost:8080'}/api/track/${recipientId}`;
    return `<img src="${trackingUrl}" width="1" height="1" style="display:none;" alt="">`;
  }

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
