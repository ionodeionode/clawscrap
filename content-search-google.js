/**
 * content-search-google.js — ClawScrap
 * Scrapes Google search results and returns them to background.js
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'scrape_google') return;

    try {
        const max = msg.count || 10;
        const result = scrapeGoogle(max);
        sendResponse({ success: true, ...result });
    } catch (err) {
        sendResponse({ success: false, error: err.message });
    }

    return true; // async
});

function scrapeGoogle(max) {
    const results = [];

    let items = document.querySelectorAll('div.tF2Cxc');
    if (!items.length) items = document.querySelectorAll('div.g');
    if (!items.length) {
        const r = document.getElementById('rso') || document.getElementById('search');
        if (r) items = r.querySelectorAll('div:has(> a h3), div:has(> div > a h3)');
    }

    for (const el of items) {
        if (results.length >= max) break;
        try {
            const h3 = el.querySelector('h3');
            const a = el.querySelector('a[href]');
            if (!h3 || !a) continue;

            const url = a.href;
            if (!url.startsWith('http') || url.includes('google.com/search')) continue;

            const snippet = el.querySelector(
                'div.VwiC3b, div[data-sncf], div[style*="-webkit-line-clamp"], div.IsZvec'
            );

            if (results.some(r => r.url === url)) continue;

            results.push({
                title: h3.textContent.trim(),
                url,
                displayUrl: el.querySelector('cite')?.textContent?.trim() || url,
                snippet: snippet?.textContent?.trim() || '',
                position: results.length + 1,
            });
        } catch { /* skip malformed item */ }
    }

    // People Also Ask
    const paa = [];
    document.querySelectorAll('div.related-question-pair, div[data-q]').forEach(el => {
        const q = (el.getAttribute('data-q') || el.querySelector('span')?.textContent)?.trim();
        if (q && !paa.includes(q)) paa.push(q);
    });

    return {
        organic: results,
        peopleAlsoAsk: paa,
        totalResultsText: document.querySelector('#result-stats')?.textContent?.trim() || '',
    };
}
