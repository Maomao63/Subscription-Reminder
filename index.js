const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_VERSION = '1.1.1';
const PORT = Number(process.env.PORT || 13000);
const DATA_DIR = process.env.CONFIG_DIR || process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = process.env.CONFIG_FILE || path.join(DATA_DIR, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function initialData() {
  return {
    user: null,
    categories: [
      { id: crypto.randomUUID(), name: 'Streaming', color: '#8b5cf6' },
      { id: crypto.randomUUID(), name: 'Software', color: '#22c55e' },
      { id: crypto.randomUUID(), name: 'Other', color: '#38bdf8' }
    ],
    reminders: [],
    settings: { discordWebhook: '' }
  };
}

fs.mkdirSync(DATA_DIR, { recursive: true });
let db;
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
catch { db = initialData(); save(); }

let migrated = false;
for (const category of db.categories || []) {
  if (category.name === 'Sonstiges') { category.name = 'Other'; migrated = true; }
}
if (migrated) save();

function save() {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, stored) {
  if (!stored?.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(`${salt}:${expected}`));
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'X-Subtrack-Version': APP_VERSION, ...headers });
  res.end(JSON.stringify(body));
}

async function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1))];
  }));
}

function session(req) {
  const current = sessions.get(cookies(req).session);
  if (!current || current.expires < Date.now()) return null;
  current.expires = Date.now() + SESSION_MAX_AGE;
  return current;
}

function requireAuth(req, res, mutating = false) {
  const current = session(req);
  if (!current) { json(res, 401, { error: 'Please sign in again.' }); return null; }
  if (mutating && req.headers['x-csrf-token'] !== current.csrf) {
    json(res, 403, { error: 'Invalid session.' }); return null;
  }
  return current;
}

