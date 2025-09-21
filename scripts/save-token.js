#!/usr/bin/env node

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function saveToken() {
    const authCode = process.argv[2];
    
    if (!authCode) {
        console.error('❌ Please provide authorization code:');
        console.error('Usage: npm run save-token <authorization-code>');
        process.exit(1);
    }

    try {
        const auth = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'
        );

        console.log('🔄 Exchanging authorization code for tokens...');
        
        const { tokens } = await auth.getToken(authCode);
        
        if (!tokens.refresh_token) {
            console.error('❌ No refresh token received. Make sure you used prompt=consent in the auth URL');
            process.exit(1);
        }

        // Update .env file
        const envPath = path.join(__dirname, '..', '.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        // Update or add refresh token
        if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
            envContent = envContent.replace(
                /GOOGLE_REFRESH_TOKEN=.*/,
                `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`
            );
        } else {
            envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`;
        }

        // Update or add Gmail user email if not set
        if (!envContent.includes('GMAIL_USER_EMAIL=your-gmail-address@gmail.com') && tokens.access_token) {
            try {
                auth.setCredentials(tokens);
                const gmail = google.gmail({ version: 'v1', auth });
                const profile = await gmail.users.getProfile({ userId: 'me' });
                
                if (envContent.includes('GMAIL_USER_EMAIL=your-gmail-address@gmail.com')) {
                    envContent = envContent.replace(
                        /GMAIL_USER_EMAIL=your-gmail-address@gmail.com/,
                        `GMAIL_USER_EMAIL=${profile.data.emailAddress}`
                    );
                }
            } catch (error) {
                console.warn('⚠️ Could not auto-detect Gmail address:', error.message);
            }
        }

        fs.writeFileSync(envPath, envContent);

        console.log('✅ Tokens saved successfully!');
        console.log('📧 Gmail API is now authenticated and ready to use');
        console.log('\n🚀 You can now start the application with:');
        console.log('   npm start');
        console.log('\n✨ Or start in development mode with:');
        console.log('   npm run dev');

    } catch (error) {
        console.error('❌ Error saving tokens:', error.message);
        process.exit(1);
    }
}

saveToken();