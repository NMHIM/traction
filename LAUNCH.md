# Launch checklist

Roughly 40 minutes end to end. Do the steps in order — step 4 needs values from steps 1 and 2.

---

## 1. Supabase (10 min)

1. Go to supabase.com, sign in, **New project**. Free plan. Any name. Pick the Frankfurt region — closest to you and to most of your users.
2. Wait for it to finish provisioning (~2 min).
3. Left sidebar → **SQL Editor** → **New query**. Open `supabase/schema.sql` from this project, paste the whole thing in, hit **Run**. You should see "Success. No rows returned."
4. Left sidebar → **Settings** → **API**. Copy two things somewhere you can find them:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon public** key — a long string starting `eyJ...`

   Ignore the `service_role` key for now. You need it in step 3, not here.

---

## 2. GitHub (10 min)

1. Create a **public** repo. Public matters: jsDelivr only serves public repos, and Actions minutes are free on public repos. Name it whatever you like — `traction` is fine.
2. Push this whole project to it, `feed/` folder included.
3. Repo **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add two:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL from step 1 |
   | `SUPABASE_SERVICE_KEY` | the **service_role** key (Settings → API, below the anon key) |

   The service key can read and write everything, which is why it lives here and never in the extension.

4. **Actions** tab → **Build feed** → **Run workflow**. It should go green in under a minute. This proves the pipeline works before anyone installs.

---

## 3. Package the extension (2 min)

In a terminal, from this folder:

```bash
bash pack.sh
```

It asks four things — your GitHub username, the repo name, the Supabase Project URL, the anon key — then writes `traction-upload.zip`.

**Test before you upload.** Go to `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, pick the `extension` folder. Open a new tab. You should see the seed board. Post something, then check Supabase → Table Editor → `posts` that the row landed with `approved = false`.

If the board says *"Not connected yet"*, `pack.sh` didn't write the values — run it again.

---

## 4. Chrome Web Store (15 min + review time)

Go to https://chrome.google.com/webstore/devconsole → **New item** → upload `traction-upload.zip`.

Then fill the listing. Copy is below — paste it straight in.

### Store listing

**Name**
```
Traction — founder milestones on every new tab
```

**Short description** (132 char max)
```
Every new tab shows what other founders shipped, sold and raised. Post your own milestone in ten seconds.
```

**Detailed description**
```
Traction replaces your new tab with a quiet board of what other people building things have actually achieved this week. First sales. Revenue milestones. Launches. Funding rounds. The unglamorous ships.

Not a news feed. Not infinite scroll. A board you glance at for five seconds and close.

WHY

Building something on your own is mostly silence. You see finished companies and funding announcements, never the €12 first sale or the third flat month. Traction shows the middle of the journey, from people in the same place as you.

HOW IT WORKS

- Open a new tab, see the board
- Post your own milestone in about ten seconds: what you're building, the number if there is one, one line about what happened
- Save the ones worth coming back to
- Cheer the ones that deserve it
- Filter by milestone type when you only want to see revenue, or only launches

FIVE KINDS OF MILESTONE

Shipped, Launched, First sale, Revenue, Funding. Each has its own colour, so you can read the whole board at a glance.

BUILT DELIBERATELY SMALL

No comments. No follower counts. No notifications. No images. No infinite scroll. Every post is reviewed before it appears. Two posts per person per day, so nobody can flood the board.

Your saved milestones and drafts stay on your own machine and are never uploaded.
```

**Category** — Productivity

**Language** — English

**Screenshots** — upload all three from the `store/` folder. They're already 1280×800.

**Icon** — the store pulls it from the zip automatically.

### Privacy tab

This is the part that gets extensions rejected. Answer exactly:

**Single purpose**
```
Replaces the new tab page with a board of startup milestones posted by users, and lets the user post their own.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `storage` | Caches the milestone board locally so the new tab opens instantly without a network request, and stores the user's saved posts and preferences on their own device. |
| `alarms` | Refreshes the cached board once per hour in the background. |
| Host: `cdn.jsdelivr.net` | The public milestone board is a static JSON file served from this CDN. |
| Host: `*.supabase.co` | Where a user's own milestone post is submitted when they choose to post one. |

**Are you using remote code?** — **No.** Everything executes from the packaged zip. The extension fetches JSON data only, never scripts. Say this clearly; getting it wrong causes rejection.

**Data collection** — answer carefully, this is where extensions get rejected:
- *Personally identifiable information* → **Yes.** A post can carry a display name and a founder LinkedIn URL. Both are optional and both are typed by the user to be published publicly, but a LinkedIn profile identifies a person, so answering "No" here would be wrong.
  - Justification: "Users may optionally include a display name and a link to their own public LinkedIn profile in a milestone they choose to publish. Both fields are optional, are entered by the user for the purpose of public display, and are not collected in the background."
- *Health / financial / authentication / personal communications / location / web history* → **No**
- *Website content* → **No**
- *User activity* → **No.** The extension does not track clicks or browsing; saved posts stay on the device.

Then tick all three certification boxes at the bottom.

**Also confirm in the listing that posts are moderated.** Reviewers look for this on anything with user-submitted content: the description already says every post is reviewed before it appears, and the extension has a Report button on each card. Keep both.

**Privacy policy URL** — required, because the extension accepts user-submitted content. Use `store/privacy-policy.md`: paste it into a new public GitHub Gist, or add it to your repo and enable GitHub Pages, then put that URL here.

### Submit

Click **Submit for review**. First-time reviews usually take a few days, sometimes longer. You'll get an email.

---

## 5. Before you tell anyone (important)

**Replace the seed content.** `feed/feed.json` ships with nine invented milestones. Delete them and put real ones in — ask five or six people you know to post the day it goes live. An empty board on install is the single most common reason people uninstall a new-tab extension, and fake-looking content is the second.

---

## Running it, day to day

**Approving posts.** Supabase → Table Editor → `posts`. New rows have `approved = false`. Tick the box to approve. Or in the SQL editor:

```sql
-- what's waiting
select created_at, startup, value, note, author
from posts where not approved and not rejected
order by created_at desc;

-- approve everything from today
update posts set approved = true
where not approved and not rejected and created_at > now() - interval '1 day';
```

Then GitHub → Actions → **Build feed** → **Run workflow** to push it live immediately, or just wait for the next half-hourly run.

Doing this once a day in the evening is enough.

**Shipping an update.** Edit the code, run `bash pack.sh` again, bump `"version"` in `extension/manifest.json` (the store rejects re-uploads at the same version), upload the new zip. Updates are reviewed much faster than the first submission.

**Handling an edit or a delete.** Both are eventually-consistent, because the public board is a static file:

- A **delete** removes the row from Supabase immediately, and the post vanishes from that person's own browser at once. It stays on everyone else's board until the next Action run, up to 30 minutes. If someone asks you to remove something urgently, delete the row and then run the workflow by hand.
- An **edit** sends the post back to `approved = false` on purpose. Without that, someone could get a harmless post approved and then rewrite it into spam. So an edited post leaves the public board until you approve it again — the person editing is told this in the interface.

---

## When this stops being free

Not soon, but the order it happens in:

1. **Supabase pauses free projects after a week with no activity.** Once you have real users posting, this never triggers. Before launch it might — just open the dashboard to wake it.
2. **Supabase free tier: 500 MB database.** A milestone post is roughly 300 bytes. That's over a million posts.
3. **jsDelivr** has no meaningful limit for a file this size.
4. **The first thing that would ever cost money is image hosting** — which is exactly why v1 has no images.
