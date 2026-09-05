import { CONFIG, MILESTONES, MILESTONE_ORDER, STAGES, LOOKING_FOR, NEEDS_SETUP } from './config.js';

/* ------------------------------------------------------------------
   Storage shim. Inside the extension we use chrome.storage.local.
   Opened as a plain file (for design review) we fall back to
   localStorage + the sample feed, so the page still renders.
------------------------------------------------------------------ */

const inExtension = typeof chrome !== 'undefined' && chrome.storage?.local;

const store = {
  async get(keys) {
    if (inExtension) return chrome.storage.local.get(keys);
    const out = {};
    for (const k of [].concat(keys)) {
      const raw = localStorage.getItem('traction:' + k);
      if (raw !== null) out[k] = JSON.parse(raw);
    }
    return out;
  },
  async set(obj) {
    if (inExtension) return chrome.storage.local.set(obj);
    for (const [k, v] of Object.entries(obj)) {
      localStorage.setItem('traction:' + k, JSON.stringify(v));
    }
  }
};

/* ------------------------------------------------------------------
   State
------------------------------------------------------------------ */

const state = {
  posts: [],
  fetchedAt: 0,
  saved: new Set(),
  cheered: {},          // id -> timestamp we cheered, so we don't double-count
  mine: [],             // { id, edit_token, ...fields, at } for posts this browser made
  filter: null,
  view: 'all',          // all | saved | mine
  deviceId: null,
  author: '',
  composerType: 'shipped',
  looking: new Set(),
  editing: null,        // id of the post being edited, or null
  openId: null
};

const el = (id) => document.getElementById(id);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

/* ------------------------------------------------------------------
   Boot
------------------------------------------------------------------ */

init();

async function init() {
  const data = await store.get([
    'feed', 'feedFetchedAt', 'saved', 'cheered', 'mine', 'deviceId', 'author'
  ]);

  state.posts = data.feed?.posts ?? [];
  state.fetchedAt = data.feedFetchedAt ?? 0;
  state.saved = new Set(data.saved ?? []);
  state.cheered = data.cheered ?? {};
  state.mine = data.mine ?? [];
  state.author = data.author ?? '';

  state.deviceId = data.deviceId ?? uuid();
  if (!data.deviceId) await store.set({ deviceId: state.deviceId });

  if (!state.posts.length && !inExtension) {
    try {
      const res = await fetch('../feed/feed.json');
      state.posts = (await res.json()).posts ?? [];
    } catch { /* leave the board empty and let the empty state speak */ }
  }

  buildFilters();
  buildComposerTypes();
  buildLookingTags();
  render({ firstPaint: true });
  wireEvents();

  if (inExtension) {
    const ageMin = (Date.now() - state.fetchedAt) / 60000;
    if (ageMin > CONFIG.STALE_AFTER_MINUTES) {
      pullBoard();  // read Supabase right now, do not wait for the worker
      chrome.runtime.sendMessage({ type: 'refresh-feed' }).catch(() => {});
    }
    chrome.storage.onChanged.addListener((changes) => {
      if (!changes.feed) return;
      state.posts = changes.feed.newValue?.posts ?? [];
      state.fetchedAt = Date.now();
      render({ firstPaint: false });
    });
  }
}

/* ------------------------------------------------------------------
   What goes on the board
------------------------------------------------------------------ */

function visiblePosts() {
  const live = new Set(state.posts.map((p) => p.id));

  // Once a post of ours has been approved and appears in the published feed,
  // stop showing our local copy of it — otherwise it renders twice.
  const waiting = state.mine
    .filter((m) => !live.has(m.id))
    .map((m) => ({ ...m, pending: true, mine: true }));

  let list = [
    ...waiting,
    ...state.posts.map((p) => ({ ...p, mine: state.mine.some((m) => m.id === p.id) }))
  ];

  if (state.filter) list = list.filter((p) => p.type === state.filter);
  if (state.view === 'saved') list = list.filter((p) => state.saved.has(p.id));
  if (state.view === 'mine')  list = list.filter((p) => p.mine);
  return list.slice(0, CONFIG.MAX_POSTS_RENDERED);
}

