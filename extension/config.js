// Everything you need to change when you go live is in this file.

export const CONFIG = {
  // Where the extension READS the feed. Static file on a CDN — free and unmetered.
  FEED_URL: 'https://raw.githubusercontent.com/NMHIM/traction/main/feed/feed.json',

  // Where the extension WRITES (new posts, edits, cheers).
  SUPABASE_URL: 'https://rwtzwomzyzhoxaxdlfft.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3dHp3b216eXpob3hheGRsZmZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MzAxMjcsImV4cCI6MjEwNDAwNjEyN30.s9lBjpYUPOCjGJ8rjDYDK4SiTz5N7_nUoFaIb2PbMx0',

  REFRESH_MINUTES: 60,      // how often the background worker pulls the feed
  STALE_AFTER_MINUTES: 120, // older than this and we nudge a refresh on open
  MAX_POSTS_RENDERED: 60,
  POSTS_PER_DAY: 2          // client-side guard; the real limit lives in Postgres
};

// Milestone types double as the colour system. Order runs from "just shipped"
// to "raised money".
export const MILESTONES = {
  shipped:    { label: 'Shipped',    hue: 'steel',      hint: 'A feature, a fix, a redesign' },
  launch:     { label: 'Launched',   hue: 'amber',      hint: 'It is finally public' },
  first_sale: { label: 'First sale', hue: 'teal',       hint: 'Someone paid you' },
  revenue:    { label: 'Revenue',    hue: 'periwinkle', hint: 'MRR, a big month, a milestone number' },
  funding:    { label: 'Funding',    hue: 'orchid',     hint: 'Angel, pre-seed, seed, grant' }
};

export const MILESTONE_ORDER = Object.keys(MILESTONES);

// Where the startup is, in its own life. Kept short on purpose.
export const STAGES = {
  idea:     'Idea',
  building: 'Building',
  live:     'Live',
  revenue:  'Making revenue',
  funded:   'Funded'
};

// What the founder is open to. These are the reason someone opens a card
// and then writes to that person, so they matter more than they look.
export const LOOKING_FOR = {
  cofounder:   'A co-founder',
  customers:   'First customers',
  partnership: 'Partnerships',
  investors:   'Investors',
  hiring:      'Hiring',
  feedback:    'Feedback',
};

export const NEEDS_SETUP = new RegExp(['GH_' + 'USER', 'YOUR_' + 'PROJECT', 'YOUR_' + 'ANON'].join('|'))
  .test(CONFIG.FEED_URL + CONFIG.SUPABASE_URL + CONFIG.SUPABASE_ANON_KEY);
