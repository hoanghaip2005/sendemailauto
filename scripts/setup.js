#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Email Automation Tool Setup');
console.log('================================\n');

try {
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 18) {
        console.error('❌ Node.js 18 or higher is required. Current version:', nodeVersion);
        process.exit(1);
    }
    
    console.log('✅ Node.js version check passed:', nodeVersion);

    // Check if .env exists
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        console.log('📄 Creating .env file from template...');
        const envExamplePath = path.join(__dirname, '..', '.env.example');
        fs.copyFileSync(envExamplePath, envPath);
        console.log('✅ .env file created');
    } else {
        console.log('✅ .env file already exists');
    }

    // Install dependencies
    console.log('📦 Installing dependencies...');
    execSync('npm install', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('✅ Dependencies installed');

    // Create logs directory
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
        console.log('✅ Logs directory created');
    }

    console.log('\n🎉 Setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Edit .env file with your Gmail address');
    console.log('2. Run: npm run get-auth-url');
    console.log('3. Follow authentication steps');
    console.log('4. Run: npm run save-token <code>');
    console.log('5. Start application: npm start');
    console.log('\n📖 For detailed instructions, see README.md');

} catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
}