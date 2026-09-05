# Traction

A new-tab board of founder milestones. People post what they shipped, sold or raised; everyone with the extension sees it on every new tab.

Runs at **€0/month** by splitting reads from writes.

```
  posting (rare)                    reading (constant)
  ──────────────                    ──────────────────
  extension  →  Supabase            extension  →  chrome.storage.local
                   │                                      ↑
                   │  GitHub Action, every 30 min         │  once an hour
                   ↓                                      │
              feed/feed.json  →  GitHub  →  jsDelivr CDN ─┘
```

A new tab never touches the network. It renders from `chrome.storage.local`, refreshed hourly by the service worker. That's the whole cost model: 1,000 users cost roughly what 10 users cost, because the constant path is a static file on a CDN and the metered path only fires when someone actually posts.

Supabase is used **write-only**. No `SELECT` policy exists on any table, so there is no read path to abuse and no way to scrape the database from the extension.

## Going live

1. **Supabase** — new free project, paste `supabase/schema.sql` into the SQL editor, run it.
2. **GitHub** — push this repo, make it public (jsDelivr needs that, and it keeps Actions free).
3. **Secrets** — in repo Settings → Secrets → Actions, add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (the service role key, from Supabase → Settings → API). The service key stays server-side; it is never in the extension.
4. **Config** — edit `extension/config.js`: set `FEED_URL` to your repo, plus `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the anon key, which is safe to ship).
5. **Test locally** — `chrome://extensions` → Developer mode → Load unpacked → pick the `extension` folder. Open a new tab.
6. **Publish** — zip the `extension` folder, upload to the Chrome Web Store dashboard.

Run the Action once by hand (Actions tab → Build feed → Run workflow) so `feed.json` exists before anyone installs.

## Moderating

Every post lands with `approved = false` and is invisible to everyone until you say otherwise. Supabase's table editor is the queue — no tooling to build, no cost.

```sql
-- see what's waiting
select created_at, startup, value, note, author from posts
where not approved and not rejected order by created_at desc;

-- approve
update posts set approved = true where id = '…';

-- reject
update posts set rejected = true where id = '…';
```

The author sees their own post immediately, marked *in review*, held in their local storage. It joins the public board on the next Action run.

## What each limit is

| Limit | Where it lives |
|---|---|
| 2 posts per device per 24h | Postgres RLS policy — cannot be bypassed by editing the extension |
| 1 cheer per device per post | primary key on `cheers` |
| 60 cheers per device per hour | RLS policy |
| No images | not implemented, on purpose — storage is the first thing that ever bills you |
| 200 posts on the board | the `board` view |

## Preview the design without installing

```bash
python3 -m http.server 8899
# open http://localhost:8899/extension/newtab.html
```

The page detects it isn't running as an extension and falls back to `feed/feed.json`, so the board renders with the seed content.

## Cold start

`feed/feed.json` ships with nine seed milestones. They are placeholders — replace them with real ones from people you know before launch. An empty board on install is the single most likely reason someone uninstalls.

## Not built yet, deliberately

Comments, images, follows, notifications, real-time. Each one adds moderation load or cost. Text-only is what keeps this at zero.
