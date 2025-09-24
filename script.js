// Email Automation Tool - Frontend JavaScript
class EmailAutomationApp {
    constructor() {
        this.baseURL = window.location.origin;
        this.stats = {
            total: 0,
            sent: 0,
            failed: 0,
            successRate: 0
        };
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkSystemStatus();
        this.loadStats();
        this.loadEmailPreview();
        this.startLogPolling();
        
        // Load initial data
        this.refreshData();
    }

    bindEvents() {
        // Control buttons
        document.getElementById('send-now').addEventListener('click', () => this.sendEmailsNow());
        document.getElementById('refresh-data').addEventListener('click', () => this.refreshData());
        document.getElementById('auth-gmail').addEventListener('click', () => this.authenticateGmail());
        
        // Log controls
        document.getElementById('clear-logs').addEventListener('click', () => this.clearLogs());
        document.getElementById('export-logs').addEventListener('click', () => this.exportLogs());
    }

    async apiCall(endpoint, method = 'GET', data = null) {
        try {
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            
            if (data) {
                options.body = JSON.stringify(data);
            }
            
            const response = await fetch(`${this.baseURL}/api${endpoint}`, options);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API call failed:', error);
            this.addLog('error', `API Error: ${error.message}`);
            throw error;
        }
    }

    async checkSystemStatus() {
        try {
            const status = await this.apiCall('/status');
            
            // Update Cloud Scheduler status
            this.updateStatusIndicator('scheduler-status', true, 'Đang hoạt động');
            
            // Update Google Sheets status
            this.updateStatusIndicator('sheets-status', status.sheets.connected, status.sheets.connected ? 'Kết nối thành công' : 'Lỗi kết nối');
            
            // Update Gmail status
            this.updateStatusIndicator('gmail-status', status.gmail.authenticated, status.gmail.authenticated ? 'Đã xác thực' : 'Chưa xác thực');
            
            // Show/hide Gmail auth button
            const authButton = document.getElementById('auth-gmail');
            if (!status.gmail.authenticated) {
                authButton.style.display = 'block';
            } else {
                authButton.style.display = 'none';
            }
            
            // Update last run
            if (status.lastRun) {
                document.getElementById('last-run').textContent = new Date(status.lastRun).toLocaleString('vi-VN');
            }
            
        } catch (error) {
            this.updateStatusIndicator('scheduler-status', false, 'Lỗi kết nối');
            this.updateStatusIndicator('sheets-status', false, 'Không thể kiểm tra');
            this.updateStatusIndicator('gmail-status', false, 'Không thể kiểm tra');
        }
    }

    updateStatusIndicator(elementId, isOnline, text) {
        const dot = document.getElementById(elementId);
        const textElement = document.getElementById(elementId.replace('-status', '-text'));
        
        dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        if (textElement) {
            textElement.textContent = text;
        }
    }

