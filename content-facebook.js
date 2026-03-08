/**
 * Content Script — ClawScrap Facebook Plugin
 * Automates posting on Facebook.com.
 * Supports personal profile and page posts with media.
 * Adapted from ClawPost.
 */

// Remove old listener if re-injected
if (window.__clawscrap_fb_listener) {
    chrome.runtime.onMessage.removeListener(window.__clawscrap_fb_listener);
    console.log('[ClawScrap FB] Removed old listener, re-injecting...');
}

console.log('[ClawScrap FB] Content script loaded on:', window.location.href);

// ============================================
// Message Listener
// ============================================

window.__clawscrap_fb_listener = function (message, _sender, sendResponse) {
    if (message.type === 'post_facebook') {
        console.log('[ClawScrap FB] Received post_facebook command');
        postOnFacebook(message.text, message.mediaUrls || [], message.target)
            .then(result => {
                sendResponse({ success: true, ...result });
            })
            .catch(error => {
                console.error('[ClawScrap FB] ❌ Error:', error.message);
                sendResponse({ success: false, error: error.message });
            });
        return true; // async
    }
    return false;
};

chrome.runtime.onMessage.addListener(window.__clawscrap_fb_listener);

// ============================================
// Find Composer Dialog
// ============================================

function findComposerDialog() {
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    for (const d of dialogs) {
        const text = (d.textContent || '').substring(0, 500).toLowerCase();
        if (text.includes('create post') || text.includes('tạo bài viết') ||
            text.includes('post settings') || text.includes("what's on your mind") ||
            text.includes('add to your post') || text.includes('thêm vào bài viết')) {
            return d;
        }
    }
    return dialogs.length > 0 ? dialogs[dialogs.length - 1] : null;
}

// ============================================
// Dialog Cleanup
// ============================================

async function dismissExistingDialogs() {
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    if (dialogs.length === 0) return;

    console.log(`[ClawScrap FB] Found ${dialogs.length} existing dialog(s), attempting to dismiss...`);

    for (const dialog of dialogs) {
        const title = (dialog.textContent || '').substring(0, 100).toLowerCase();

        if (title.includes('create post') || title.includes('tạo bài viết')) {
            continue;
        }

        const dismissLabels = ['Not now', 'Not Now', 'Close', 'Dismiss', 'Cancel', 'Skip',
            'Không phải bây giờ', 'Đóng', 'Bỏ qua', 'Hủy'];
        let dismissed = false;

        const btns = dialog.querySelectorAll('div[role="button"], button, a[role="button"]');
        for (const btn of btns) {
            const btnText = (btn.textContent || '').trim();
            const ariaLabel = btn.getAttribute('aria-label') || '';

            for (const label of dismissLabels) {
                if (btnText === label || ariaLabel === label) {
                    console.log(`[ClawScrap FB] Dismissing dialog with: "${label}"`);
                    btn.click();
                    dismissed = true;
                    break;
                }
            }
            if (dismissed) break;
        }

        if (!dismissed) {
            const closeBtn = dialog.querySelector('[aria-label="Close"], [aria-label="Đóng"]');
            if (closeBtn) {
                closeBtn.click();
                dismissed = true;
            }
        }

        if (!dismissed) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }

        await waitFor(500);
    }
}

// ============================================
// Facebook Posting Logic
// ============================================

async function postOnFacebook(text, mediaUrls, target) {
    console.log('[ClawScrap FB] Posting on Facebook:', text.substring(0, 50) + '...');
    console.log('[ClawScrap FB] Target:', target || 'personal');

    // Step 0: Dismiss any existing dialogs
    await dismissExistingDialogs();
    await waitFor(1000);

    // Step 1: Navigate to page if targeting a page
    if (target && target.startsWith('page:')) {
        const pageName = target.replace('page:', '');
        await navigateToPage(pageName);
        await waitFor(3000);
    }

    // Step 2: Open the composer
    const composed = await openFBComposer();
    if (!composed) {
        throw new Error('Failed to open Facebook composer');
    }
    await waitFor(2000);

    // Step 3: Type the text
    const typed = await typeFBText(text);
    if (!typed) {
        throw new Error('Failed to type text in Facebook composer');
    }
    await waitFor(1500);

    // Step 4: Upload images if any
    if (mediaUrls && mediaUrls.length > 0) {
        await uploadFBMedia(mediaUrls);
        await waitFor(3000);
    }

    // Step 5: Click Post button
    await waitFor(1500);
    const posted = await clickFBPostButton();
    if (!posted) {
        throw new Error('Failed to click Facebook Post button');
    }

    // Step 6: Wait for post to complete
    await waitFor(4000);

    console.log('[ClawScrap FB] ✅ Posted on Facebook successfully!');
    return { message: 'Posted on Facebook successfully' };
}

