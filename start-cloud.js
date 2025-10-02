#!/usr/bin/env node

const EmailAutomationServer = require('./server');

console.log('🌐 Starting Email Automation Server for Cloud Run...');

// Check if running in Cloud Run environment
const isCloudRun = process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT;

if (isCloudRun) {
    console.log('📡 Detected Cloud Run environment');
    // Cloud Run handles process management, no need for PM2
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
} else {
    console.log('💻 Detected local environment');
}

// Environment-specific configuration
const config = {
    port: parseInt(process.env.PORT) || 3000,
    host: isCloudRun ? '0.0.0.0' : 'localhost',
    environment: process.env.NODE_ENV || 'development'
};

console.log(`🚀 Starting server on ${config.host}:${config.port} (${config.environment})`);

// Create and start server
const server = new EmailAutomationServer();
global.emailServer = server;

// Enhanced error handling for Cloud Run
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // In Cloud Run, let the container restart
    if (isCloudRun) {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // In Cloud Run, let the container restart
    if (isCloudRun) {
        process.exit(1);
    }
});

// Graceful shutdown for Cloud Run
const gracefulShutdown = async (signal) => {
    console.log(`🔄 Received ${signal}, shutting down gracefully...`);
    
    try {
        if (global.emailServer) {
            await global.emailServer.stop();
        }
        console.log('✅ Server stopped gracefully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
};

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
server.start()
    .then(() => {
        console.log('✅ Server started successfully');
        
        // Initialize services in background for Cloud Run
        if (isCloudRun) {
            // For Cloud Run, initialize services immediately to ensure readiness
            console.log('🔧 Initializing services for Cloud Run...');
            server.initializeServices()
                .then(() => console.log('✅ Services initialized'))
                .catch(error => console.warn('⚠️ Service initialization warning:', error.message));
        } else {
            // For local development, initialize in background
            server.initializeServices().catch(error => {
                console.error('❌ Service initialization failed:', error);
            });
        }
    })
    .catch(error => {
        console.error('❌ Server failed to start:', error);
        process.exit(1);
    });