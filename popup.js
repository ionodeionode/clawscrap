/**
 * Popup Script — ClawScrap
 * Connects to ClawBridge server for browser automation.
 */

const $ = (sel) => document.querySelector(sel);

// Elements
const statusDot = $('#statusDot');
const statusText = $('#statusText');
const serverUrlInput = $('#serverUrl');
const apiKeyInput = $('#apiKey');
const btnStart = $('#btnStart');
const btnStop = $('#btnStop');
const infoBridge = $('#infoBridge');
const infoPolling = $('#infoPolling');
const infoProcessing = $('#infoProcessing');
const infoServer = $('#infoServer');

// Track if user is editing fields
let isEditingUrl = false;
let isEditingKey = false;

serverUrlInput.addEventListener('focus', () => { isEditingUrl = true; });
serverUrlInput.addEventListener('blur', () => { isEditingUrl = false; });
apiKeyInput.addEventListener('focus', () => { isEditingKey = true; });
apiKeyInput.addEventListener('blur', () => { isEditingKey = false; });

// ============================================
// Load Status
// ============================================

function refreshStatus() {
    chrome.runtime.sendMessage({ type: 'get_status' }, (resp) => {
        if (!resp) return;

        // Only update inputs if user is NOT actively editing
        if (!isEditingUrl) {
            serverUrlInput.value = resp.serverUrl || 'http://localhost:3002';
        }
        if (!isEditingKey) {
            apiKeyInput.value = resp.apiKey || '';
        }

        // Status indicator
        if (resp.isProcessing) {
            statusDot.className = 'status-dot processing';
            statusText.textContent = '⚡ Processing job...';
        } else if (resp.isConnected && resp.isPolling) {
            statusDot.className = 'status-dot active';
            statusText.textContent = '🟢 Connected — Polling for jobs';
        } else if (resp.isPolling && !resp.isConnected) {
            statusDot.className = 'status-dot connecting';
            statusText.textContent = '🔄 Connecting to bridge...';
        } else {
            statusDot.className = 'status-dot';
            statusText.textContent = '⏸ Disconnected';
        }

        // Info box
        infoBridge.textContent = resp.isConnected ? 'Connected' : 'Disconnected';
        infoBridge.className = `info-value ${resp.isConnected ? 'connected' : 'disconnected'}`;
        infoPolling.textContent = resp.isPolling ? 'Active' : 'Stopped';
        infoProcessing.textContent = resp.isProcessing ? 'Yes' : 'No';
        infoServer.textContent = resp.serverUrl || '—';
    });
}

// ============================================
// Actions
// ============================================

btnStart.addEventListener('click', () => {
    const url = serverUrlInput.value.trim();
    const key = apiKeyInput.value.trim();

    if (url) {
        chrome.runtime.sendMessage({ type: 'set_server_url', url }, () => {
            chrome.runtime.sendMessage({ type: 'set_api_key', key }, () => {
                chrome.runtime.sendMessage({ type: 'start_polling' }, () => {
                    isEditingUrl = false;
                    isEditingKey = false;
                    refreshStatus();
                });
            });
        });
    }
});

btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'stop_polling' }, () => {
        refreshStatus();
    });
});

// Save on field change
serverUrlInput.addEventListener('change', () => {
    const url = serverUrlInput.value.trim();
    if (url) {
        chrome.runtime.sendMessage({ type: 'set_server_url', url }, () => {
            refreshStatus();
        });
    }
});

apiKeyInput.addEventListener('change', () => {
    const key = apiKeyInput.value.trim();
    chrome.runtime.sendMessage({ type: 'set_api_key', key }, () => {
        refreshStatus();
    });
});

// ============================================
// Init
// ============================================

refreshStatus();
setInterval(refreshStatus, 3000);