// A cheer we placed is already inside the published count once the feed was
// rebuilt after we sent it. Only add our own +1 while that is still pending.
function cheerCount(post) {
  const base = post.cheers ?? 0;
  const at = state.cheered[post.id];
  if (!at) return base;
  return state.fetchedAt > at ? base : base + 1;
}

/* ------------------------------------------------------------------
   Render
------------------------------------------------------------------ */

function render({ firstPaint }) {
  const list = visiblePosts();
  const root = el('grid');

  root.replaceChildren(...list.map(cardNode));
  root.classList.toggle('is-first-paint', Boolean(firstPaint));

  el('board-empty').hidden = list.length > 0;
  el('board-empty').textContent = emptyLine();

  const week = state.posts.filter((p) => Date.now() - new Date(p.at).getTime() < 6048e5).length;
  el('tally').textContent = week ? `${week} milestone${week === 1 ? '' : 's'} this week` : '';

  el('freshness').textContent = state.fetchedAt ? `Board updated ${relTime(state.fetchedAt)}` : '';
  el('filters').hidden = state.posts.length < 4;

  if (state.openId) {
    const still = list.find((p) => p.id === state.openId);
    still ? fillSheet(still) : closeSheet();
  }
}

function emptyLine() {
  if (NEEDS_SETUP) return 'Not connected yet. Fill in the three values in config.js (run pack.sh) and reload the extension.';
  if (state.view === 'saved') return 'Nothing saved yet. Open a card and save it to keep it here.';
  if (state.view === 'mine')  return 'You have not posted a milestone yet.';
  if (state.filter) return `No ${MILESTONES[state.filter].label.toLowerCase()} milestones on the board right now.`;
  return 'Nothing on the board yet. Post the first milestone and it goes live within the hour.';
}

function cardNode(post) {
  const kind = MILESTONES[post.type] ?? MILESTONES.shipped;

  const li = document.createElement('li');
  const card = document.createElement('button');
  card.className = 'card';
  card.type = 'button';
  card.style.setProperty('--entry-hue', `var(--${kind.hue})`);
  card.addEventListener('click', () => openSheet(post));

  const kindLine = document.createElement('p');
  kindLine.className = 'card-kind';
  kindLine.textContent = kind.label;
  card.append(kindLine);

  const anchor = document.createElement('p');
  anchor.className = 'card-figure';
  if (post.value) {
    const [, figure, unit] = post.value.match(/^(\S+)(?:\s+(.+))?$/) ?? [];
    anchor.append(figure ?? post.value);
    if (unit) {
      const u = document.createElement('span');
      u.className = 'card-unit';
      u.textContent = unit;
      anchor.append(u);
    }
    card.append(anchor);
    const name = document.createElement('p');
    name.className = 'card-startup';
    name.textContent = post.startup;
    card.append(name);
  } else {
    anchor.classList.add('is-name');
    anchor.textContent = post.startup;
    card.append(anchor);
  }

  if (post.note) {
    const note = document.createElement('p');
    note.className = 'card-note';
    note.textContent = post.note;
    card.append(note);
  }

  if (post.pending) {
    const flag = document.createElement('span');
    flag.className = 'card-flag';
    flag.textContent = 'In review';
    card.append(flag);
  }

  const foot = document.createElement('div');
  foot.className = 'card-foot';

  const who = document.createElement('span');
  who.className = 'card-author';
  who.textContent = post.author || 'anonymous';
  foot.append(who);

  const when = document.createElement('span');
  when.textContent = post.pending ? 'just now' : relTime(new Date(post.at).getTime());
  foot.append(when);

  if (!post.pending) {
    const c = document.createElement('span');
    c.className = 'card-cheers';
    c.textContent = `${state.cheered[post.id] ? '\u2726' : '\u2727'} ${cheerCount(post)}`;
    foot.append(c);
  }

  card.append(foot);
  li.append(card);
  return li;
}

/* ------------------------------------------------------------------
   Detail sheet
------------------------------------------------------------------ */

function openSheet(post) {
  state.openId = post.id;
  fillSheet(post);
  el('sheet').hidden = false;
  el('sheet-veil').hidden = false;
  el('sheet-close').focus();
}

function closeSheet() {
  state.openId = null;
  el('sheet').hidden = true;
  el('sheet-veil').hidden = true;
}