function publicState(current) {
  return {
    user: { username: db.user.username, mustChangePassword: db.user.mustChangePassword },
    csrf: current.csrf,
    categories: db.categories,
    reminders: db.reminders,
    settings: { discordConfigured: Boolean(db.settings.discordWebhook), discordWebhook: db.settings.discordWebhook }
  };
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

async function sendDiscord(reminder, test = false) {
  const webhook = db.settings.discordWebhook;
  if (!webhook) throw new Error('No Discord webhook configured.');
  const category = db.categories.find(item => item.id === reminder.categoryId);
  const date = new Date(`${reminder.expiresAt}T12:00:00`).toLocaleDateString('en-GB', { dateStyle: 'long' });
  const payload = {
    username: 'Subtrack',
    embeds: [{
      title: test ? 'Test notification successful' : `${reminder.name} expires soon`,
      description: test ? 'Your Discord connection is working.' : `Your **${reminder.name}** subscription expires on **${date}**.`,
      color: 0x8b5cf6,
      fields: category ? [{ name: 'Category', value: category.name, inline: true }] : [],
      footer: { text: 'Subtrack · Subscription Reminder' }, timestamp: new Date().toISOString()
    }]
  };
  const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Discord returned status ${response.status}.`);
}

function reminderDue(reminder) {
  const due = new Date(`${reminder.expiresAt}T09:00:00`).getTime() - (Number(reminder.remindDays) || 0) * 86400000;
  return Date.now() >= due;
}

async function processDiscordReminders() {
  for (const reminder of db.reminders) {
    if (reminder.discord && !reminder.discordNotifiedAt && reminderDue(reminder) && db.settings.discordWebhook) {
      try { await sendDiscord(reminder); reminder.discordNotifiedAt = new Date().toISOString(); save(); }
      catch (error) { console.error('Discord notification failed:', error.message); }
    }
  }
}

async function api(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { status: 'ok', version: APP_VERSION });
  }

  if (pathname === '/api/setup-status' && req.method === 'GET') {
    return json(res, 200, { configured: Boolean(db.user) });
  }

  if (pathname === '/api/setup' && req.method === 'POST') {
    if (db.user) return json(res, 409, { error: 'The app is already configured.' });
    const input = await body(req);
    const username = String(input.username || '').trim();
    if (username.length < 2 || username.length > 40) return json(res, 400, { error: 'The username must be between 2 and 40 characters.' });
    db.user = { username, passwordHash: await hashPassword('admin'), mustChangePassword: true };
    save();
    return json(res, 201, { ok: true });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    if (!db.user) return json(res, 409, { error: 'Please create an admin account first.' });
    const input = await body(req);
    if (String(input.username || '').trim() !== db.user.username || !(await verifyPassword(String(input.password || ''), db.user.passwordHash))) {
      return json(res, 401, { error: 'Incorrect username or password.' });
    }
    const id = crypto.randomBytes(32).toString('hex');
    const current = { csrf: crypto.randomBytes(24).toString('hex'), expires: Date.now() + SESSION_MAX_AGE };
    sessions.set(id, current);
    return json(res, 200, publicState(current), { 'Set-Cookie': `session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}` });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const current = requireAuth(req, res, true); if (!current) return;
    sessions.delete(cookies(req).session);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    const current = requireAuth(req, res); if (!current) return;
    return json(res, 200, publicState(current));
  }

  if (pathname === '/api/password' && req.method === 'PUT') {
    const current = requireAuth(req, res, true); if (!current) return;
    const input = await body(req);
    console.log(`[security] Password change requested for user "${db.user.username}".`);
    if (!(await verifyPassword(String(input.currentPassword || ''), db.user.passwordHash))) {
      console.warn(`[security] Password change rejected for user "${db.user.username}": current password is incorrect.`);
      return json(res, 400, { error: 'The current password is incorrect.' });
    }
    if (!validPassword(input.newPassword)) {
      console.warn(`[security] Password change rejected for user "${db.user.username}": new password does not meet the policy.`);
      return json(res, 400, { error: 'Use at least 10 characters including uppercase, lowercase and a number.' });
    }
    db.user.passwordHash = await hashPassword(input.newPassword);
    db.user.mustChangePassword = false;
    save();
    console.log(`[security] Password changed successfully for user "${db.user.username}".`);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/categories' && req.method === 'POST') {
    const current = requireAuth(req, res, true); if (!current) return;
    const input = await body(req); const name = String(input.name || '').trim();
    if (!name || name.length > 30) return json(res, 400, { error: 'Enter a valid category name.' });
    const category = { id: crypto.randomUUID(), name, color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#8b5cf6' };
    db.categories.push(category); save(); return json(res, 201, category);
  }

  const categoryMatch = pathname.match(/^\/api\/categories\/([\w-]+)$/);
  if (categoryMatch && req.method === 'DELETE') {
    const current = requireAuth(req, res, true); if (!current) return;
    if (db.reminders.some(item => item.categoryId === categoryMatch[1])) return json(res, 409, { error: 'This category is still used by a reminder.' });
    db.categories = db.categories.filter(item => item.id !== categoryMatch[1]); save(); return json(res, 200, { ok: true });
  }

  if (pathname === '/api/reminders' && req.method === 'POST') {
    const current = requireAuth(req, res, true); if (!current) return;
    const input = await body(req);
    if (!String(input.name || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) return json(res, 400, { error: 'Name and expiration date are required.' });
    if (input.categoryId && !db.categories.some(item => item.id === input.categoryId)) return json(res, 400, { error: 'Unknown category.' });
    const reminder = {
      id: crypto.randomUUID(), name: String(input.name).trim().slice(0, 80), expiresAt: input.expiresAt,
      categoryId: input.categoryId || '', remindDays: Math.max(0, Math.min(365, Number(input.remindDays) || 0)),
      discord: Boolean(input.discord), browser: Boolean(input.browser), createdAt: new Date().toISOString(),
      discordNotifiedAt: null, browserNotifiedAt: null
    };
    db.reminders.push(reminder); save(); return json(res, 201, reminder);
  }

  const reminderMatch = pathname.match(/^\/api\/reminders\/([\w-]+)$/);
  if (reminderMatch && req.method === 'PUT') {
    const current = requireAuth(req, res, true); if (!current) return;
    const reminder = db.reminders.find(item => item.id === reminderMatch[1]);
    if (!reminder) return json(res, 404, { error: 'Reminder not found.' });
    const input = await body(req);
    if (!String(input.name || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) return json(res, 400, { error: 'Name and expiration date are required.' });
    Object.assign(reminder, { name: String(input.name).trim().slice(0, 80), expiresAt: input.expiresAt, categoryId: input.categoryId || '', remindDays: Math.max(0, Math.min(365, Number(input.remindDays) || 0)), discord: Boolean(input.discord), browser: Boolean(input.browser), discordNotifiedAt: null, browserNotifiedAt: null });
    save(); return json(res, 200, reminder);
  }
  if (reminderMatch && req.method === 'DELETE') {
    const current = requireAuth(req, res, true); if (!current) return;
    db.reminders = db.reminders.filter(item => item.id !== reminderMatch[1]); save(); return json(res, 200, { ok: true });
  }

  if (pathname === '/api/browser-notifications' && req.method === 'GET') {
    const current = requireAuth(req, res); if (!current) return;
    return json(res, 200, db.reminders.filter(item => item.browser && !item.browserNotifiedAt && reminderDue(item)));
  }
  const notificationMatch = pathname.match(/^\/api\/browser-notifications\/([\w-]+)$/);
  if (notificationMatch && req.method === 'POST') {
    const current = requireAuth(req, res, true); if (!current) return;
    const reminder = db.reminders.find(item => item.id === notificationMatch[1]);
    if (reminder) { reminder.browserNotifiedAt = new Date().toISOString(); save(); }
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/settings/discord' && req.method === 'PUT') {
    const current = requireAuth(req, res, true); if (!current) return;
    const input = await body(req); const webhook = String(input.webhook || '').trim();
    if (!webhook) return json(res, 400, { error: 'Discord webhook URL is required.' });
    if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhook)) return json(res, 400, { error: 'Enter a valid Discord webhook URL.' });
    db.settings.discordWebhook = webhook; save(); return json(res, 200, { configured: Boolean(webhook) });
  }
  if (pathname === '/api/settings/discord/test' && req.method === 'POST') {
    const current = requireAuth(req, res, true); if (!current) return;
    try { await sendDiscord({ name: 'Test', expiresAt: new Date().toISOString().slice(0, 10), categoryId: '' }, true); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 502, { error: error.message }); }
  }

  return json(res, 404, { error: 'Not found.' });
}

function staticFile(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(PUBLIC_DIR, `.${requested}`);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) return json(res, 403, { error: 'Forbidden.' });
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const cache = ['.html', '.js', '.css'].includes(path.extname(file)) ? 'no-store, no-cache, must-revalidate' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'X-Subtrack-Version': APP_VERSION });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (pathname.startsWith('/api/')) await api(req, res, pathname);
    else staticFile(req, res, pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, error.message === 'Invalid JSON' ? 400 : 500, { error: error.message === 'Invalid JSON' ? error.message : 'Interner Serverfehler.' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Subtrack is running at http://localhost:${PORT}`));
setInterval(processDiscordReminders, 60_000).unref();
setInterval(() => {
  for (const [id, value] of sessions) if (value.expires < Date.now()) sessions.delete(id);
}, 60 * 60 * 1000).unref();
processDiscordReminders();
