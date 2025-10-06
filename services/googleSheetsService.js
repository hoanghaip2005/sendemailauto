const { google } = require('googleapis');
const path = require('path');
const fs = require('fs-extra');

class GoogleSheetsService {
    constructor() {
        this.sheets = null;
        this.auth = null;
        this.spreadsheetId = this.extractSpreadsheetId(process.env.GOOGLE_SHEET_URL);
        this.initialized = false;
    }

    extractSpreadsheetId(url) {
        if (!url) {
            throw new Error('GOOGLE_SHEET_URL not provided');
        }
        
        // Extract ID from Google Sheets URL
        const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (!match) {
            throw new Error('Invalid Google Sheets URL format');
        }
        
        return match[1];
    }

    async initialize() {
        try {
            // For Cloud Run, prioritize service account authentication
            const isCloudRun = !!(process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT);
            
            if (isCloudRun) {
                console.log('Using Google Application Default Credentials for Cloud Run');
                this.auth = new google.auth.GoogleAuth({
                    scopes: [
                        'https://www.googleapis.com/auth/spreadsheets',
                        'https://www.googleapis.com/auth/drive.file'
                    ],
                });
                this.sheets = google.sheets({ version: 'v4', auth: this.auth });
                this.initialized = true;
                return;
            }

            // Use service account if keyFile is specified (for local development)
            if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
                console.log('Using service account for Sheets access');
                this.auth = new google.auth.GoogleAuth({
                    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
                    scopes: [
                        'https://www.googleapis.com/auth/spreadsheets',
                        'https://www.googleapis.com/auth/drive.file'
                    ],
                });
                this.sheets = google.sheets({ version: 'v4', auth: this.auth });
                this.initialized = true;
                return;
            }

            // Use OAuth2 credentials if available
            if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
                console.log('Using OAuth2 for Sheets access');
                this.auth = new google.auth.OAuth2(
                    process.env.GOOGLE_CLIENT_ID,
                    process.env.GOOGLE_CLIENT_SECRET,
                    process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'
                );

                // Set refresh token if available
                if (process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_REFRESH_TOKEN !== 'your-refresh-token-here') {
                    this.auth.setCredentials({
                        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
                    });
                }

                this.sheets = google.sheets({ version: 'v4', auth: this.auth });
                this.initialized = true;
                return;
            }

            // Fallback to API key for read-only access
            if (process.env.GOOGLE_API_KEY) {
                console.log('Using Google API key for Sheets access (read-only)');
                this.sheets = google.sheets({ 
                    version: 'v4', 
                    auth: process.env.GOOGLE_API_KEY 
                });
                this.initialized = true;
                return;
            }

