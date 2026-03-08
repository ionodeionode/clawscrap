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
    'reply_facebook_comment': {
        urlPatterns: ['https://www.facebook.com/*'],
        contentScript: 'content-facebook.js',
        label: '💬 Reply on Facebook',
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

// Load saved config and start on boot
chrome.storage.local.get(['serverUrl', 'apiKey'], (result) => {
    if (result.serverUrl) serverUrl = result.serverUrl;
    if (result.apiKey) apiKey = result.apiKey;
    connectAndStartPolling();
});

// ============================================
// Keep-Alive via Chrome Alarms (MV3 fix)
// Service workers get suspended after ~30s idle.
// Alarm wakes it up every 25s to keep polling alive.
// ============================================

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 }); // every ~24s

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        // Re-read config in case it changed
        chrome.storage.local.get(['serverUrl', 'apiKey'], (result) => {
            if (result.serverUrl) serverUrl = result.serverUrl;
            if (result.apiKey) apiKey = result.apiKey;
        });
        // Restart polling if it died
        if (!pollingInterval) {
            console.log('[ClawScrap BG] ⏰ Alarm: restarting polling...');
            connectAndStartPolling();
        }
    }
});

// Also restart polling when Chrome starts or extension is installed
chrome.runtime.onStartup.addListener(() => {
    console.log('[ClawScrap BG] 🚀 Chrome started — connecting to bridge...');
    chrome.storage.local.get(['serverUrl', 'apiKey'], (result) => {
        if (result.serverUrl) serverUrl = result.serverUrl;
        if (result.apiKey) apiKey = result.apiKey;
        connectAndStartPolling();
    });
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('[ClawScrap BG] 🔌 Extension installed — connecting to bridge...');
    chrome.storage.local.get(['serverUrl', 'apiKey'], (result) => {
        if (result.serverUrl) serverUrl = result.serverUrl;
        if (result.apiKey) apiKey = result.apiKey;
        connectAndStartPolling();
    });
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
        setIcon('working'); // orange icon while processing

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
        setIcon('idle'); // back to normal crab icon
    }
}

function setIcon(state) {
    const paths = state === 'working'
        ? { 16: 'icons/icon_working_16.png', 48: 'icons/icon_working_48.png', 128: 'icons/icon_working_128.png' }
        : { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };
    chrome.action.setIcon({ path: paths });
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
    } else if (job.type === 'reply_facebook_comment') {
        return await handleReplyFacebookComment(tab.id, job);
    }

    throw new Error(`No handler for job type: ${job.type}`);
}

// ============================================
// Flow Generate Handler
// ============================================