function fillSheet(post) {
  const kind = MILESTONES[post.type] ?? MILESTONES.shipped;
  const body = el('sheet-body');
  el('sheet').style.setProperty('--entry-hue', `var(--${kind.hue})`);
  body.replaceChildren();

  const kindLine = document.createElement('p');
  kindLine.className = 'sheet-kind';
  kindLine.textContent = post.pending ? `${kind.label} — in review` : kind.label;
  body.append(kindLine);

  if (post.value) {
    const fig = document.createElement('p');
    fig.className = 'sheet-figure';
    fig.textContent = post.value;
    body.append(fig);
  }

  const h2 = document.createElement('h2');
  h2.id = 'sheet-startup';
  h2.textContent = post.startup;
  body.append(h2);

  if (post.note) {
    const note = document.createElement('p');
    note.className = 'sheet-note';
    note.textContent = post.note;
    body.append(note);
  }

  if (post.about) body.append(section('What they are building', aboutNode(post.about)));

  if (post.stage && STAGES[post.stage]) {
    body.append(section('Stage', tagList([STAGES[post.stage]])));
  }

  if (post.looking_for?.length) {
    const labels = post.looking_for.map((k) => LOOKING_FOR[k]).filter(Boolean);
    if (labels.length) body.append(section('Open to', tagList(labels)));
  }

  const links = [
    ['Website', post.website],
    ['Social', post.social],
    ['Founder on LinkedIn', post.linkedin],
    ['This milestone', post.link]
  ].filter(([, url]) => url);

  if (links.length) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-links';
    for (const [label, url] of links) {
      const a = document.createElement('a');
      a.className = 'sheet-link';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.textContent = `${label} — ${hostOf(url)}`;
      wrap.append(a);
    }
    body.append(section('Links', wrap));
  }

  const meta = document.createElement('div');
  meta.className = 'sheet-meta';
  const who = document.createElement('span');
  who.textContent = post.author || 'anonymous';
  const when = document.createElement('span');
  when.textContent = post.pending ? 'just now' : relTime(new Date(post.at).getTime());
  meta.append(who, when);
  body.append(meta);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';

  if (!post.pending) {
    const cheer = document.createElement('button');
    cheer.className = 'tool';
    cheer.type = 'button';
    const done = Boolean(state.cheered[post.id]);
    cheer.setAttribute('aria-pressed', String(done));
    cheer.textContent = `${done ? '\u2726' : '\u2727'} Cheer ${cheerCount(post)}`;
    cheer.addEventListener('click', () => cheerPost(post, cheer));

    const save = document.createElement('button');
    save.className = 'tool';
    save.type = 'button';
    const isSaved = state.saved.has(post.id);
    save.setAttribute('aria-pressed', String(isSaved));
    save.textContent = isSaved ? 'Saved' : 'Save';
    save.addEventListener('click', () => toggleSave(post, save));

    const report = document.createElement('button');
    report.className = 'tool tool-danger';
    report.type = 'button';
    report.textContent = 'Report';
    report.addEventListener('click', () => reportPost(post, report));

    actions.append(cheer, save, report);
  }

  if (post.mine) {
    const edit = document.createElement('button');
    edit.className = 'tool';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => startEdit(post));

    const del = document.createElement('button');
    del.className = 'tool tool-danger';
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', () => deletePost(post, del));

    actions.append(edit, del);
  }

  body.append(actions);

  const msg = document.createElement('p');
  msg.className = 'sheet-msg';
  msg.id = 'sheet-msg';
  body.append(msg);

  if (post.mine && !post.pending) {
    msg.textContent = 'Editing sends the post back for review, so it leaves the public board until it is approved again.';
  }
}

function section(title, node) {
  const s = document.createElement('div');
  s.className = 'sheet-section';
  const h = document.createElement('h3');
  h.textContent = title;
  s.append(h, node);
  return s;
}

function aboutNode(text) {
  const p = document.createElement('p');
  p.className = 'sheet-about';
  p.textContent = text;
  return p;
}

function tagList(labels) {
  const wrap = document.createElement('div');
  wrap.className = 'tags';
  for (const label of labels) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = label;
    wrap.append(t);
  }
  return wrap;
}

