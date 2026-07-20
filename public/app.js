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
  const region = $('#toast-region');
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  region.append(item);
  if ('showPopover' in region) {
    try { if (!region.matches(':popover-open')) region.showPopover(); } catch {}
  }
  setTimeout(() => {
    item.remove();
    if (!region.children.length && 'hidePopover' in region) {
      try { region.hidePopover(); } catch {}
    }
  }, 5000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function showFormError(id, message) {
  const element = $(id);
  element.textContent = message;
  element.classList.remove('hidden');
}

function clearFormError(id) {
  const element = $(id);
  element.textContent = '';
  element.classList.add('hidden');
}

function daysUntil(date) {
  const target = new Date(`${date}T23:59:59`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
  $('#auth-title').textContent = setupMode ? 'Create admin account' : 'Welcome back.';
  $('#auth-subtitle').textContent = setupMode ? 'Choose a username for your local administrator account.' : 'Sign in to keep your subscriptions under control.';
  $('#password-field').classList.toggle('hidden', setupMode);
  $('#password').required = !setupMode;
  $('#auth-action').textContent = setupMode ? 'Create admin account' : 'Sign in';
  $('#auth-hint').innerHTML = setupMode ? 'Your initial password will be <b>admin</b>.' : 'For your first sign-in, use the password <b>admin</b>.';
}

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const username = $('#username').value.trim();
  try {
    if (setupMode) {
      await request('/api/setup', { method: 'POST', body: JSON.stringify({ username }) });
      setupMode = false; configureAuth(); $('#password').value = 'admin';
      toast('Admin account created. Sign in to continue.');
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
  $('#subscription-count').textContent = `${state.reminders.length} ${state.reminders.length === 1 ? 'entry' : 'entries'}`;
}

function renderReminders() {
  const reminders = [...state.reminders]
    .filter(item => filter === 'all' || (daysUntil(item.expiresAt) <= 30 && daysUntil(item.expiresAt) >= 0))
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  $('#empty-state').classList.toggle('hidden', state.reminders.length > 0);
  $('#reminder-grid').classList.toggle('hidden', state.reminders.length === 0);
  $('#reminder-grid').innerHTML = reminders.map(reminder => {
    const category = state.categories.find(item => item.id === reminder.categoryId) || { name: 'No category', color: '#64748b' };
    const days = daysUntil(reminder.expiresAt);
    const dayText = days < 0 ? `Expired ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago` : days === 0 ? 'Expires today' : `${days} ${days === 1 ? 'day' : 'days'} left`;
    return `<article class="reminder-card" style="--accent:${category.color}">
      <div class="card-top"><div class="service-icon">${escapeHtml(reminder.name.charAt(0))}</div><div class="card-menu"><button class="menu-button" data-menu="${reminder.id}" aria-label="Actions">•••</button><div class="card-menu-items"><button data-edit="${reminder.id}">Edit</button><button class="delete" data-delete="${reminder.id}">Delete</button></div></div></div>
      <span class="category-pill"><i></i>${escapeHtml(category.name)}</span><h3>${escapeHtml(reminder.name)}</h3><p class="expiry">Expires on <strong>${formatDate(reminder.expiresAt)}</strong></p>
      <div class="countdown"><span class="days-left">Status<b>${dayText}</b></span><div class="channel-icons"><span class="${reminder.discord ? 'on' : ''}" title="Discord">D</span><span class="${reminder.browser ? 'on' : ''}" title="Browser">B</span></div></div>
    </article>`;
  }).join('');
}

function renderCategories() {
  $('#category-grid').innerHTML = state.categories.map(category => {
    const count = state.reminders.filter(item => item.categoryId === category.id).length;
    return `<article class="category-card" style="--accent:${category.color}"><button data-delete-category="${category.id}" aria-label="Delete category">×</button><div class="category-dot"></div><h3>${escapeHtml(category.name)}</h3><p>${count} ${count === 1 ? 'subscription' : 'subscriptions'}</p></article>`;
  }).join('');
}

function renderCategoryOptions() {
  $('#reminder-category').innerHTML = '<option value="">No category</option>' + state.categories.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
}

function updateDiscordStatus() {
  const status = $('#discord-status');
  status.textContent = state.settings.discordConfigured ? 'Connected' : 'Not connected';
  status.className = `badge ${state.settings.discordConfigured ? 'connected' : ''}`;
}

function notificationCapability() {
  if (!window.isSecureContext) return { supported: false, reason: 'secure-context' };
  if (!('Notification' in window)) return { supported: false, reason: 'notifications-api' };
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'service-worker' };
  return { supported: true };
}

function updateBrowserStatus() {
  const capability = notificationCapability();
  const help = $('#browser-help');
  const button = $('#enable-browser');
  if (!capability.supported) {
    const needsHttps = capability.reason === 'secure-context';
    $('#browser-status').textContent = needsHttps ? 'HTTPS required' : 'Unavailable';
    $('#browser-status').className = 'badge denied';
    help.textContent = needsHttps
      ? 'Native system notifications require a secure HTTPS connection. Plain HTTP is only allowed on localhost; an Unraid IP address over HTTP is not considered secure by browsers.'
      : 'This browser does not provide the Notification and Service Worker APIs required for native system notifications.';
    button.textContent = needsHttps ? 'Open Subtrack through HTTPS' : 'Notifications unavailable';
    button.disabled = true;
    return;
  }
  const status = $('#browser-status');
  const labels = { granted: 'Enabled', denied: 'Blocked', default: 'Not enabled' };
  status.textContent = labels[Notification.permission];
  status.className = `badge ${Notification.permission === 'granted' ? 'connected' : Notification.permission === 'denied' ? 'denied' : ''}`;
  help.textContent = Notification.permission === 'denied'
    ? 'Notifications are blocked in this browser. Allow them in the site permissions and reload Subtrack.'
    : 'Your browser asks for permission once. Due reminders then appear as native system notifications while Subtrack is open.';
  button.textContent = Notification.permission === 'granted' ? 'Send test notification' : 'Enable notifications';
  button.disabled = Notification.permission === 'denied';
}

function openReminder(reminder = null) {
  $('#reminder-form').reset();
  clearFormError('#reminder-error');
  $('#reminder-id').value = reminder?.id || '';
  $('#reminder-dialog-title').textContent = reminder ? 'Edit reminder' : 'Add reminder';
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
  $('#days-output').textContent = days === 0 ? 'On the same day' : `${days} ${days === 1 ? 'day' : 'days'}`;
}

$$('[data-open-reminder]').forEach(button => button.addEventListener('click', () => openReminder()));
$('#reminder-days').addEventListener('input', updateDaysOutput);

$('#reminder-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#reminder-id').value;
  const payload = { name: $('#reminder-name').value, expiresAt: $('#reminder-date').value, categoryId: $('#reminder-category').value, remindDays: Number($('#reminder-days').value), discord: $('#reminder-discord').checked, browser: $('#reminder-browser').checked };
  if (!payload.name.trim()) return showFormError('#reminder-error', 'Enter a subscription name.');
  if (!payload.expiresAt) return showFormError('#reminder-error', 'Choose an expiration date.');
  try {
    const saved = await request(id ? `/api/reminders/${id}` : '/api/reminders', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    if (id) state.reminders[state.reminders.findIndex(item => item.id === id)] = saved; else state.reminders.push(saved);
    reminderDialog.close(); renderAll(); toast(id ? 'Reminder updated.' : 'Reminder added.');
    if (payload.browser) {
      const capability = notificationCapability();
      if (!capability.supported) toast(capability.reason === 'secure-context' ? 'Browser pop-ups require HTTPS when Subtrack is opened from another device.' : 'Browser pop-ups are unavailable in this browser.', 'error');
      else if (Notification.permission === 'default') toast('Enable browser pop-ups in Settings.', 'error');
    }
  } catch (error) { showFormError('#reminder-error', error.message); }
});
['#reminder-name', '#reminder-date'].forEach(selector => $(selector).addEventListener('input', () => clearFormError('#reminder-error')));

$('#reminder-grid').addEventListener('click', async event => {
  const menu = event.target.closest('[data-menu]');
  if (menu) { $$('.card-menu').forEach(item => item.classList.toggle('open', item === menu.parentElement && !item.classList.contains('open'))); return; }
  const edit = event.target.closest('[data-edit]');
  if (edit) { openReminder(state.reminders.find(item => item.id === edit.dataset.edit)); return; }
  const remove = event.target.closest('[data-delete]');
  if (remove && confirm('Delete this reminder?')) {
    try { await request(`/api/reminders/${remove.dataset.delete}`, { method: 'DELETE' }); state.reminders = state.reminders.filter(item => item.id !== remove.dataset.delete); renderAll(); toast('Reminder deleted.'); }
    catch (error) { toast(error.message, 'error'); }
  }
});

$('#open-category').addEventListener('click', () => { $('#category-form').reset(); clearFormError('#category-error'); $('#category-color').value = '#8b5cf6'; categoryDialog.showModal(); });
$('#category-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('#category-name').value.trim();
  if (!name) return showFormError('#category-error', 'Enter a category name.');
  try { const category = await request('/api/categories', { method: 'POST', body: JSON.stringify({ name, color: $('#category-color').value }) }); state.categories.push(category); categoryDialog.close(); renderAll(); toast('Category added.'); }
  catch (error) { showFormError('#category-error', error.message); }
});
$('#category-name').addEventListener('input', () => clearFormError('#category-error'));
$('#category-grid').addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-category]');
  if (!button || !confirm('Delete this category?')) return;
  try { await request(`/api/categories/${button.dataset.deleteCategory}`, { method: 'DELETE' }); state.categories = state.categories.filter(item => item.id !== button.dataset.deleteCategory); renderAll(); toast('Category deleted.'); }
  catch (error) { toast(error.message, 'error'); }
});