async function handleFlowGenerate(tabId, job) {
    const { prompt, count } = job.payload;
    const debugTarget = { tabId };

    // Step 1: Focus + clear textbox (content script)
    console.log('[ClawScrap BG] Flow: Focus + clear textbox');
    await sendMessageWithRetry(tabId, { type: 'focus_textbox' }, 3);
    await randomDelay(500, 1000);

    // Step 2: Type prompt via CDP char-by-char (keeps debugger attached)
    console.log('[ClawScrap BG] Flow: Type prompt via CDP');
    try {
        await chrome.debugger.attach(debugTarget, '1.3');
        console.log('[ClawScrap BG] Debugger attached');

        for (let i = 0; i < prompt.length; i++) {
            const char = prompt[i];
            await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                type: 'keyDown', key: char, text: char, unmodifiedText: char,
            });
            await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                type: 'char', key: char, text: char, unmodifiedText: char,
            });
            await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                type: 'keyUp', key: char, text: char, unmodifiedText: char,
            });
            if (i % 5 === 0) await sleep(20 + Math.random() * 30);
        }
        console.log(`[ClawScrap BG] ✅ Typed ${prompt.length} chars`);

        // Step 3: Human-like pause before clicking Generate
        await randomDelay(1500, 3000);

        // Step 4: Get Generate button coordinates from content script
        const coords = await sendMessageWithRetry(tabId, { type: 'get_generate_coords' }, 3);
        if (!coords || !coords.x) throw new Error('Could not get Generate button coordinates');
        console.log(`[ClawScrap BG] Generate button at (${coords.x}, ${coords.y})`);

        // Step 5: Click Generate via CDP (isTrusted = true!)
        await cdpMouseClick(debugTarget, coords.x, coords.y);
        console.log('[ClawScrap BG] ✅ Generate clicked via CDP');
        await sleep(500);

    } finally {
        try {
            await chrome.debugger.detach(debugTarget);
            console.log('[ClawScrap BG] Debugger detached');
        } catch (e) { /* ignore */ }
    }

    // Step 6: Content script just waits for images (Generate already clicked)
    console.log('[ClawScrap BG] Flow: Waiting for images...');
    return sendMessageWithRetry(tabId, {
        type: 'click_and_capture',
        payload: { jobId: job.id, count: count || 1, clickViaCDP: true },
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
// Reply Facebook Comment Handler
// ============================================

async function handleReplyFacebookComment(tabId, job) {
    const { postUrl, text, commentId } = job.payload;
    const debugTarget = { tabId };

    console.log('[ClawScrap BG] Facebook Reply: Navigating to', postUrl);
    await navigateTabAndWait(tabId, postUrl);
    await sleep(3000);

    await injectContentScript(tabId, 'content-facebook.js');
    await sleep(1000);

    // Step 1: Content script finds coordinates of the comment button/editor
    console.log('[ClawScrap BG] Facebook Reply: Finding comment input coords...');
    const coordsResp = await sendMessageWithRetry(tabId, {
        type: 'reply_facebook_comment',
        commentId: commentId || null,
    }, 3);

    if (!coordsResp || !coordsResp.x) {
        throw new Error('Could not get comment element coordinates from content script');
    }

    const { x, y, type: elemType } = coordsResp;
    console.log(`[ClawScrap BG] Got coords: (${x}, ${y}) type=${elemType}`);

    // Step 2: Attach CDP and do ALL clicks/typing via CDP (isTrusted = true)
    try {
        await chrome.debugger.attach(debugTarget, '1.3');
        console.log('[ClawScrap BG] 🔌 Debugger attached for reply');

        // CDP click on the comment button/editor
        await cdpMouseClick(debugTarget, x, y);
        await sleep(800);

        // If it was a button (not the editor itself), get editor coords after click
        if (elemType !== 'editor') {
            await injectContentScript(tabId, 'content-facebook.js');
            const editorResp = await sendMessageWithRetry(tabId, {
                type: 'get_comment_editor_coords'
            }, 3);
            if (editorResp?.x) {
                await cdpMouseClick(debugTarget, editorResp.x, editorResp.y);
                await sleep(500);
            }
        }

        // CDP type the text (isTrusted = true, focused element receives it)
        await chrome.debugger.sendCommand(debugTarget, 'Input.insertText', { text });
        console.log(`[ClawScrap BG] ✅ CDP typed ${text.length} chars`);
        await sleep(600);

        // CDP press Enter to submit (isTrusted = true)
        await cdpPressEnter(debugTarget);
        console.log('[ClawScrap BG] ✅ CDP Enter pressed — comment submitted');
        await sleep(1500);

    } finally {
        try {
            await chrome.debugger.detach(debugTarget);
            console.log('[ClawScrap BG] 🔌 Debugger detached');
        } catch (e) { /* ignore */ }
    }

    return { success: true, message: 'Reply posted on Facebook successfully via CDP' };
}

// CDP mouse click at viewport coordinates
async function cdpMouseClick(debugTarget, x, y) {
    const params = { x, y, button: 'left', clickCount: 1, modifiers: 0 };
    await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchMouseEvent', { ...params, type: 'mousePressed' });
    await sleep(80);
    await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchMouseEvent', { ...params, type: 'mouseReleased' });
    console.log(`[ClawScrap BG] CDP click at (${x}, ${y})`);
}

// CDP Enter key press
async function cdpPressEnter(debugTarget) {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', { ...key, type: 'keyDown' });
    await sleep(50);
    await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', { ...key, type: 'keyUp' });
}

// Navigate a tab to a URL and wait for it to finish loading
function navigateTabAndWait(tabId, url) {
    return new Promise((resolve, reject) => {
        chrome.tabs.update(tabId, { url }, () => {
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }
            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            // Safety timeout
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }, 15000);
        });
    });
}


// ============================================
// CDP Text Input (Trusted Events)
// ============================================

async function typeTextViaCDP(tabId, text) {
    const debugTarget = { tabId };

    try {
        await chrome.debugger.attach(debugTarget, '1.3');
        console.log('[ClawScrap BG] Debugger attached');

        // Type each character individually via keyboard events
        // This triggers React's synthetic event system (unlike insertText which doesn't)
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            // keyDown
            await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                type: 'keyDown',
                key: char,
                text: char,
                unmodifiedText: char,
            });
            // char event (actual text input)
            await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                type: 'char',
                key: char,
                text: char,
                unmodifiedText: char,
            });
            // keyUp
            await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: char,
                text: char,
                unmodifiedText: char,
            });

            // Small random delay between chars for human-like typing
            if (i % 5 === 0) await sleep(20 + Math.random() * 30);
        }

        console.log(`[ClawScrap BG] ✅ CDP typed ${text.length} chars (char-by-char)`);
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