/* ------------------------------------------------------------------
   Filters, type buttons, looking-for tags
------------------------------------------------------------------ */

function buildFilters() {
  const wrap = el('filters');
  const all = document.createElement('button');
  all.className = 'filter';
  all.type = 'button';
  all.textContent = 'Everything';
  all.setAttribute('aria-pressed', 'true');
  all.addEventListener('click', () => setFilter(null));
  wrap.append(all);

  for (const key of MILESTONE_ORDER) {
    const b = document.createElement('button');
    b.className = 'filter';
    b.type = 'button';
    b.dataset.type = key;
    b.setAttribute('aria-pressed', 'false');
    const dot = document.createElement('span');
    dot.className = 'filter-dot';
    dot.style.background = `var(--${MILESTONES[key].hue})`;
    b.append(dot, document.createTextNode(MILESTONES[key].label));
    b.addEventListener('click', () => setFilter(key));
    wrap.append(b);
  }
}

function setFilter(type) {
  state.filter = type;
  state.view = 'all';
  for (const b of el('filters').children) {
    b.setAttribute('aria-pressed', String((b.dataset.type ?? null) === type));
  }
  el('view-saved').setAttribute('aria-pressed', 'false');
  el('view-mine').setAttribute('aria-pressed', 'false');
  render({ firstPaint: false });
}

function buildComposerTypes() {
  const wrap = el('composer-types');
  for (const key of MILESTONE_ORDER) {
    const b = document.createElement('button');
    b.className = 'type-btn';
    b.type = 'button';
    b.dataset.type = key;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(key === state.composerType));
    b.style.setProperty('--type-hue', `var(--${MILESTONES[key].hue})`);
    b.title = MILESTONES[key].hint;
    b.textContent = MILESTONES[key].label;
    b.addEventListener('click', () => setComposerType(key));
    wrap.append(b);
  }
}

function setComposerType(key) {
  state.composerType = key;
  for (const s of el('composer-types').children) {
    s.setAttribute('aria-checked', String(s.dataset.type === key));
  }
  el('f-value').placeholder =
    key === 'funding' ? '150k pre-seed'
    : key === 'revenue' ? '2.4k MRR'
    : key === 'first_sale' ? '40'
    : '';
}

function buildLookingTags() {
  const wrap = el('looking-tags');
  for (const [key, label] of Object.entries(LOOKING_FOR)) {
    const b = document.createElement('button');
    b.className = 'looking-tag';
    b.type = 'button';
    b.dataset.key = key;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = label;
    b.addEventListener('click', () => {
      state.looking.has(key) ? state.looking.delete(key) : state.looking.add(key);
      b.setAttribute('aria-pressed', String(state.looking.has(key)));
    });
    wrap.append(b);
  }
}

/* ------------------------------------------------------------------
   Actions
------------------------------------------------------------------ */

function wireEvents() {
  el('post-open').addEventListener('click', () => openComposer());
  el('post-cancel').addEventListener('click', closeComposer);
  el('post-submit').addEventListener('click', submitPost);
  el('sheet-close').addEventListener('click', closeSheet);
  el('sheet-veil').addEventListener('click', closeSheet);

  el('more-toggle').addEventListener('click', () => {
    const open = el('composer-more').hidden;
    el('composer-more').hidden = !open;
    el('more-toggle').setAttribute('aria-expanded', String(open));
  });

  el('view-saved').addEventListener('click', () => setView('saved'));
  el('view-mine').addEventListener('click', () => setView('mine'));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el('sheet').hidden) return closeSheet();
    if (!el('composer').hidden) closeComposer();
  });
}

function setView(which) {
  state.view = state.view === which ? 'all' : which;
  state.filter = null;
  el('view-saved').setAttribute('aria-pressed', String(state.view === 'saved'));
  el('view-mine').setAttribute('aria-pressed', String(state.view === 'mine'));
  for (const b of el('filters').children) {
    b.setAttribute('aria-pressed', String(state.view === 'all' && !b.dataset.type));
  }
  render({ firstPaint: false });
}

