/**
 * Background Service Worker — ClawScrap
 * Plugin-based browser automation. Connects to ClawBridge server,
 * registers supported job types, and routes jobs to content scripts.
 */

// ============================================
// Plugin Registry
// ============================================

const PLUGINS = {
    'flow_generate': {
        urlPatterns: ['https://labs.google/fx/*', 'https://labs.google/flow/*'],
        contentScript: 'content-flow.js',
        label: '🎨 Flow Image Gen',
        useCDP: true,
    },
    'post_x': {
        urlPatterns: ['https://x.com/*', 'https://twitter.com/*'],
        contentScript: 'content-x.js',
        label: '🐦 Post to X',
        useCDP: false,
    },
    'post_facebook': {
        urlPatterns: ['https://www.facebook.com/*'],
        contentScript: 'content-facebook.js',
        label: '📘 Post to Facebook',
        useCDP: false,
    },
};

// Job types this extension handles
const HANDLED_TYPES = Object.keys(PLUGINS);

// ============================================
// Configuration
// ============================================

let serverUrl = 'http://localhost:3002';
let apiKey = '';
let extensionId = null;     // assigned by bridge after connect
let pollingInterval = null;
let isProcessing = false;
const POLL_INTERVAL_MS = 3000;

// Auth headers helper
function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
}

// Load saved config
chrome.storage.local.get(['serverUrl', 'apiKey'], (result) => {
    if (result.serverUrl) serverUrl = result.serverUrl;
    if (result.apiKey) apiKey = result.apiKey;
    connectAndStartPolling();
});

// ============================================
// Bridge Connection
// ============================================

async function connectToBridge() {
    try {
        const response = await fetch(`${serverUrl}/api/extensions/connect`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                name: 'ClawScrap',
                types: HANDLED_TYPES,
            }),
        });

        const data = await response.json();

        if (!data.success) {
            console.error(`[ClawScrap BG] ❌ Bridge rejected connection: ${data.error}`);
            extensionId = null;
            return false;
        }

        extensionId = data.extensionId;
        console.log(`[ClawScrap BG] ✅ Connected to bridge as "${data.name}" (${extensionId.substring(0, 8)}...) — types: [${data.acceptedTypes.join(', ')}]`);
        return true;

    } catch (err) {
        console.error(`[ClawScrap BG] ❌ Cannot reach bridge at ${serverUrl}: ${err.message}`);
        extensionId = null;
        return false;
    }
}

async function connectAndStartPolling() {
    const connected = await connectToBridge();
    if (connected) {
        startPolling();
    } else {
        // Retry connection every POLL_INTERVAL
        console.log('[ClawScrap BG] Will retry connection...');
        startPolling(); // polling will attempt reconnect if extensionId is null
    }
}

// ============================================
// Polling
// ============================================

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    console.log(`[ClawScrap BG] Polling every ${POLL_INTERVAL_MS / 1000}s → ${serverUrl}`);

    pollingInterval = setInterval(async () => {
        if (isProcessing) return;

        // If not connected, try to reconnect
        if (!extensionId) {
            await connectToBridge();
            if (!extensionId) return; // still not connected
        }

        try {
            const response = await fetch(
                `${serverUrl}/api/jobs/pending?extensionId=${extensionId}`,
                { headers: authHeaders() }
            );
            const data = await response.json();

            if (!data.success) {
                // Extension not recognized — reconnect
                if (response.status === 401) {
                    console.log('[ClawScrap BG] Extension not recognized, reconnecting...');
                    extensionId = null;
                    await connectToBridge();
                    return;
                }
                console.error(`[ClawScrap BG] Server error: ${data.error}`);
                return;
            }

            if (data.job) {
                const label = data.job.prompt || data.job.text || '';
                console.log(`[ClawScrap BG] 📬 Got ${data.job.type} job: ${data.job.id.substring(0, 8)}... — "${label.substring(0, 40)}"`);
                await processJob(data.job);
            }
        } catch (err) {
            // Server unreachable — silently retry
        }
    }, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    extensionId = null;
    console.log('[ClawScrap BG] Polling stopped, disconnected from bridge');
}

// ============================================
// Job Processing — Plugin Router
// ============================================

async function processJob(job) {
    try {
        isProcessing = true;
        const plugin = PLUGINS[job.type];

        if (!plugin) {
            throw new Error(`Unknown job type: ${job.type}. Supported: ${HANDLED_TYPES.join(', ')}`);
        }

        console.log(`[ClawScrap BG] ${plugin.label} — Processing job: ${job.id.substring(0, 8)}...`);

        const result = await routeToPlugin(job, plugin);

        await reportJobResult(job.id, 'completed', result);
        console.log(`[ClawScrap BG] ✅ Job completed: ${job.id.substring(0, 8)}...`);

    } catch (error) {
        console.error(`[ClawScrap BG] ❌ Job failed: ${error.message}`);
        await reportJobResult(job.id, 'failed', null, error.message);
    } finally {
        isProcessing = false;
    }
}

