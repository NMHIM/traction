// Reads approved posts from Supabase, writes feed/feed.json.
// Runs in GitHub Actions on a cron. No dependencies — Node 20+ has fetch built in.

import { writeFile, readFile, mkdir } from 'node:fs/promises';

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY; // service role: this never ships to users
const OUT = 'feed/feed.json';

if (!URL_BASE || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

const res = await fetch(`${URL_BASE}/rest/v1/board?select=*`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
});

if (!res.ok) {
  console.error('Supabase said:', res.status, await res.text());
  process.exit(1);
}

const rows = await res.json();

const feed = {
  generatedAt: new Date().toISOString(),
  count: rows.length,
  posts: rows.map((r) => ({
    id: r.id,
    at: r.at,
    type: r.type,
    startup: r.startup,
    value: r.value ?? null,
    note: r.note,
    about: r.about ?? null,
    stage: r.stage ?? null,
    looking_for: r.looking_for ?? null,
    link: r.link ?? null,
    website: r.website ?? null,
    social: r.social ?? null,
    linkedin: r.linkedin ?? null,
    author: r.author ?? null,
    cheers: Number(r.cheers ?? 0)
  }))
};

// Only rewrite when the content actually changed, so the commit history stays
// meaningful and the CDN cache is not busted for nothing.
const next = JSON.stringify(feed, null, 2) + '\n';
let prev = '';
try { prev = await readFile(OUT, 'utf8'); } catch {}

const stripStamp = (s) => s.replace(/"generatedAt": "[^"]*",\n/, '');
if (stripStamp(prev) === stripStamp(next)) {
  console.log('No change — skipping write.');
  process.exit(0);
}

await mkdir('feed', { recursive: true });
await writeFile(OUT, next);
console.log(`Wrote ${feed.count} posts to ${OUT}`);