function openComposer(post = null) {
  state.editing = post?.id ?? null;
  el('composer').hidden = false;
  el('post-submit').textContent = post ? 'Save changes' : 'Post milestone';

  setComposerType(post?.type ?? 'shipped');
  el('f-startup').value  = post?.startup  ?? '';
  el('f-value').value    = post?.value    ?? '';
  el('f-note').value     = post?.note     ?? '';
  el('f-about').value    = post?.about    ?? '';
  el('f-website').value  = post?.website  ?? '';
  el('f-social').value   = post?.social   ?? '';
  el('f-linkedin').value = post?.linkedin ?? '';
  el('f-stage').value    = post?.stage    ?? '';
  el('f-link').value     = post?.link     ?? '';
  el('f-author').value   = post?.author   ?? state.author;

  state.looking = new Set(post?.looking_for ?? []);
  for (const b of el('looking-tags').children) {
    b.setAttribute('aria-pressed', String(state.looking.has(b.dataset.key)));
  }

  const hasProfile = Boolean(post?.about || post?.website || post?.social || post?.linkedin || post?.stage || post?.looking_for?.length);
  el('composer-more').hidden = !hasProfile;
  el('more-toggle').setAttribute('aria-expanded', String(hasProfile));

  setMsg('', null);
  el('f-startup').focus();
  el('composer').scrollIntoView({ block: 'nearest' });
}

function closeComposer() {
  el('composer').hidden = true;
  state.editing = null;
  setMsg('', null);
}

function startEdit(post) {
  const own = state.mine.find((m) => m.id === post.id);
  if (!own) return sheetMsg('This browser does not hold the key for that post, so it cannot be edited here.', 'error');
  closeSheet();
  openComposer({ ...post, ...own });
}

async function toggleSave(post, btn) {
  const isSaved = state.saved.has(post.id);
  isSaved ? state.saved.delete(post.id) : state.saved.add(post.id);
  btn.setAttribute('aria-pressed', String(!isSaved));
  btn.textContent = !isSaved ? 'Saved' : 'Save';
  await store.set({ saved: [...state.saved] });
  render({ firstPaint: false });
}

async function cheerPost(post, btn) {
  if (state.cheered[post.id]) return;  // one cheer per person, no take-backs
  state.cheered[post.id] = Date.now();
  btn.setAttribute('aria-pressed', 'true');
  btn.textContent = `\u2726 Cheer ${cheerCount(post)}`;
  await store.set({ cheered: state.cheered });
  supa('cheers', { post_id: post.id, device_id: state.deviceId }).catch(() => {});
  render({ firstPaint: false });
}

async function reportPost(post, btn) {
  btn.disabled = true;
  supa('reports', { post_id: post.id, device_id: state.deviceId }).catch(() => {});
  sheetMsg('Reported. It gets looked at before it stays on the board.', null);
}

async function deletePost(post, btn) {
  const own = state.mine.find((m) => m.id === post.id);
  if (!own) return sheetMsg('This browser does not hold the key for that post.', 'error');

  btn.disabled = true;
  sheetMsg('Deleting...', null);
  try {
    await rpc('delete_my_post', { p_id: post.id, p_token: own.edit_token });
    state.mine = state.mine.filter((m) => m.id !== post.id);
    state.posts = state.posts.filter((p) => p.id !== post.id);
    await store.set({ mine: state.mine });
    closeSheet();
    render({ firstPaint: false });
  } catch {
    btn.disabled = false;
    sheetMsg('That did not delete. Check your connection and try again.', 'error');
  }
}

