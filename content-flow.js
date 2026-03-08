/**
 * Content Script — ClawScrap
 * Automates Google Flow (labs.google/fx) to:
 * 1. Focus and clear the text field (background types via CDP)
 * 2. Click the Generate button
 * 3. Wait for image(s) to appear
 * 4. Capture the image(s) and send back to background script
 */

// Remove old listener if re-injected
if (window.__flowBridgeListener) {
    chrome.runtime.onMessage.removeListener(window.__flowBridgeListener);
    console.log('[ClawScrap Content] Removed old listener, re-injecting...');
}

console.log('[ClawScrap Content] Content script loaded on:', window.location.href);

// ============================================
// Message Listener
// ============================================

window.__flowBridgeListener = function (msg, _sender, sendResponse) {
    if (msg.type === 'focus_textbox') {
        console.log('[ClawScrap Content] Received: focus_textbox');
        handleFocusTextbox()
            .then(() => sendResponse({ success: true }))
            .catch(err => {
                console.error('[ClawScrap Content] ❌ focus_textbox error:', err.message);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    if (msg.type === 'click_and_capture') {
        console.log('[ClawScrap Content] Received: click_and_capture');
        handleClickAndCapture(msg.payload)
            .then(result => {
                console.log('[ClawScrap Content] ✅ Image capture complete');
                sendResponse({ success: true, ...result });
            })
            .catch(err => {
                console.error('[ClawScrap Content] ❌ click_and_capture error:', err.message);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    return false;
};

chrome.runtime.onMessage.addListener(window.__flowBridgeListener);

// ============================================
// Step 1: Focus & Clear Textbox
// ============================================

async function handleFocusTextbox() {
    const textbox = await waitForElement('div[role="textbox"][contenteditable="true"]', 10000);

    if (!textbox) {
        throw new Error('Could not find prompt input field after 10s');
    }

    // Focus the textbox
    textbox.focus();
    textbox.click();
    await sleep(300);

    // Select all and delete existing content
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textbox);
    selection.removeAllRanges();
    selection.addRange(range);
    await sleep(100);

    // Delete selected content
    document.execCommand('delete', false, null);
    await sleep(200);

    console.log('[ClawScrap Content] ✅ Textbox focused and cleared');
}

// ============================================
// Step 3: Click Generate & Capture Images
// ============================================

async function handleClickAndCapture(payload) {
    const { count } = payload;

    // Click the Generate button
    await clickGenerate();

    // Wait for image(s) to appear
    const images = await waitForImages(count || 1);

    // Convert images to base64
    const imageBase64 = await imageToBase64(images[0]);
    const imageUrls = images.map(img => img.src).filter(Boolean);

    return { imageBase64, imageUrls };
}



// ============================================
// Step 2: Click Generate Button
// ============================================

async function clickGenerate() {
    // The generate button contains an icon with text "arrow_forward"
    let generateBtn = null;

    // Strategy 1: Find button whose innerHTML contains 'arrow_forward'
    const allButtons = [...document.querySelectorAll('button')];
    console.log(`[ClawScrap Content] Found ${allButtons.length} buttons on page`);

    for (const btn of allButtons) {
        if (btn.innerHTML.includes('arrow_forward')) {
            generateBtn = btn;
            console.log('[ClawScrap Content] Found Generate button via innerHTML arrow_forward');
            break;
        }
    }

    // Strategy 2: Find by text content
    if (!generateBtn) {
        for (const btn of allButtons) {
            const text = btn.textContent.trim();
            if (text.includes('arrow_forward') && text.includes('Tạo')) {
                generateBtn = btn;
                console.log('[ClawScrap Content] Found Generate button via textContent');
                break;
            }
        }
    }

    // Strategy 3: Find by class pattern
    if (!generateBtn) {
        generateBtn = document.querySelector('button[class*="sc-21faa80e-4"]');
        if (generateBtn) {
            console.log('[ClawScrap Content] Found Generate button via class sc-21faa80e-4');
        }
    }

    // Strategy 4: Find by aria-label
    if (!generateBtn) {
        generateBtn = document.querySelector('button[aria-label*="Generate"]') ||
            document.querySelector('button[aria-label*="Tạo"]') ||
            document.querySelector('button[title*="Generate"]');
        if (generateBtn) {
            console.log('[ClawScrap Content] Found Generate button via aria-label');
        }
    }

    if (!generateBtn) {
        // Debug: list all buttons
        allButtons.forEach((btn, i) => {
            console.log(`[ClawScrap Content] Button ${i}: text="${btn.textContent.trim().substring(0, 30)}" class="${btn.className.substring(0, 50)}" disabled=${btn.disabled}`);
        });
        throw new Error('Could not find Generate button');
    }

    console.log(`[ClawScrap Content] Generate button: text="${generateBtn.textContent.trim()}" disabled=${generateBtn.disabled}`);

    // Check if button is disabled
    if (generateBtn.disabled) {
        // Wait a bit and retry — Slate.js may need time to register the text
        console.log('[ClawScrap Content] Button disabled, waiting 2s for Slate to register text...');
        await sleep(2000);
        if (generateBtn.disabled) {
            throw new Error('Generate button is disabled — prompt may be empty or credits exhausted');
        }
    }

    // Click with multiple strategies to ensure it works
    // Strategy A: Native click
    generateBtn.click();
    console.log('[ClawScrap Content] Clicked Generate button (native click)');

    // Strategy B: Dispatch full mouse event sequence (in case React needs it)
    await sleep(200);
    const rect = generateBtn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const mouseEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const eventType of mouseEvents) {
        const EventClass = eventType.startsWith('pointer') ? PointerEvent : MouseEvent;
        generateBtn.dispatchEvent(new EventClass(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
        }));
    }
    console.log('[ClawScrap Content] Dispatched full mouse event sequence on Generate button');
}

// ============================================
// Step 3: Wait for Images
// ============================================

async function waitForImages(expectedCount) {
    const TIMEOUT = 120000;  // 2 minutes max wait
    const CHECK_INTERVAL = 2000;

    console.log(`[ClawScrap Content] Waiting for ${expectedCount} image(s)...`);

    // Take a snapshot of existing images before generation
    const existingImages = new Set(
        [...document.querySelectorAll('img')]
            .map(img => img.src)
            .filter(src => src && !src.startsWith('data:image/svg'))
    );

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let resolved = false;

        // Use MutationObserver to watch for new images
        const observer = new MutationObserver(() => {
            if (resolved) return;
            const newImages = findNewImages(existingImages);
            if (newImages.length >= expectedCount) {
                resolved = true;
                observer.disconnect();
                clearInterval(fallbackCheck);
                console.log(`[ClawScrap Content] Found ${newImages.length} new image(s)`);
                resolve(newImages);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'style', 'class'],
        });

        // Fallback polling in case MutationObserver misses something
        const fallbackCheck = setInterval(() => {
            if (resolved) {
                clearInterval(fallbackCheck);
                return;
            }

            if (Date.now() - startTime > TIMEOUT) {
                resolved = true;
                observer.disconnect();
                clearInterval(fallbackCheck);

                // Check one last time — maybe we got some images
                const lastChance = findNewImages(existingImages);
                if (lastChance.length > 0) {
                    resolve(lastChance);
                } else {
                    reject(new Error(`Timeout: No images found after ${TIMEOUT / 1000}s`));
                }
                return;
            }

            const newImages = findNewImages(existingImages);
            if (newImages.length >= expectedCount) {
                resolved = true;
                observer.disconnect();
                clearInterval(fallbackCheck);
                console.log(`[ClawScrap Content] Found ${newImages.length} new image(s) (via polling)`);
                resolve(newImages);
            }
        }, CHECK_INTERVAL);
    });
}

function findNewImages(existingImages) {
    const allImgs = document.querySelectorAll('img');
    const newImages = [];

    for (const img of allImgs) {
        // Skip tiny images (icons, avatars), SVGs, and existing images
        if (!img.src || img.src.startsWith('data:image/svg')) continue;
        if (existingImages.has(img.src)) continue;

        // Check if image has reasonable dimensions (not an icon)
        const rect = img.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
            newImages.push(img);
        }
    }

    return newImages;
}

