/**
 * content-search-x.js — ClawScrap
 * Scrapes X.com (Twitter) search results and returns them to background.js
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'scrape_x') return;

    try {
        const max = msg.count || 10;
        const tweets = scrapeX(max);
        sendResponse({ success: true, tweets });
    } catch (err) {
        sendResponse({ success: false, error: err.message });
    }

    return true; // async
});

function scrapeX(max) {
    const tweets = [];

    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
        if (tweets.length >= max) break;
        try {
            const un = art.querySelector('div[data-testid="User-Name"]');
            let author = '', handle = '', verified = false;

            if (un) {
                author = un.querySelectorAll('a span')[0]?.textContent?.trim() || '';
                for (const a of un.querySelectorAll('a')) {
                    const h = a.getAttribute('href');
                    if (h?.startsWith('/') && !h.includes('/status/')) {
                        handle = '@' + h.slice(1);
                        break;
                    }
                }
                verified = !!un.querySelector('svg[data-testid="icon-verified"]');
            }

            const text = art.querySelector('div[data-testid="tweetText"]')?.innerText?.trim() || '';
            const te = art.querySelector('time');
            let url = '';
            const tl = te?.closest('a');
            if (tl) url = 'https://x.com' + tl.getAttribute('href');

            // Engagement metrics
            const metrics = {};
            const btns = art.querySelectorAll('div[role="group"] button');
            ['replies', 'retweets', 'likes', 'views'].forEach((n, i) => {
                const m = btns[i]?.getAttribute('aria-label')?.match(/(\d[\d,]*)/);
                metrics[n] = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
            });

            tweets.push({
                author,
                handle,
                verified,
                text,
                timestamp: te?.getAttribute('datetime') || '',
                url,
                metrics,
            });
        } catch { /* skip malformed tweet */ }
    }

    return tweets;
}
