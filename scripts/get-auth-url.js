#!/usr/bin/env node

const { google } = require('googleapis');
require('dotenv').config();

async function getAuthUrl() {
    try {
        const auth = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        const scopes = [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.readonly'
        ];

        const authUrl = auth.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent'
        });

        console.log('\n🔐 Gmail API Authentication Setup');
        console.log('=====================================');
        console.log('\n1. Visit the following URL in your browser:');
        console.log('\n' + authUrl);
        console.log('\n2. Sign in with your Gmail account');
        console.log('3. Grant permissions to the application');
        console.log('4. Copy the authorization code');
        console.log('5. Run: npm run save-token <authorization-code>');
        console.log('\n=====================================\n');

    } catch (error) {
        console.error('❌ Error generating auth URL:', error.message);
        process.exit(1);
    }
}

getAuthUrl();