// ============================================
// Step 4: Convert Image to Base64
// ============================================

async function imageToBase64(imgElement) {
    const src = imgElement.src;

    if (!src) throw new Error('Image has no src');

    // If it's already base64
    if (src.startsWith('data:image/')) {
        return src;
    }

    try {
        // Try fetch (works if same-origin or CORS allowed)
        const response = await fetch(src);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.log('[ClawScrap Content] Fetch failed, trying canvas approach...');

        // Fallback: use canvas to capture
        try {
            const canvas = document.createElement('canvas');
            canvas.width = imgElement.naturalWidth || imgElement.width;
            canvas.height = imgElement.naturalHeight || imgElement.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgElement, 0, 0);
            return canvas.toDataURL('image/png');
        } catch (canvasErr) {
            // Last resort: ask background to fetch via extension context
            console.log('[ClawScrap Content] Canvas also failed (CORS). Returning URL only.');
            return null;
        }
    }
}

// ============================================
// Helpers
// ============================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForElement(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const el = document.querySelector(selector);
        if (el) {
            console.log(`[ClawScrap Content] Found element: ${selector} (after ${Date.now() - start}ms)`);
            return el;
        }
        await sleep(500);
    }
    console.error(`[ClawScrap Content] Element not found after ${timeout}ms: ${selector}`);
    return null;
}

console.log('[ClawScrap Content] Ready to receive commands');
