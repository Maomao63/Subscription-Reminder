const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state = null;
let setupMode = false;
let filter = 'all';

const authView = $('#auth-view');
const appView = $('#app');
const reminderDialog = $('#reminder-dialog');
const categoryDialog = $('#category-dialog');
const passwordDialog = $('#password-dialog');

async function request(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state?.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Etwas ist schiefgelaufen.');
  return payload;
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 4000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function daysUntil(date) {
  const target = new Date(`${date}T23:59:59`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function init() {
  try {
    state = await request('/api/state');
    showApp();
  } catch {
    const status = await request('/api/setup-status');
    setupMode = !status.configured;
    configureAuth();
  }
}

function configureAuth() {
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
  $('#auth-title').textContent = setupMode ? 'Richte Subtrack ein.' : 'Willkommen zurück.';
  $('#auth-subtitle').textContent = setupMode ? 'Wähle den Namen für dein lokales Administratorkonto.' : 'Melde dich an und behalte deine Abonnements im Blick.';
  $('#password-field').classList.toggle('hidden', setupMode);
  $('#password').required = !setupMode;
  $('#auth-action').textContent = setupMode ? 'Konto einrichten' : 'Anmelden';
  $('#auth-hint').innerHTML = setupMode ? 'Das Startpasswort lautet danach <b>admin</b>.' : 'Beim ersten Login lautet dein Passwort <b>admin</b>.';
}

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const username = $('#username').value.trim();
  try {
    if (setupMode) {
      await request('/api/setup', { method: 'POST', body: JSON.stringify({ username }) });
      setupMode = false; configureAuth(); $('#password').value = 'admin';
      toast('Konto erstellt. Melde dich jetzt an.');
      $('#password').focus();
      return;
    }
    state = await request('/api/login', { method: 'POST', body: JSON.stringify({ username, password: $('#password').value }) });
    showApp();
  } catch (error) { toast(error.message, 'error'); }
});

function showApp() {
  authView.classList.add('hidden'); appView.classList.remove('hidden');
  $('#greeting-name').textContent = state.user.username;
  $('#avatar').textContent = state.user.username.charAt(0).toUpperCase();
  $('#discord-webhook').value = state.settings.discordWebhook || '';
  renderAll(); updateBrowserStatus(); startBrowserPolling();
  if (state.user.mustChangePassword) openPassword(true);
}

function renderAll() {
  renderReminders(); renderCategories(); renderCategoryOptions(); renderStats(); updateDiscordStatus();
}

function renderStats() {
  const soon = state.reminders.filter(item => daysUntil(item.expiresAt) <= 30 && daysUntil(item.expiresAt) >= 0).length;
  const anyDiscord = state.reminders.some(item => item.discord) && state.settings.discordConfigured;
  const anyBrowser = state.reminders.some(item => item.browser) && 'Notification' in window && Notification.permission === 'granted';
  $('#stat-active').textContent = state.reminders.length;
  $('#stat-soon').textContent = soon;
  $('#stat-channels').textContent = Number(anyDiscord) + Number(anyBrowser);
  $('#subscription-count').textContent = `${state.reminders.length} ${state.reminders.length === 1 ? 'Eintrag' : 'Einträge'}`;
}

function renderReminders() {
  const reminders = [...state.reminders]
    .filter(item => filter === 'all' || (daysUntil(item.expiresAt) <= 30 && daysUntil(item.expiresAt) >= 0))
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  $('#empty-state').classList.toggle('hidden', state.reminders.length > 0);
  $('#reminder-grid').classList.toggle('hidden', state.reminders.length === 0);
  $('#reminder-grid').innerHTML = reminders.map(reminder => {
    const category = state.categories.find(item => item.id === reminder.categoryId) || { name: 'Ohne Kategorie', color: '#64748b' };
    const days = daysUntil(reminder.expiresAt);
    const dayText = days < 0 ? `Seit ${Math.abs(days)} Tagen abgelaufen` : days === 0 ? 'Läuft heute ab' : `Noch ${days} ${days === 1 ? 'Tag' : 'Tage'}`;
    return `<article class="reminder-card" style="--accent:${category.color}">
      <div class="card-top"><div class="service-icon">${escapeHtml(reminder.name.charAt(0))}</div><div class="card-menu"><button class="menu-button" data-menu="${reminder.id}" aria-label="Aktionen">•••</button><div class="card-menu-items"><button data-edit="${reminder.id}">Bearbeiten</button><button class="delete" data-delete="${reminder.id}">Löschen</button></div></div></div>
      <span class="category-pill"><i></i>${escapeHtml(category.name)}</span><h3>${escapeHtml(reminder.name)}</h3><p class="expiry">Ablauf am <strong>${formatDate(reminder.expiresAt)}</strong></p>
      <div class="countdown"><span class="days-left">Status<b>${dayText}</b></span><div class="channel-icons"><span class="${reminder.discord ? 'on' : ''}" title="Discord">D</span><span class="${reminder.browser ? 'on' : ''}" title="Browser">B</span></div></div>
    </article>`;
  }).join('');
}

function renderCategories() {
  $('#category-grid').innerHTML = state.categories.map(category => {
    const count = state.reminders.filter(item => item.categoryId === category.id).length;
    return `<article class="category-card" style="--accent:${category.color}"><button data-delete-category="${category.id}" aria-label="Kategorie löschen">×</button><div class="category-dot"></div><h3>${escapeHtml(category.name)}</h3><p>${count} ${count === 1 ? 'Abonnement' : 'Abonnements'}</p></article>`;
  }).join('');
}

function renderCategoryOptions() {
  $('#reminder-category').innerHTML = '<option value="">Ohne Kategorie</option>' + state.categories.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
}

function updateDiscordStatus() {
  const status = $('#discord-status');
  status.textContent = state.settings.discordConfigured ? 'Verbunden' : 'Nicht verbunden';
  status.className = `badge ${state.settings.discordConfigured ? 'connected' : ''}`;
}

function updateBrowserStatus() {
  if (!('Notification' in window)) {
    $('#browser-status').textContent = 'Nicht unterstützt';
    $('#browser-status').className = 'badge denied';
    $('#enable-browser').disabled = true;
    return;
  }
  const status = $('#browser-status');
  const labels = { granted: 'Aktiv', denied: 'Blockiert', default: 'Nicht aktiviert' };
  status.textContent = labels[Notification.permission];
  status.className = `badge ${Notification.permission === 'granted' ? 'connected' : Notification.permission === 'denied' ? 'denied' : ''}`;
  $('#enable-browser').textContent = Notification.permission === 'granted' ? 'Testbenachrichtigung senden' : 'Benachrichtigungen aktivieren';
}

function openReminder(reminder = null) {
  $('#reminder-form').reset();
  $('#reminder-id').value = reminder?.id || '';
  $('#reminder-dialog-title').textContent = reminder ? 'Reminder bearbeiten' : 'Reminder hinzufügen';
  $('#reminder-name').value = reminder?.name || '';
  $('#reminder-date').value = reminder?.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  $('#reminder-category').value = reminder?.categoryId || '';
  $('#reminder-days').value = reminder?.remindDays ?? 7;
  $('#reminder-discord').checked = reminder?.discord || false;
  $('#reminder-browser').checked = reminder?.browser || false;
  updateDaysOutput(); reminderDialog.showModal();
}

function updateDaysOutput() {
  const days = Number($('#reminder-days').value);
  $('#days-output').textContent = days === 0 ? 'Am selben Tag' : `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
}

$$('[data-open-reminder]').forEach(button => button.addEventListener('click', () => openReminder()));
$('#reminder-days').addEventListener('input', updateDaysOutput);

$('#reminder-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#reminder-id').value;
  const payload = { name: $('#reminder-name').value, expiresAt: $('#reminder-date').value, categoryId: $('#reminder-category').value, remindDays: Number($('#reminder-days').value), discord: $('#reminder-discord').checked, browser: $('#reminder-browser').checked };
  try {
    const saved = await request(id ? `/api/reminders/${id}` : '/api/reminders', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    if (id) state.reminders[state.reminders.findIndex(item => item.id === id)] = saved; else state.reminders.push(saved);
    reminderDialog.close(); renderAll(); toast(id ? 'Reminder aktualisiert.' : 'Reminder hinzugefügt.');
    if (payload.browser && 'Notification' in window && Notification.permission === 'default') toast('Aktiviere Browser Pop-ups in den Einstellungen.', 'error');
  } catch (error) { toast(error.message, 'error'); }
});

$('#reminder-grid').addEventListener('click', async event => {
  const menu = event.target.closest('[data-menu]');
  if (menu) { $$('.card-menu').forEach(item => item.classList.toggle('open', item === menu.parentElement && !item.classList.contains('open'))); return; }
  const edit = event.target.closest('[data-edit]');
  if (edit) { openReminder(state.reminders.find(item => item.id === edit.dataset.edit)); return; }
  const remove = event.target.closest('[data-delete]');
  if (remove && confirm('Diesen Reminder wirklich löschen?')) {
    try { await request(`/api/reminders/${remove.dataset.delete}`, { method: 'DELETE' }); state.reminders = state.reminders.filter(item => item.id !== remove.dataset.delete); renderAll(); toast('Reminder gelöscht.'); }
    catch (error) { toast(error.message, 'error'); }
  }
});

$('#open-category').addEventListener('click', () => { $('#category-form').reset(); $('#category-color').value = '#8b5cf6'; categoryDialog.showModal(); });
$('#category-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { const category = await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: $('#category-name').value, color: $('#category-color').value }) }); state.categories.push(category); categoryDialog.close(); renderAll(); toast('Kategorie hinzugefügt.'); }
  catch (error) { toast(error.message, 'error'); }
});
$('#category-grid').addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-category]');
  if (!button || !confirm('Diese Kategorie wirklich löschen?')) return;
  try { await request(`/api/categories/${button.dataset.deleteCategory}`, { method: 'DELETE' }); state.categories = state.categories.filter(item => item.id !== button.dataset.deleteCategory); renderAll(); toast('Kategorie gelöscht.'); }
  catch (error) { toast(error.message, 'error'); }
});

$('#discord-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { const result = await request('/api/settings/discord', { method: 'PUT', body: JSON.stringify({ webhook: $('#discord-webhook').value }) }); state.settings.discordWebhook = $('#discord-webhook').value.trim(); state.settings.discordConfigured = result.configured; updateDiscordStatus(); renderStats(); toast('Discord-Einstellungen gespeichert.'); }
  catch (error) { toast(error.message, 'error'); }
});
$('#test-discord').addEventListener('click', async () => {
  try { await request('/api/settings/discord/test', { method: 'POST' }); toast('Testnachricht wurde an Discord gesendet.'); }
  catch (error) { toast(error.message, 'error'); }
});
$('#toggle-webhook').addEventListener('click', () => { const input = $('#discord-webhook'); input.type = input.type === 'password' ? 'url' : 'password'; });

async function browserNotification(title = 'Subtrack ist bereit', body = 'Browser-Benachrichtigungen funktionieren.') {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, { body, icon: '/icon.svg', badge: '/icon.svg', tag: `subtrack-${title}` });
}

$('#enable-browser').addEventListener('click', async () => {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return toast('Dein Browser unterstützt diese Funktion nicht.', 'error');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  updateBrowserStatus(); renderStats();
  if (permission === 'granted') browserNotification(); else toast('Die Berechtigung wurde nicht erteilt.', 'error');
});
$('#notification-bell').addEventListener('click', () => $('#enable-browser').click());

let pollingStarted = false;
function startBrowserPolling() {
  if (pollingStarted) return; pollingStarted = true;
  checkBrowserNotifications(); setInterval(checkBrowserNotifications, 60_000);
}
async function checkBrowserNotifications() {
  if (!state || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const pending = await request('/api/browser-notifications');
    for (const reminder of pending) {
      await browserNotification(`${reminder.name} läuft bald ab`, `Ablaufdatum: ${formatDate(reminder.expiresAt)}`);
      await request(`/api/browser-notifications/${reminder.id}`, { method: 'POST' });
      const local = state.reminders.find(item => item.id === reminder.id); if (local) local.browserNotifiedAt = new Date().toISOString();
    }
  } catch (error) { console.error(error); }
}

function openPassword(forced = false) {
  $('#password-form').reset();
  $('#password-close').classList.toggle('hidden', forced);
  $('.password-cancel').classList.toggle('hidden', forced);
  passwordDialog.dataset.forced = String(forced);
  passwordDialog.showModal();
}
$('#open-password').addEventListener('click', () => openPassword(false));
passwordDialog.addEventListener('cancel', event => { if (passwordDialog.dataset.forced === 'true') event.preventDefault(); });
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const next = $('#new-password').value;
  if (next !== $('#confirm-password').value) return toast('Die neuen Passwörter stimmen nicht überein.', 'error');
  try { await request('/api/password', { method: 'PUT', body: JSON.stringify({ currentPassword: $('#current-password').value, newPassword: next }) }); state.user.mustChangePassword = false; passwordDialog.close(); toast('Dein Passwort wurde sicher gespeichert.'); }
  catch (error) { toast(error.message, 'error'); }
});

$$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => {
  $$('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item === button));
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${button.dataset.view}-view`));
  $('#view-title').textContent = button.textContent.trim(); $('.sidebar').classList.remove('open');
}));
$$('.filter').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; $$('.filter').forEach(item => item.classList.toggle('active', item === button)); renderReminders(); }));
$('#mobile-menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#logout').addEventListener('click', async () => { try { await request('/api/logout', { method: 'POST' }); } finally { state = null; location.reload(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
init();