    async loadStats() {
        try {
            const stats = await this.apiCall('/stats');
            this.stats = stats;
            this.updateStatsDisplay();
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }

    updateStatsDisplay() {
        document.getElementById('total-emails').textContent = this.stats.total || 0;
        document.getElementById('sent-emails').textContent = this.stats.sent || 0;
        document.getElementById('failed-emails').textContent = this.stats.failed || 0;
        
        const successRate = this.stats.total > 0 
            ? Math.round((this.stats.sent / this.stats.total) * 100) 
            : 0;
        document.getElementById('success-rate').textContent = `${successRate}%`;
    }

    async loadEmailPreview() {
        try {
            const preview = await this.apiCall('/email-preview');
            document.getElementById('preview-subject').textContent = preview.subject || 'Không có tiêu đề';
            document.getElementById('preview-content').textContent = preview.content || 'Không có nội dung';
        } catch (error) {
            document.getElementById('preview-subject').textContent = 'Lỗi tải preview';
            document.getElementById('preview-content').textContent = 'Không thể tải nội dung email';
        }
    }

    async getSchedulerInfo() {
        try {
            const info = await this.apiCall('/scheduler/info');
            this.addLog('info', `Cloud Scheduler: ${info.description}`);
        } catch (error) {
            this.addLog('error', `Không thể lấy thông tin scheduler: ${error.message}`);
        }
    }

    async sendEmailsNow() {
        try {
            const button = document.getElementById('send-now');
            button.disabled = true;
            button.innerHTML = '<span class="loading"></span> Đang gửi...';
            
            this.addLog('info', 'Bắt đầu gửi email thủ công...');
            
            const result = await this.apiCall('/send-emails', 'POST');
            
            this.addLog('success', `Đã gửi thành công ${result.sent} email, ${result.failed} thất bại`);
            await this.loadStats();
            
        } catch (error) {
            this.addLog('error', `Lỗi gửi email: ${error.message}`);
        } finally {
            const button = document.getElementById('send-now');
            button.disabled = false;
            button.innerHTML = '<span class="btn-icon">📧</span> Gửi ngay';
        }
    }

    async refreshData() {
        try {
            const button = document.getElementById('refresh-data');
            button.disabled = true;
            button.innerHTML = '<span class="loading"></span> Đang làm mới...';
            
            await Promise.all([
                this.checkSystemStatus(),
                this.loadStats(),
                this.loadEmailPreview()
            ]);
            
            this.addLog('info', 'Dữ liệu đã được làm mới');
            
        } catch (error) {
            this.addLog('error', `Lỗi làm mới dữ liệu: ${error.message}`);
        } finally {
            const button = document.getElementById('refresh-data');
            button.disabled = false;
            button.innerHTML = '<span class="btn-icon">🔄</span> Làm mới dữ liệu';
        }
    }

    async authenticateGmail() {
        try {
            this.addLog('info', 'Khởi tạo xác thực Gmail...');
            
            // Open Gmail auth in a new window
            window.open('/auth/gmail', 'gmail_auth', 'width=500,height=600,scrollbars=yes,resizable=yes');
            
            // Check authentication status periodically
            const checkAuth = setInterval(async () => {
                try {
                    const status = await this.apiCall('/status');
                    if (status.gmail.authenticated) {
                        clearInterval(checkAuth);
                        this.addLog('success', 'Gmail đã được xác thực thành công!');
                        await this.checkSystemStatus(); // Refresh status
                    }
                } catch (error) {
                    // Ignore polling errors
                }
            }, 2000);
            
            // Stop checking after 5 minutes
            setTimeout(() => {
                clearInterval(checkAuth);
            }, 300000);
            
        } catch (error) {
            this.addLog('error', `Lỗi xác thực Gmail: ${error.message}`);
        }
    }

    openCloudConsole() {
        const url = 'https://console.cloud.google.com/cloudscheduler';
        window.open(url, '_blank');
        this.addLog('info', 'Đã mở Google Cloud Console - Cloud Scheduler');
    }

    addLog(type, message) {
        const logsContainer = document.getElementById('logs-content');
        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'log-time';
        timeSpan.textContent = new Date().toLocaleString('vi-VN');
        
        const messageSpan = document.createElement('span');
        messageSpan.className = 'log-message';
        messageSpan.textContent = message;
        
        logItem.appendChild(timeSpan);
        logItem.appendChild(messageSpan);
        
        logsContainer.insertBefore(logItem, logsContainer.firstChild);
        
        // Limit logs to 100 items
        while (logsContainer.children.length > 100) {
            logsContainer.removeChild(logsContainer.lastChild);
        }
        
        // Auto-scroll if user is at the top
        if (logsContainer.parentElement.scrollTop === 0) {
            logsContainer.parentElement.scrollTop = 0;
        }
    }

    async clearLogs() {
        if (confirm('Bạn có chắc muốn xóa tất cả logs?')) {
            try {
                await this.apiCall('/logs', 'DELETE');
                document.getElementById('logs-content').innerHTML = '';
                this.addLog('info', 'Logs đã được xóa');
            } catch (error) {
                this.addLog('error', `Không thể xóa logs: ${error.message}`);
            }
        }
    }

    async exportLogs() {
        try {
            const logs = await this.apiCall('/logs/export');
            const blob = new Blob([logs.data], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `email-automation-logs-${new Date().toISOString().split('T')[0]}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            window.URL.revokeObjectURL(url);
            this.addLog('info', 'Logs đã được xuất thành công');
            
        } catch (error) {
            this.addLog('error', `Không thể xuất logs: ${error.message}`);
        }
    }

    startLogPolling() {
        // Poll for new logs every 30 seconds
        setInterval(async () => {
            try {
                const logs = await this.apiCall('/logs/recent');
                logs.forEach(log => {
                    if (log.timestamp > this.lastLogTimestamp) {
                        this.addLog(log.level, log.message);
                    }
                });
                
                if (logs.length > 0) {
                    this.lastLogTimestamp = logs[0].timestamp;
                }
            } catch (error) {
                // Ignore polling errors to avoid spam
                console.error('Log polling failed:', error);
            }
        }, 30000);
    }

    // Auto-refresh stats every minute
    startStatsPolling() {
        setInterval(() => {
            this.loadStats();
        }, 60000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.emailApp = new EmailAutomationApp();
    
    // Start periodic updates
    setInterval(() => {
        window.emailApp.checkSystemStatus();
    }, 30000); // Check status every 30 seconds
    
    setInterval(() => {
        window.emailApp.loadStats();
    }, 60000); // Update stats every minute
});

// Handle page visibility changes to pause/resume updates
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Page hidden - pausing updates');
    } else {
        console.log('Page visible - resuming updates');
        if (window.emailApp) {
            window.emailApp.checkSystemStatus();
            window.emailApp.loadStats();
        }
    }
});

// Global error handling
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    if (window.emailApp) {
        window.emailApp.addLog('error', `Lỗi hệ thống: ${event.reason.message || event.reason}`);
    }
});

// Service Worker registration for PWA-like behavior (optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then((registration) => {
                console.log('SW registered: ', registration);
            })
            .catch((registrationError) => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}