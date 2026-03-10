/**
 * content-x-profile.js — ClawScrap
 * Scrapes latest tweets from an X/Twitter profile page.
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'scrape_x_profile') return;

    try {
        const max = msg.count || 10;
        const includeReplies = msg.includeReplies || false;
        const data = scrapeXProfile(max, includeReplies);
        sendResponse({ success: true, ...data });
    } catch (err) {
        sendResponse({ success: false, error: err.message });
    }

    return true;
});

function scrapeXProfile(max, includeReplies) {
    const tweets = [];

    // Extract profile metadata
    const displayName = document.querySelector('div[data-testid="UserName"] span:first-child')?.textContent?.trim()
        || document.querySelector('h2[role="heading"] span')?.textContent?.trim()
        || '';

    const handleEl = document.querySelector('div[data-testid="UserName"] div:last-child span');
    const handle = handleEl?.textContent?.trim() || window.location.pathname.replace('/', '');

    // Collect tweet articles
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
        if (tweets.length >= max) break;
        try {
            // Skip replies unless requested
            if (!includeReplies) {
                const socialCtx = art.querySelector('div[data-testid="socialContext"]');
                const isReply = !!art.querySelector('div[data-testid="reply"]')
                    || art.closest('div[aria-label*="Reply"]') !== null;
                // Check if tweet thread starts with "Replying to"
                const replyingTo = [...art.querySelectorAll('span')].some(s => s.textContent.trim() === 'Replying to');
                if (replyingTo) continue;
            }

            const text = art.querySelector('div[data-testid="tweetText"]')?.innerText?.trim() || '';
            const te = art.querySelector('time');
            let url = '';
            const tl = te?.closest('a');
            if (tl) url = 'https://x.com' + tl.getAttribute('href');

            // Skip if already collected
            if (url && tweets.some(t => t.url === url)) continue;

            // Engagement metrics
            const metrics = {};
            const btns = art.querySelectorAll('div[role="group"] button');
            ['replies', 'retweets', 'likes', 'views'].forEach((n, i) => {
                const m = btns[i]?.getAttribute('aria-label')?.match(/(\d[\d,]*)/);
                metrics[n] = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
            });

            // Media attachments (images)
            const images = [...art.querySelectorAll('img[src*="twimg.com/media"]')]
                .map(img => img.src);

            tweets.push({
                text,
                timestamp: te?.getAttribute('datetime') || '',
                url,
                metrics,
                images,
            });
        } catch { /* skip malformed tweet */ }
    }

    return { handle, displayName, tweets };
}