$('#discord-form').addEventListener('submit', async event => {
  event.preventDefault();
  const webhook = $('#discord-webhook').value.trim();
  if (!webhook) return showFormError('#discord-error', 'Enter a Discord webhook URL before saving.');
  try { const result = await request('/api/settings/discord', { method: 'PUT', body: JSON.stringify({ webhook }) }); state.settings.discordWebhook = webhook; state.settings.discordConfigured = result.configured; updateDiscordStatus(); renderStats(); clearFormError('#discord-error'); toast('Discord settings saved.'); }
  catch (error) { showFormError('#discord-error', error.message); }
});
$('#test-discord').addEventListener('click', async () => {
  if (!state.settings.discordConfigured) return showFormError('#discord-error', 'Save a Discord webhook URL before sending a test.');
  try { await request('/api/settings/discord/test', { method: 'POST' }); toast('Test message sent to Discord.'); }
  catch (error) { showFormError('#discord-error', error.message); }
});
$('#discord-webhook').addEventListener('input', () => clearFormError('#discord-error'));
$('#toggle-webhook').addEventListener('click', () => { const input = $('#discord-webhook'); input.type = input.type === 'password' ? 'url' : 'password'; });

let serviceWorkerRegistration;
async function ensureServiceWorker() {
  if (!notificationCapability().supported) throw new Error('A secure HTTPS connection is required for browser notifications.');
  if (!serviceWorkerRegistration) {
    serviceWorkerRegistration = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
  }
  return serviceWorkerRegistration;
}

