/**
 * Content Script — ClawScrap X/Twitter Plugin
 * Automates posting tweets on X.com / Twitter.com.
 * Adapted from ClawPost.
 */

// Remove old listener if re-injected
if (window.__clawscrap_x_listener) {
    chrome.runtime.onMessage.removeListener(window.__clawscrap_x_listener);
    console.log('[ClawScrap X] Removed old listener, re-injecting...');
}

console.log('[ClawScrap X] Content script loaded on:', window.location.href);

// ============================================
// Message Listener
// ============================================

window.__clawscrap_x_listener = function (message, _sender, sendResponse) {
    if (message.type === 'post_tweet') {
        console.log('[ClawScrap X] Received post_tweet command');
        postTweet(message.text, message.mediaUrls || [])
            .then(result => {
                sendResponse({ success: true, ...result });
            })
            .catch(error => {
                console.error('[ClawScrap X] ❌ Error:', error.message);
                sendResponse({ success: false, error: error.message });
            });
        return true; // async
    }
    return false;
};

chrome.runtime.onMessage.addListener(window.__clawscrap_x_listener);

// ============================================
// Tweet Posting Logic
// ============================================

async function postTweet(text, mediaUrls) {
    console.log('[ClawScrap X] Posting tweet:', text.substring(0, 50) + '...');
    if (mediaUrls && mediaUrls.length > 0) {
        console.log('[ClawScrap X] With media:', mediaUrls);
    }

    // Step 1: Open composer
    const composed = await openComposer();
    if (!composed) {
        throw new Error('Failed to open tweet composer');
    }

    // Step 2: Wait for the editor to be ready
    await waitFor(1000);

    // Step 3: Upload images if provided (do this BEFORE typing text)
    if (mediaUrls && mediaUrls.length > 0) {
        const uploaded = await uploadMedia(mediaUrls);
        if (!uploaded) {
            console.warn('[ClawScrap X] Media upload may have failed, continuing with text...');
        }
        await waitFor(2000);
    }

    // Step 4: Type the tweet text
    const typed = await typeText(text);
    if (!typed) {
        throw new Error('Failed to type tweet text');
    }

    // Step 5: Wait a moment for X to process
    await waitFor(1500);

    // Step 6: Click the Post button
    const posted = await clickPostButton();
    if (!posted) {
        throw new Error('Failed to click Post button');
    }

    // Step 7: Wait for tweet to be sent
    await waitFor(3000);

    console.log('[ClawScrap X] ✅ Tweet posted successfully!');
    return { message: 'Tweet posted successfully' };
}

// ============================================
// Open Composer
// ============================================

async function openComposer() {
    const composeButton = document.querySelector(
        'a[href="/compose/tweet"], ' +
        'a[data-testid="SideNav_NewTweet_Button"], ' +
        '[data-testid="tweetButtonInline"], ' +
        'a[aria-label="Post"]'
    );

    if (composeButton) {
        composeButton.click();
        await waitFor(1500);
        return true;
    }

    if (window.location.pathname.includes('/compose/tweet')) {
        return true;
    }

    window.location.href = 'https://x.com/compose/tweet';
    await waitFor(3000);
    return true;
}

// ============================================
// Media Upload
// ============================================

