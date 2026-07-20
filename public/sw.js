self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => list[0] ? list[0].focus() : clients.openWindow('/')));
});