async function browserNotification(title = 'Subtrack is ready', body = 'Browser notifications are working.') {
  const registration = await ensureServiceWorker();
  await registration.showNotification(title, { body, icon: '/icon.svg', badge: '/icon.svg', tag: `subtrack-${title}` });
}

$('#enable-browser').addEventListener('click', async () => {
  clearFormError('#browser-error');
  const capability = notificationCapability();
  if (!capability.supported) return showFormError('#browser-error', capability.reason === 'secure-context' ? 'HTTPS is required. Use a trusted reverse proxy URL instead of an HTTP IP address.' : 'The required browser APIs are unavailable.');
  try {
    await ensureServiceWorker();
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    updateBrowserStatus(); renderStats();
    if (permission === 'granted') await browserNotification();
    else showFormError('#browser-error', 'Notification permission was not granted.');
  } catch (error) { showFormError('#browser-error', error.message); }
});
$('#notification-bell').addEventListener('click', () => {
  document.querySelector('.nav-item[data-view="settings"]').click();
  const card = $('#browser-settings-card');
  card.classList.add('attention');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => card.classList.remove('attention'), 1800);
});

let pollingStarted = false;
function startBrowserPolling() {
  if (pollingStarted) return; pollingStarted = true;
  checkBrowserNotifications(); setInterval(checkBrowserNotifications, 60_000);
}
async function checkBrowserNotifications() {
  if (!state || !notificationCapability().supported || Notification.permission !== 'granted') return;
  try {
    const pending = await request('/api/browser-notifications');
    for (const reminder of pending) {
      await browserNotification(`${reminder.name} expires soon`, `Expiration date: ${formatDate(reminder.expiresAt)}`);
      await request(`/api/browser-notifications/${reminder.id}`, { method: 'POST' });
      const local = state.reminders.find(item => item.id === reminder.id); if (local) local.browserNotifiedAt = new Date().toISOString();
    }
  } catch (error) { console.error(error); }
}