async function routeToPlugin(job, plugin) {
    // Find matching tab
    let tabs = [];
    for (const pattern of plugin.urlPatterns) {
        const found = await chrome.tabs.query({ url: pattern });
        tabs.push(...found);
    }

    if (tabs.length === 0) {
        throw new Error(`No matching tab found for ${plugin.label}. Please open the website first.`);
    }

    const tab = tabs[0];
    console.log(`[ClawScrap BG] Routing to tab ${tab.id} (${tab.url?.substring(0, 50)})`);

    // Inject the plugin's content script
    await injectContentScript(tab.id, plugin.contentScript);
    await sleep(800);

    // Route based on job type
    if (job.type === 'flow_generate') {
        return await handleFlowGenerate(tab.id, job);
    } else if (job.type === 'post_x') {
        return await handlePostX(tab.id, job);
    } else if (job.type === 'post_facebook') {
        return await handlePostFacebook(tab.id, job);
    }

    throw new Error(`No handler for job type: ${job.type}`);
}

// ============================================
// Flow Generate Handler
// ============================================

async function handleFlowGenerate(tabId, job) {
    const { prompt, count } = job.payload;

    console.log('[ClawScrap BG] Flow: Focus + clear textbox');
    await sendMessageWithRetry(tabId, { type: 'focus_textbox' }, 3);
    await randomDelay(1000, 3000);

    console.log('[ClawScrap BG] Flow: Type prompt via CDP');
    await typeTextViaCDP(tabId, prompt);
    await randomDelay(2000, 5000);

    console.log('[ClawScrap BG] Flow: Click Generate + capture');
    return sendMessageWithRetry(tabId, {
        type: 'click_and_capture',
        payload: { jobId: job.id, count: count || 1 },
    }, 3);
}

// ============================================
// Post X Handler
// ============================================

async function handlePostX(tabId, job) {
    const { text, mediaUrls } = job.payload;

    console.log('[ClawScrap BG] X: Sending post_tweet command');
    return sendMessageWithRetry(tabId, {
        type: 'post_tweet',
        text,
        mediaUrls: mediaUrls || [],
    }, 3);
}

// ============================================
// Post Facebook Handler
// ============================================

async function handlePostFacebook(tabId, job) {
    const { text, mediaUrls, target } = job.payload;

    console.log('[ClawScrap BG] Facebook: Sending post_facebook command');
    return sendMessageWithRetry(tabId, {
        type: 'post_facebook',
        text,
        mediaUrls: mediaUrls || [],
        target: target || null,
    }, 3);
}

// ============================================
// CDP Text Input (Trusted Events)
// ============================================

async function typeTextViaCDP(tabId, text) {
    const debugTarget = { tabId };

    try {
        await chrome.debugger.attach(debugTarget, '1.3');
        console.log('[ClawScrap BG] Debugger attached');

        await chrome.debugger.sendCommand(debugTarget, 'Input.insertText', {
            text: text,
        });
        console.log(`[ClawScrap BG] CDP typed ${text.length} chars`);

        await sleep(300);
    } catch (err) {
        console.error('[ClawScrap BG] CDP error:', err.message);
        throw new Error(`CDP text input failed: ${err.message}`);
    } finally {
        try {
            await chrome.debugger.detach(debugTarget);
            console.log('[ClawScrap BG] Debugger detached');
        } catch (e) {
            // ignore detach errors
        }
    }
}

// ============================================
// Report Results
// ============================================

async function reportJobResult(jobId, status, result, error) {
    try {
        const body = { status };
        if (result) body.result = result;  // generic result object
        if (error) body.error = error;

        await fetch(`${serverUrl}/api/jobs/${jobId}`, {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify(body),
        });
    } catch (e) {
        console.error('[ClawScrap BG] Failed to report result:', e.message);
    }
}

// ============================================
// Content Script Injection
// ============================================

async function injectContentScript(tabId, scriptFile) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: [scriptFile],
        });
    } catch (err) {
        throw new Error(`Failed to inject ${scriptFile}: ${err.message}`);
    }
}

// ============================================
// Message Retry
// ============================================

async function sendMessageWithRetry(tabId, message, retries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tabId, message, (resp) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (resp && resp.success) {
                        resolve(resp);
                    } else {
                        reject(new Error(resp?.error || 'Content script failed'));
                    }
                });
            });
            return response;
        } catch (err) {
            console.log(`[ClawScrap BG] Attempt ${attempt}/${retries} failed: ${err.message}`);
            if (attempt < retries) {
                const scriptFile = message.type === 'post_tweet' ? 'content-x.js'
                    : message.type === 'post_facebook' ? 'content-facebook.js'
                        : 'content-flow.js';
                await injectContentScript(tabId, scriptFile);
                await sleep(1500);
            } else {
                throw err;
            }
        }
    }
}

// ============================================
// Helpers
// ============================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`[ClawScrap BG] ⏳ Random delay: ${(ms / 1000).toFixed(1)}s`);
    return sleep(ms);
}

// ============================================
// Popup Messages
// ============================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
        case 'get_status':
            sendResponse({
                isPolling: pollingInterval !== null,
                isProcessing,
                isConnected: extensionId !== null,
                extensionId,
                serverUrl,
                apiKey,
                plugins: HANDLED_TYPES,
            });
            break;

        case 'set_server_url':
            serverUrl = msg.url;
            chrome.storage.local.set({ serverUrl: msg.url });
            stopPolling();
            connectAndStartPolling();
            sendResponse({ ok: true });
            break;

        case 'set_api_key':
            apiKey = msg.key;
            chrome.storage.local.set({ apiKey: msg.key });
            sendResponse({ ok: true });
            break;

        case 'start_polling':
            connectAndStartPolling();
            sendResponse({ ok: true });
            break;

        case 'stop_polling':
            stopPolling();
            sendResponse({ ok: true });
            break;
    }
    return true;
});

console.log('[ClawScrap BG] Background loaded — Connecting to ClawBridge...');
