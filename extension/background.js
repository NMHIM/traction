import { CONFIG } from './config.js';

// The whole cost model lives here. New tabs never hit the network — they read
// chrome.storage.local. This worker refreshes that cache once an hour from a
// static CDN file, so 1,000 users cost the same as 10.

const ALARM = 'traction-refresh';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: CONFIG.REFRESH_MINUTES, when: Date.now() + 1000 });
  refresh();
});

chrome.runtime.onStartup.addListener(refresh);

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) refresh();
});

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === 'refresh-feed') {
    refresh().then(() => respond({ ok: true }));
    return true; // keep the channel open for the async reply
  }
});

async function refresh() {
  try {
    const res = await fetch(CONFIG.FEED_URL, { cache: 'no-cache' });
    if (!res.ok) return;
    const feed = await res.json();
    if (!Array.isArray(feed?.posts)) return;
    await chrome.storage.local.set({ feed, feedFetchedAt: Date.now() });
  } catch {
    // Offline or CDN blip. The cached board stays on screen; we try again next hour.
  }
}