async function uploadMedia(mediaUrls) {
    try {
        const files = [];
        for (let i = 0; i < mediaUrls.length; i++) {
            const url = mediaUrls[i];
            console.log(`[ClawScrap X] Downloading image ${i + 1}/${mediaUrls.length}: ${url}`);
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                const extension = getExtensionFromMime(blob.type);
                const fileName = `image_${i + 1}.${extension}`;
                const file = new File([blob], fileName, { type: blob.type });
                files.push(file);
                console.log(`[ClawScrap X] Downloaded: ${fileName} (${blob.size} bytes, ${blob.type})`);
            } catch (err) {
                console.error(`[ClawScrap X] Failed to download image: ${url}`, err.message);
            }
        }

        if (files.length === 0) {
            console.error('[ClawScrap X] No images downloaded successfully');
            return false;
        }

        // Find the file input element on X.com
        let fileInput = document.querySelector('input[data-testid="fileInput"]');
        if (!fileInput) {
            fileInput = document.querySelector('input[type="file"][accept*="image"]');
        }
        if (!fileInput) {
            const allInputs = document.querySelectorAll('input[type="file"]');
            for (const input of allInputs) {
                const accept = input.getAttribute('accept') || '';
                if (accept.includes('image') || accept.includes('video') || accept.includes('*')) {
                    fileInput = input;
                    break;
                }
            }
        }

        if (!fileInput) {
            console.error('[ClawScrap X] Could not find file input for media upload');
            return false;
        }

        const dataTransfer = new DataTransfer();
        for (const file of files) {
            dataTransfer.items.add(file);
        }

        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

        console.log(`[ClawScrap X] ✅ Attached ${files.length} image(s)`);
        await waitFor(3000);
        return true;

    } catch (error) {
        console.error('[ClawScrap X] Media upload error:', error.message);
        return false;
    }
}

function getExtensionFromMime(mimeType) {
    const map = {
        'image/jpeg': 'jpg', 'image/jpg': 'jpg',
        'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    };
    return map[mimeType] || 'png';
}

// ============================================
// Type Text
// ============================================

async function typeText(text) {
    const editorSelectors = [
        '[data-testid="tweetTextarea_0"] [contenteditable="true"]',
        '[data-testid="tweetTextarea_0"]',
        '.DraftEditor-root [contenteditable="true"]',
        '[role="textbox"][data-testid="tweetTextarea_0"]',
        '[role="textbox"]',
        '.public-DraftEditor-content',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
    ];

    let editor = null;
    for (const selector of editorSelectors) {
        editor = document.querySelector(selector);
        if (editor) {
            console.log('[ClawScrap X] Found editor with selector:', selector);
            break;
        }
    }

    if (!editor) {
        await waitFor(2000);
        for (const selector of editorSelectors) {
            editor = document.querySelector(selector);
            if (editor) break;
        }
    }

    if (!editor) {
        console.error('[ClawScrap X] Could not find tweet editor');
        return false;
    }

    editor.focus();
    await waitFor(300);

    document.execCommand('insertText', false, text);

    if (!editor.textContent || editor.textContent.trim().length === 0) {
        console.log('[ClawScrap X] execCommand failed, trying clipboard paste...');
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        editor.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true, cancelable: true, clipboardData,
        }));
        await waitFor(500);
    }

    if (editor.textContent && editor.textContent.trim().length > 0) {
        console.log('[ClawScrap X] ✅ Text entered successfully');
        return true;
    }

    // Keyboard simulation fallback
    console.log('[ClawScrap X] Trying keyboard simulation...');
    for (const char of text) {
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        editor.dispatchEvent(new InputEvent('input', {
            data: char, inputType: 'insertText', bubbles: true, cancelable: true,
        }));
        editor.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        await waitFor(10);
    }

    await waitFor(500);
    return editor.textContent && editor.textContent.trim().length > 0;
}

// ============================================
// Click Post Button
// ============================================

async function clickPostButton() {
    const buttonSelectors = [
        '[data-testid="tweetButton"]',
        '[data-testid="tweetButtonInline"]',
        'button[data-testid="tweetButton"]',
        'div[data-testid="tweetButton"]',
    ];

    for (const selector of buttonSelectors) {
        const button = document.querySelector(selector);
        if (button) {
            console.log('[ClawScrap X] Found Post button:', selector);

            const isDisabled = button.getAttribute('aria-disabled') === 'true' ||
                button.disabled || button.classList.contains('r-icorat');
            if (isDisabled) {
                console.log('[ClawScrap X] Post button is disabled, waiting...');
                await waitFor(2000);
            }

            button.click();
            console.log('[ClawScrap X] ✅ Clicked Post button');
            return true;
        }
    }

    console.error('[ClawScrap X] Could not find Post button');
    return false;
}

// ============================================
// Helpers
// ============================================

function waitFor(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('[ClawScrap X] Ready to receive commands');