// ============================================
// Navigate to a Facebook Page
// ============================================

async function navigateToPage(pageName) {
    if (window.location.pathname.includes(`/${pageName}`)) {
        console.log('[ClawScrap FB] Already on page:', pageName);
        return;
    }
    console.log('[ClawScrap FB] Navigating to page:', pageName);
    window.location.href = `https://www.facebook.com/${pageName}`;
    await waitFor(5000);
}

// ============================================
// Open Composer
// ============================================

async function openFBComposer() {
    const composerSelectors = [
        '[role="button"][tabindex="0"] span:not([class])',
        'div[role="button"][aria-label*="mind"]',
        'div[role="button"][aria-label*="Write"]',
        'div[data-pagelet="FeedComposer"] div[role="button"]',
        'div[aria-label="Create a post"] div[role="button"]',
        'div[class*="sjgh65i0"] div[role="button"]',
    ];

    // First try: look for "What's on your mind" text
    const allButtons = document.querySelectorAll('div[role="button"], span[role="button"]');
    for (const btn of allButtons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes("what's on your mind") ||
            text.includes("write something") ||
            text.includes("create a post") ||
            text.includes("what are you thinking") ||
            text.includes("bạn đang nghĩ gì")) {
            console.log('[ClawScrap FB] Found composer trigger by text');
            btn.click();
            await waitFor(2000);
            return true;
        }
    }

    // Second try: selectors
    for (const selector of composerSelectors) {
        const el = document.querySelector(selector);
        if (el) {
            el.click();
            await waitFor(2000);
            return true;
        }
    }

    // Third try: editor already visible
    const editor = findFBEditor();
    if (editor) {
        return true;
    }

    console.error('[ClawScrap FB] Could not find composer trigger');
    return false;
}

// ============================================
// Type Text
// ============================================

async function typeFBText(text) {
    await waitFor(1000);

    const editor = findFBEditor();
    if (!editor) {
        console.error('[ClawScrap FB] Could not find Facebook text editor');
        return false;
    }

    editor.focus();
    await waitFor(500);

    // Try execCommand first
    document.execCommand('insertText', false, text);

    if (editor.textContent && editor.textContent.trim().length > 0) {
        console.log('[ClawScrap FB] ✅ Text entered via execCommand');
        return true;
    }

    // Fallback: clipboard paste
    console.log('[ClawScrap FB] Trying clipboard paste...');
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData,
    }));
    await waitFor(500);

    if (editor.textContent && editor.textContent.trim().length > 0) {
        console.log('[ClawScrap FB] ✅ Text entered via paste');
        return true;
    }

    // Last resort: keyboard simulation
    console.log('[ClawScrap FB] Trying keyboard simulation...');
    for (const char of text) {
        editor.dispatchEvent(new InputEvent('input', {
            data: char, inputType: 'insertText', bubbles: true, cancelable: true,
        }));
        await waitFor(5);
    }

    await waitFor(500);
    return editor.textContent && editor.textContent.trim().length > 0;
}

function findFBEditor() {
    const editorSelectors = [
        'div[contenteditable="true"][role="textbox"][aria-label*="mind"]',
        'div[contenteditable="true"][role="textbox"][aria-label*="Write"]',
        'div[contenteditable="true"][role="textbox"][aria-label*="post"]',
        'div[contenteditable="true"][role="textbox"][aria-label*="say"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"][spellcheck="true"]',
    ];

    const dialog = findComposerDialog();
    if (dialog) {
        for (const selector of editorSelectors) {
            const el = dialog.querySelector(selector);
            if (el) return el;
        }
    }

    for (const selector of editorSelectors) {
        const el = document.querySelector(selector);
        if (el) return el;
    }

    return null;
}

// ============================================
// Media Upload
// ============================================

