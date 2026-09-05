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
  // Read the board straight from Supabase. Approving a post makes it appear
  // here immediately — there is no build step or CDN cache in between.
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/board?select=*`, {
      cache: 'no-cache',
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
      }
    });
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows)) return;
    const feed = { generatedAt: new Date().toISOString(), count: rows.length, posts: rows };
    await chrome.storage.local.set({ feed, feedFetchedAt: Date.now() });
  } catch {
    // Offline or Supabase blip. The cached board stays on screen; we retry shortly.
  }
}