function openPassword(forced = false) {
  $('#password-form').reset();
  $('#password-error').classList.add('hidden');
  $('#password-error').textContent = '';
  $('#current-password').placeholder = forced ? 'Initial password: admin' : '';
  $('#password-close').classList.toggle('hidden', forced);
  $('.password-cancel').classList.toggle('hidden', forced);
  passwordDialog.dataset.forced = String(forced);
  passwordDialog.showModal();
}
$('#open-password').addEventListener('click', () => openPassword(false));
passwordDialog.addEventListener('cancel', event => { if (passwordDialog.dataset.forced === 'true') event.preventDefault(); });
function showPasswordError(message) {
  showFormError('#password-error', message);
}
['#current-password', '#new-password', '#confirm-password'].forEach(selector => $(selector).addEventListener('input', () => clearFormError('#password-error')));
let passwordSaving = false;
async function savePassword() {
  if (passwordSaving) return;
  const current = $('#current-password').value;
  const next = $('#new-password').value;
  if (!current) return showPasswordError('Enter your current password. For the first sign-in, use admin.');
  if (!next) return showPasswordError('Enter a new password.');
  if (next !== $('#confirm-password').value) return showPasswordError('The new passwords do not match.');
  if (next.length < 10 || !/[a-z]/.test(next) || !/[A-Z]/.test(next) || !/\d/.test(next)) {
    return showPasswordError('Use at least 10 characters including uppercase, lowercase and a number.');
  }
  const submit = $('#password-submit');
  passwordSaving = true;
  submit.disabled = true;
  submit.textContent = 'Saving…';
  try {
    await request('/api/password', { method: 'PUT', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    state.user.mustChangePassword = false;
    passwordDialog.close();
    toast('Your password has been saved securely.');
  } catch (error) {
    showPasswordError(error.message);
  } finally {
    passwordSaving = false;
    submit.disabled = false;
    submit.textContent = 'Save password';
  }
}
$('#password-submit').addEventListener('click', savePassword);
$('#password-form').addEventListener('submit', event => { event.preventDefault(); savePassword(); });

$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
  const dialog = button.closest('dialog');
  if (dialog === passwordDialog && passwordDialog.dataset.forced === 'true') return;
  dialog?.close('cancel');
}));

$$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => {
  $$('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item === button));
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${button.dataset.view}-view`));
  $('#view-title').textContent = button.textContent.trim(); $('.sidebar').classList.remove('open');
}));
$$('.filter').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; $$('.filter').forEach(item => item.classList.toggle('active', item === button)); renderReminders(); }));
$('#mobile-menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#logout').addEventListener('click', async () => { try { await request('/api/logout', { method: 'POST' }); } finally { state = null; location.reload(); } });

if (notificationCapability().supported) ensureServiceWorker().catch(error => console.warn('Service Worker registration failed:', error.message));
init();