async function uploadFBMedia(mediaUrls) {
    try {
        const files = [];
        for (let i = 0; i < mediaUrls.length; i++) {
            const url = mediaUrls[i];
            console.log(`[ClawScrap FB] Downloading image ${i + 1}/${mediaUrls.length}`);
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[blob.type] || 'png';
                files.push(new File([blob], `image_${i + 1}.${ext}`, { type: blob.type }));
            } catch (err) {
                console.error(`[ClawScrap FB] Failed to download: ${url}`, err.message);
            }
        }

        if (files.length === 0) return false;

        // Find and click Photo/Video button
        const dialog = findComposerDialog();
        const container = dialog || document;

        const allBtns = container.querySelectorAll('div[role="button"], span[role="button"], [aria-label]');
        for (const btn of allBtns) {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').toLowerCase().trim();
            if (label.includes('photo') || label.includes('video') ||
                label.includes('ảnh') || label.includes('hình ảnh') ||
                text === 'photo/video' || text === 'ảnh/video') {
                btn.click();
                await waitFor(2000);
                break;
            }
        }

        // Find file input
        let fileInput = null;
        for (const input of container.querySelectorAll('input[type="file"]')) {
            const accept = input.getAttribute('accept') || '';
            if (accept.includes('image') || accept.includes('video') || accept.includes('*') || accept === '') {
                fileInput = input;
                break;
            }
        }
        if (!fileInput) {
            for (const input of document.querySelectorAll('input[type="file"]')) {
                const accept = input.getAttribute('accept') || '';
                if (accept.includes('image') || accept.includes('video') || accept.includes('*') || accept === '') {
                    fileInput = input;
                    break;
                }
            }
        }

        if (!fileInput) {
            console.error('[ClawScrap FB] Could not find file input');
            return false;
        }

        // Set files using native setter (React-compatible)
        const dataTransfer = new DataTransfer();
        for (const file of files) {
            dataTransfer.items.add(file);
        }

        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
        if (nativeSetter) {
            nativeSetter.call(fileInput, dataTransfer.files);
        } else {
            fileInput.files = dataTransfer.files;
        }

        fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

        console.log(`[ClawScrap FB] ✅ Attached ${files.length} image(s)`);
        await waitFor(5000);
        return true;

    } catch (error) {
        console.error('[ClawScrap FB] Media upload error:', error.message);
        return false;
    }
}

// ============================================
// Click Post Button
// ============================================

async function clickFBPostButton() {
    const dialog = findComposerDialog();
    const container = dialog || document;

    // Step 1: Try "Next" (Tiếp) button first
    const nextClicked = clickSpanButton(container, ['Next', 'Tiếp']);
    if (nextClicked) {
        console.log('[ClawScrap FB] ✅ Clicked "Next", waiting for Post settings...');
        await waitFor(3000);

        const newDialog = findComposerDialog() || document;
        const postClicked = clickSpanButton(newDialog, ['Post', 'Đăng', 'Share', 'Share now', 'Chia sẻ']);
        if (postClicked) {
            console.log('[ClawScrap FB] ✅ Clicked "Post" button');
            return true;
        }
        return false;
    }

    // Direct "Post" button
    const directPost = clickSpanButton(container, ['Post', 'Đăng', 'Share', 'Chia sẻ']);
    if (directPost) {
        console.log('[ClawScrap FB] ✅ Clicked direct "Post" button');
        return true;
    }

    // Last resort: aria-label selectors
    const ariaSelectors = [
        '[aria-label="Next"][role="button"]',
        '[aria-label="Post"][role="button"]',
        '[aria-label="Tiếp"][role="button"]',
        '[aria-label="Đăng"][role="button"]',
    ];

    for (const sel of ariaSelectors) {
        const btn = container.querySelector(sel);
        if (btn) {
            btn.click();
            if (sel.includes('Next') || sel.includes('Tiếp')) {
                await waitFor(3000);
                const d = findComposerDialog() || document;
                clickSpanButton(d, ['Post', 'Đăng', 'Share']);
            }
            return true;
        }
    }

    console.error('[ClawScrap FB] ❌ No Post/Next button found');
    return false;
}

function clickSpanButton(container, textOptions) {
    const allSpans = container.querySelectorAll('span');
    for (const span of allSpans) {
        const spanText = (span.innerText || span.textContent || '').trim();
        if (!spanText) continue;

        for (const option of textOptions) {
            if (spanText === option) {
                let parent = span.parentElement;
                let maxLevels = 5;
                while (parent && maxLevels-- > 0) {
                    if (parent.getAttribute('role') === 'button' || parent.tagName === 'BUTTON') {
                        parent.click();
                        return true;
                    }
                    parent = parent.parentElement;
                }
                span.click();
                return true;
            }
        }
    }
    return false;
}

// ============================================
// Helpers
// ============================================

function waitFor(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('[ClawScrap FB] Ready to receive commands');