            throw new Error('No valid Google authentication method found. Please provide OAuth2 credentials, service account key file, or API key.');

        } catch (error) {
            console.error('Failed to initialize Google Sheets service:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Try to read a small range to test connection
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet1!A1:B1',
            });

            return response.status === 200;
        } catch (error) {
            console.error('Google Sheets connection test failed:', error);
            return false;
        }
    }

    async getRecipientData() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Read recipient data from Sheet1 (columns A to F + additional email columns)
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet1!A:Z', // Read all columns from A to Z
            });

            const rows = response.data.values;
            if (!rows || rows.length === 0) {
                return [];
            }

            // First row contains headers
            const headers = rows[0];
            const recipients = [];

            // Process each row (skip header row)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                
                // Skip empty rows
                if (!row || row.length === 0) {
                    continue;
                }

                const recipient = {
                    keyword: row[0] || '', // Từ khóa (Column A)
                    name: row[1] || '',     // Tên (Column B)
                    address: row[2] || '',  // Địa chỉ (Column C)
                    website: row[3] || '',  // Trang web (Column D)
                    primaryEmail: row[4] || '', // Email chính (Column E)
                    status: row[5] || 'new', // Trạng thái (Column F)
                    additionalEmails: [],   // Emails từ cột G trở đi
                    rowIndex: i + 1 // Store row index for updating status
                };

                // Extract additional emails from column G onwards
                for (let j = 6; j < row.length; j++) {
                    const email = row[j];
                    if (email && this.isValidEmail(email)) {
                        recipient.additionalEmails.push(email);
                    }
                }

                // Only add recipient if they have at least one valid email
                const allEmails = [recipient.primaryEmail, ...recipient.additionalEmails]
                    .filter(email => email && this.isValidEmail(email));
                
                if (allEmails.length > 0) {
                    recipient.allEmails = allEmails;
                    recipients.push(recipient);
                }
            }

            return recipients;

        } catch (error) {
            console.error('Error getting recipient data:', error);
            throw new Error(`Failed to read recipient data: ${error.message}`);
        }
    }

    async getEmailTemplate() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Read email template from Sheet2
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet2!A:B', // Title in column A, Subject/Content in column B
            });

            const rows = response.data.values;
            if (!rows || rows.length === 0) {
                return {
                    subject: 'Default Subject',
                    content: 'Default email content'
                };
            }

            // Filter out header row and empty rows
            const validRows = rows.filter((row, index) => {
                // Skip first row if it looks like a header
                if (index === 0 && 
                    ((row[0] || '').toLowerCase().includes('title') || 
                     (row[0] || '').toLowerCase().includes('tiêu đề') ||
                     (row[1] || '').toLowerCase().includes('subject'))) {
                    return false;
                }
                // Keep rows that have both title and subject
                return row && row.length >= 2 && row[0] && row[1];
            });

            if (validRows.length === 0) {
                return {
                    subject: 'Default Subject',
                    content: 'Default email content'
                };
            }

            // RANDOMLY select one row for this email
            const randomIndex = Math.floor(Math.random() * validRows.length);
            const selectedRow = validRows[randomIndex];

            const template = {
                title: selectedRow[0].trim(),           // Column A: Title
                subject: selectedRow[1].trim(),         // Column B: Subject
                content: selectedRow[1].trim(),         // Use subject as content for now
                selectedIndex: randomIndex,
                totalOptions: validRows.length
            };

            console.log(`Email template: Selected row ${randomIndex + 1}/${validRows.length}: "${template.title}" - "${template.subject}"`);

            return template;

        } catch (error) {
            console.error('Error getting email template:', error);
            throw new Error(`Failed to read email template: ${error.message}`);
        }
    }

    // NEW METHOD: Log email results to Sheet3
    async logEmailResult(recipientName, recipientEmail, status, timestamp = null) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Use current timestamp if not provided
            const logTimestamp = timestamp || new Date().toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // Prepare row data: Name | Email | Status | Timestamp
            const rowData = [
                recipientName || 'Unknown',
                recipientEmail || 'Unknown',
                status || 'unknown',
                logTimestamp
            ];

            console.log(`Logging to Sheet3: ${recipientName} (${recipientEmail}) - ${status} at ${logTimestamp}`);

            // Check if Sheet3 exists and has headers, if not create them
            try {
                const response = await this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Sheet3!A1:D1',
                });

                // If no headers, add them first
                if (!response.data.values || response.data.values.length === 0) {
                    await this.sheets.spreadsheets.values.update({
                        spreadsheetId: this.spreadsheetId,
                        range: 'Sheet3!A1:D1',
                        valueInputOption: 'USER_ENTERED',
                        requestBody: {
                            values: [['Name', 'Email', 'Status', 'Timestamp']]
                        }
                    });
                }
            } catch (error) {
                console.log('Sheet3 may not exist or headers not found, will try to append anyway');
            }

            // Append the new result
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet3!A:D',
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values: [rowData]
                }
            });

            console.log(`Successfully logged result to Sheet3`);
            return true;

        } catch (error) {
            console.error('Error logging email result to Sheet3:', error);
            return false;
        }
    }

    async updateRecipientStatus(rowIndex, status) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Note: This requires write permissions
            // For now, we'll just log the update since we're using API key (read-only)
            console.log(`Would update row ${rowIndex} status to: ${status}`);
            
            // If you have write permissions, uncomment the following:
            /*
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Sheet1!F${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[status]]
                }
            });
            */

            return true;
        } catch (error) {
            console.error('Error updating recipient status:', error);
            return false;
        }
    }

    async getSpreadsheetInfo() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            const response = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId,
            });

            return {
                title: response.data.properties.title,
                sheets: response.data.sheets.map(sheet => ({
                    title: sheet.properties.title,
                    sheetId: sheet.properties.sheetId,
                    rowCount: sheet.properties.gridProperties.rowCount,
                    columnCount: sheet.properties.gridProperties.columnCount
                }))
            };

        } catch (error) {
            console.error('Error getting spreadsheet info:', error);
            throw error;
        }
    }

    isValidEmail(email) {
        if (!email || typeof email !== 'string') {
            return false;
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email.trim());
    }

    // Utility method to personalize email content
    personalizeContent(template, recipient) {
        let personalizedSubject = template.subject;
        let personalizedContent = template.content;

        // Replace placeholders with recipient data
        const replacements = {
            '{{name}}': recipient.name || 'Bạn',
            '{{keyword}}': recipient.keyword || '',
            '{{address}}': recipient.address || '',
            '{{website}}': recipient.website || '',
            '{{email}}': recipient.primaryEmail || '',
            '{{company}}': recipient.name || '', // Assuming name might be company name
        };

        Object.keys(replacements).forEach(placeholder => {
            const value = replacements[placeholder];
            personalizedSubject = personalizedSubject.replace(new RegExp(placeholder, 'g'), value);
            personalizedContent = personalizedContent.replace(new RegExp(placeholder, 'g'), value);
        });

        return {
            subject: personalizedSubject,
            content: personalizedContent
        };
    }

    // Get recipients that haven't been processed yet
    async getUnprocessedRecipients() {
        const allRecipients = await this.getRecipientData();
        return allRecipients.filter(recipient => 
            recipient.status !== 'sent' && 
            recipient.status !== 'failed' && 
            recipient.status !== 'completed'
        );
    }

    // Get summary statistics
    async getRecipientStats() {
        try {
            const allRecipients = await this.getRecipientData();
            
            const stats = {
                total: allRecipients.length,
                sent: allRecipients.filter(r => r.status === 'sent').length,
                failed: allRecipients.filter(r => r.status === 'failed').length,
                pending: allRecipients.filter(r => r.status === 'new' || r.status === 'pending').length,
                totalEmails: 0
            };

            // Count total email addresses
            allRecipients.forEach(recipient => {
                stats.totalEmails += recipient.allEmails ? recipient.allEmails.length : 0;
            });

            return stats;
        } catch (error) {
            console.error('Error getting recipient stats:', error);
            return {
                total: 0,
                sent: 0,
                failed: 0,
                pending: 0,
                totalEmails: 0
            };
        }
    }
}

module.exports = GoogleSheetsService;