async function submitPost() {
  const v = {
    startup:  el('f-startup').value.trim(),
    value:    el('f-value').value.trim(),
    note:     el('f-note').value.trim(),
    about:    el('f-about').value.trim(),
    website:  el('f-website').value.trim(),
    social:   el('f-social').value.trim(),
    linkedin: el('f-linkedin').value.trim(),
    stage:    el('f-stage').value,
    link:     el('f-link').value.trim(),
    author:   el('f-author').value.trim()
  };

  if (!v.startup) return setMsg('Add the name of what you are building.', 'error');
  if (!v.note)    return setMsg('Say what happened, in a line.', 'error');

  for (const [label, key] of [['Website', 'website'], ['Social', 'social'], ['LinkedIn', 'linkedin'], ['Milestone link', 'link']]) {
    if (v[key] && !/^https:\/\//i.test(v[key])) return setMsg(`${label} needs to start with https://`, 'error');
  }

  const btn = el('post-submit');
  btn.disabled = true;
  setMsg(state.editing ? 'Saving...' : 'Sending...', null);

  const looking = [...state.looking];

  try {
    if (state.editing) {
      const own = state.mine.find((m) => m.id === state.editing);
      if (!own) throw new Error('no token');
      await rpc('update_my_post', {
        p_id: own.id, p_token: own.edit_token,
        p_type: state.composerType,
        p_startup: v.startup, p_value: v.value || null, p_note: v.note,
        p_about: v.about || null, p_website: v.website || null,
        p_social: v.social || null, p_linkedin: v.linkedin || null,
        p_stage: v.stage || null, p_looking_for: looking.length ? looking : null,
        p_author: v.author || null, p_link: v.link || null
      });

      // The edit sent it back to review, so it drops off the public board
      // until you approve it again. Show our local copy meanwhile.
      state.posts = state.posts.filter((p) => p.id !== own.id);
      Object.assign(own, { ...v, type: state.composerType, looking_for: looking, at: new Date().toISOString() });
      await store.set({ mine: state.mine });
      setMsg('Saved. It goes back on the board once it is approved again.', 'good');
    } else {
      const today = new Date().toDateString();
      const todayCount = state.mine.filter((m) => new Date(m.at).toDateString() === today).length;
      if (todayCount >= CONFIG.POSTS_PER_DAY) {
        btn.disabled = false;
        return setMsg('Two milestones a day is the limit. Come back tomorrow.', 'error');
      }

      const id = uuid();
      const token = uuid();

      await supa('posts', {
        id, edit_token: token,
        device_id: state.deviceId,
        type: state.composerType,
        startup: v.startup, value: v.value || null, note: v.note,
        about: v.about || null, website: v.website || null,
        social: v.social || null, linkedin: v.linkedin || null,
        stage: v.stage || null, looking_for: looking.length ? looking : null,
        author: v.author || null, link: v.link || null
      });

      state.mine.unshift({
        id, edit_token: token,
        type: state.composerType, ...v,
        looking_for: looking,
        at: new Date().toISOString()
      });
      await store.set({ mine: state.mine.slice(0, 40) });
      setMsg('Posted. It joins the board within the hour.', 'good');
    }

    state.author = v.author;
    await store.set({ author: v.author });
    render({ firstPaint: false });
    setTimeout(closeComposer, 1500);
  } catch (err) {
    const text = String(err.message || '');
    setMsg(
      /rate|policy|row-level/i.test(text)
        ? 'That is your posting limit for today.'
        : 'That did not send. Check your connection and try again.',
      'error'
    );
  } finally {
    btn.disabled = false;
  }
}

function setMsg(text, kind) {
  const n = el('composer-msg');
  n.textContent = text;
  n.className = 'composer-msg' + (kind ? ` is-${kind}` : '');
}

function sheetMsg(text, kind) {
  const n = el('sheet-msg');
  if (!n) return;
  n.textContent = text;
  n.className = 'sheet-msg' + (kind ? ` is-${kind}` : '');
}

/* ------------------------------------------------------------------
   Supabase REST — no SDK, just fetch
------------------------------------------------------------------ */

// Pull the live board from the database and repaint. This is what makes an
// approved post show up on the very next new tab.
async function pullBoard() {
  if (NEEDS_SETUP) return;
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
    state.posts = rows;
    state.fetchedAt = Date.now();
    await store.set({
      feed: { generatedAt: new Date().toISOString(), count: rows.length, posts: rows },
      feedFetchedAt: state.fetchedAt
    });
    render({ firstPaint: false });
  } catch { /* keep whatever is cached */ }
}

function headers() {
  return {
    apikey: CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function supa(table, row) {
  if (NEEDS_SETUP) throw new Error('not configured');
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(row)
  });
  if (!res.ok) throw new Error(await res.text());
}

async function rpc(fn, args) {
  if (NEEDS_SETUP) throw new Error('not configured');
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ------------------------------------------------------------------
   Small helpers
------------------------------------------------------------------ */

function relTime(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 7 ? `${days}d ago` : `${Math.round(days / 7)}w ago`;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'link'; }
}
