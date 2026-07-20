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
  region.classList.remove('hidden');
  setTimeout(() => {
    item.remove();
    if (!region.children.length) region.classList.add('hidden');
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

function reminderTimestamp(reminder) {
  return reminder.expiresAtUtc ? Date.parse(reminder.expiresAtUtc) : new Date(`${reminder.expiresAt}T23:59:59`).getTime();
}

function daysUntil(reminder) {
  const target = reminderTimestamp(reminder);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function formatDate(reminder) {
  if (reminder.expiresAtUtc) {
    return `${new Date(reminder.expiresAtUtc).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: reminder.timeZone
    })} (${reminder.timeZone})`;
  }
  return new Date(`${reminder.expiresAt}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function countdownText(reminder) {
  const difference = reminderTimestamp(reminder) - Date.now();
  if (difference <= 0) {
    const days = Math.floor(Math.abs(difference) / 86400000);
    return days === 0 ? 'Expired today' : `Expired ${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  if (!reminder.expiresAtUtc) {
    const days = daysUntil(reminder);
    return days === 0 ? 'Expires today' : `${days} ${days === 1 ? 'day' : 'days'} left`;
  }
  const days = Math.floor(difference / 86400000);
  const hours = Math.floor((difference % 86400000) / 3600000);
  if (days === 0 && hours === 0) return 'Less than 1 hour left';
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours || !days) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  return `${parts.join(' ')} left`;
}

function localDateValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function configureTimeZones(selected) {
  const select = $('#reminder-timezone');
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const zones = [...new Set([local, 'UTC', ...supported])];
  select.innerHTML = zones.map(zone => `<option value="${escapeHtml(zone)}">${escapeHtml(zone)}${zone === local ? ' (local)' : ''}</option>`).join('');
  select.value = zones.includes(selected) ? selected : local;
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
  $('#discord-mention-type').value = state.settings.discordMentionType || 'none';
  $('#discord-mention-id').value = state.settings.discordMentionId || '';
  updateMentionField();
  renderAll(); updateBrowserStatus(); startBrowserPolling();
  if (state.user.mustChangePassword) openPassword(true);
}

function renderAll() {
  renderReminders(); renderCategories(); renderCategoryOptions(); renderStats(); updateDiscordStatus();
}

function renderStats() {
  const soon = state.reminders.filter(item => daysUntil(item) <= 30 && daysUntil(item) >= 0).length;
  const anyDiscord = state.reminders.some(item => item.discord) && state.settings.discordConfigured;
  const anyBrowser = state.reminders.some(item => item.browser) && 'Notification' in window && Notification.permission === 'granted';
  $('#stat-active').textContent = state.reminders.length;
  $('#stat-soon').textContent = soon;
  $('#stat-channels').textContent = Number(anyDiscord) + Number(anyBrowser);
  $('#subscription-count').textContent = `${state.reminders.length} ${state.reminders.length === 1 ? 'entry' : 'entries'}`;
}

function renderReminders() {
  const reminders = [...state.reminders]
    .filter(item => filter === 'all' || (daysUntil(item) <= 30 && daysUntil(item) >= 0))
    .sort((a, b) => reminderTimestamp(a) - reminderTimestamp(b));
  $('#empty-state').classList.toggle('hidden', state.reminders.length > 0);
  $('#reminder-grid').classList.toggle('hidden', state.reminders.length === 0);
  $('#reminder-grid').innerHTML = reminders.map(reminder => {
    const category = state.categories.find(item => item.id === reminder.categoryId) || { name: 'No category', color: '#64748b' };
    const dayText = countdownText(reminder);
    return `<article class="reminder-card" style="--accent:${category.color}">
      <div class="card-top"><div class="service-icon">${escapeHtml(reminder.name.charAt(0))}</div><div class="card-menu"><button class="menu-button" data-menu="${reminder.id}" aria-label="Actions">•••</button><div class="card-menu-items"><button data-edit="${reminder.id}">Edit</button><button class="delete" data-delete="${reminder.id}">Delete</button></div></div></div>
      <span class="category-pill"><i></i>${escapeHtml(category.name)}</span><h3>${escapeHtml(reminder.name)}</h3><p class="expiry">Expires on <strong>${escapeHtml(formatDate(reminder))}</strong></p>
      <div class="countdown"><span class="days-left">Status<b>${dayText}</b></span><div class="channel-icons"><span class="${reminder.discord ? 'on' : ''}" title="Discord" aria-label="Discord ${reminder.discord ? 'enabled' : 'disabled'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8a12 12 0 0 1 8 0l2 8a14 14 0 0 1-3 1.5L13.5 16h-3L9 17.5A14 14 0 0 1 6 16z"/><circle cx="9.5" cy="12.5" r="1"/><circle cx="14.5" cy="12.5" r="1"/></svg></span><span class="${reminder.browser ? 'on' : ''}" title="Browser" aria-label="Browser ${reminder.browser ? 'enabled' : 'disabled'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></span></div></div>
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
  $('#reminder-date').value = reminder?.expiresAt || localDateValue(new Date(Date.now() + 30 * 86400000));
  $('#reminder-time').value = reminder?.expiresTime || '23:59';
  configureTimeZones(reminder?.timeZone);
  $('#reminder-category').value = reminder?.categoryId || '';
  $('#reminder-days').value = reminder?.remindDays ?? 7;
  $('#reminder-discord').checked = reminder?.discord || false;
  $('#reminder-browser').checked = reminder?.browser || false;
  $('#reminder-test-result').className = 'inline-result hidden';
  $('#reminder-test-result').textContent = '';
  updateDaysOutput(); updateReminderDiscordTestVisibility(); reminderDialog.showModal();
}

function updateDaysOutput() {
  const days = Number($('#reminder-days').value);
  $('#days-output').textContent = days === 0 ? 'On the same day' : `${days} ${days === 1 ? 'day' : 'days'}`;
}

function updateReminderDiscordTestVisibility() {
  $('#reminder-discord-test').classList.toggle('hidden', !$('#reminder-discord').checked);
}

function clearReminderTestResult() {
  $('#reminder-test-result').className = 'inline-result hidden';
  $('#reminder-test-result').textContent = '';
}

$$('[data-open-reminder]').forEach(button => button.addEventListener('click', () => openReminder()));
$('#reminder-days').addEventListener('input', updateDaysOutput);
$('#reminder-discord').addEventListener('change', () => { updateReminderDiscordTestVisibility(); clearReminderTestResult(); });
['#reminder-name', '#reminder-date', '#reminder-time', '#reminder-timezone', '#reminder-days'].forEach(selector => $(selector).addEventListener('input', clearReminderTestResult));
$('#test-reminder-discord').addEventListener('click', async () => {
  const result = $('#reminder-test-result');
  if (!state.settings.discordConfigured) {
    result.textContent = 'Save a Discord webhook in Settings before sending this test.';
    result.className = 'inline-result error';
    return;
  }
  const name = $('#reminder-name').value.trim();
  const expiresAt = $('#reminder-date').value;
  const expiresTime = $('#reminder-time').value;
  const timeZone = $('#reminder-timezone').value;
  if (!name || !expiresAt || !expiresTime || !timeZone) {
    result.textContent = 'Enter a subscription name, expiration date, time and timezone first.';
    result.className = 'inline-result error';
    return;
  }
  const button = $('#test-reminder-discord');
  button.disabled = true; button.textContent = 'Sending…';
  try {
    const response = await request('/api/reminders/discord-preview', { method: 'POST', body: JSON.stringify({ name, expiresAt, expiresTime, timeZone, categoryId: $('#reminder-category').value, remindDays: Number($('#reminder-days').value) }) });
    result.textContent = `Sent: ${response.title}`;
    result.className = 'inline-result success';
  } catch (error) {
    result.textContent = error.message;
    result.className = 'inline-result error';
  } finally { button.disabled = false; button.textContent = 'Send test'; }
});

$('#reminder-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#reminder-id').value;
  const payload = { name: $('#reminder-name').value, expiresAt: $('#reminder-date').value, expiresTime: $('#reminder-time').value, timeZone: $('#reminder-timezone').value, categoryId: $('#reminder-category').value, remindDays: Number($('#reminder-days').value), discord: $('#reminder-discord').checked, browser: $('#reminder-browser').checked };
  if (!payload.name.trim()) return showFormError('#reminder-error', 'Enter a subscription name.');
  if (!payload.expiresAt) return showFormError('#reminder-error', 'Choose an expiration date.');
  if (!payload.expiresTime || !payload.timeZone) return showFormError('#reminder-error', 'Choose an expiration time and timezone.');
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
['#reminder-name', '#reminder-date', '#reminder-time', '#reminder-timezone'].forEach(selector => $(selector).addEventListener('input', () => clearFormError('#reminder-error')));

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
  const mentionType = $('#discord-mention-type').value;
  const mentionId = $('#discord-mention-id').value.trim();
  if (['role', 'user'].includes(mentionType) && !/^\d{5,25}$/.test(mentionId)) return showFormError('#discord-error', `Enter a valid Discord ${mentionType} ID.`);
  try { const result = await request('/api/settings/discord', { method: 'PUT', body: JSON.stringify({ webhook, mentionType, mentionId }) }); state.settings.discordWebhook = webhook; state.settings.discordConfigured = result.configured; state.settings.discordMentionType = result.mentionType; state.settings.discordMentionId = result.mentionId; updateDiscordStatus(); renderStats(); clearFormError('#discord-error'); toast('Discord settings saved.'); }
  catch (error) { showFormError('#discord-error', error.message); }
});
$('#test-discord').addEventListener('click', async () => {
  if (!state.settings.discordConfigured) return showFormError('#discord-error', 'Save a Discord webhook URL before sending a test.');
  try { await request('/api/settings/discord/test', { method: 'POST' }); toast('Test message sent to Discord.'); }
  catch (error) { showFormError('#discord-error', error.message); }
});
$('#test-final-discord').addEventListener('click', async () => {
  clearFormError('#discord-error');
  if (!state.settings.discordConfigured) return showFormError('#discord-error', 'Save your Discord settings before testing the final ping.');
  if (!state.settings.discordMentionType || state.settings.discordMentionType === 'none') return showFormError('#discord-error', 'Choose and save a final reminder mention target first.');
  const mentionType = $('#discord-mention-type').value;
  const mentionId = ['role', 'user'].includes(mentionType) ? $('#discord-mention-id').value.trim() : '';
  if ($('#discord-webhook').value.trim() !== state.settings.discordWebhook || mentionType !== state.settings.discordMentionType || mentionId !== (state.settings.discordMentionId || '')) {
    return showFormError('#discord-error', 'Save your current Discord settings before testing the final ping.');
  }
  const button = $('#test-final-discord');
  button.disabled = true; button.textContent = 'Sending ping…';
  try {
    await request('/api/settings/discord/final-test', { method: 'POST' });
    toast('Final 1-day ping sent to Discord.');
  } catch (error) { showFormError('#discord-error', error.message); }
  finally { button.disabled = false; button.textContent = 'Test 1-day ping'; }
});
$('#discord-webhook').addEventListener('input', () => clearFormError('#discord-error'));
function updateMentionField() {
  const type = $('#discord-mention-type').value;
  const needsId = ['role', 'user'].includes(type);
  $('#discord-mention-id-field').classList.toggle('hidden', !needsId);
  $('#discord-mention-id-field').childNodes[0].textContent = type === 'user' ? 'User ID' : 'Role ID';
  $('#discord-mention-id').placeholder = type === 'user' ? 'e.g. user ID' : 'e.g. role ID';
}
$('#discord-mention-type').addEventListener('change', () => { updateMentionField(); clearFormError('#discord-error'); });
$('#discord-mention-id').addEventListener('input', () => clearFormError('#discord-error'));
$('#toggle-webhook').addEventListener('click', () => { const input = $('#discord-webhook'); const button = $('#toggle-webhook'); const reveal = input.type === 'password'; input.type = reveal ? 'url' : 'password'; button.textContent = reveal ? 'Hide' : 'Show'; button.setAttribute('aria-label', reveal ? 'Hide URL' : 'Show URL'); });

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
      await browserNotification(`${reminder.name} expires soon`, `Expiration date: ${formatDate(reminder)}`);
      await request(`/api/browser-notifications/${reminder.id}`, { method: 'POST' });
      const local = state.reminders.find(item => item.id === reminder.id); if (local) local.browserNotifiedAt = new Date().toISOString();
    }
  } catch (error) { console.error(error); }
}

function openPassword(forced = false) {
  $('#current-password').value = '';
  $('#new-password').value = '';
  $('#confirm-password').value = '';
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

$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
  const dialog = button.closest('dialog');
  if (dialog === passwordDialog && passwordDialog.dataset.forced === 'true') return;
  dialog?.close('cancel');
}));

$$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => {
  $$('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item === button));
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${button.dataset.view}-view`));
  const titles = { dashboard: 'Dashboard', categories: 'Categories', settings: 'Settings' };
  $('#view-title').textContent = titles[button.dataset.view]; $('.sidebar').classList.remove('open');
}));
$$('.filter').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; $$('.filter').forEach(item => item.classList.toggle('active', item === button)); renderReminders(); }));
$('#mobile-menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#logout').addEventListener('click', async () => { try { await request('/api/logout', { method: 'POST' }); } finally { state = null; location.reload(); } });

if (notificationCapability().supported) ensureServiceWorker().catch(error => console.warn('Service Worker registration failed:', error.message));
init();
