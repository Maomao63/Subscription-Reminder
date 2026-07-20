# Subtrack

Ein selbst gehosteter Subscription-Reminder mit moderner Graphit-Oberfläche, Kategorien, Discord-Webhooks und nativen Browser-Benachrichtigungen.

## Start mit Docker Compose

```bash
docker compose up -d --build
```

Danach `http://localhost:3000` öffnen. Beim ersten Start einen Benutzernamen wählen, anschließend mit dem Startpasswort `admin` anmelden. Subtrack verlangt direkt ein neues sicheres Passwort.

Die Daten liegen im Docker-Volume `subtrack-data` und bleiben bei Container-Updates erhalten.

## Als Docker-Image bauen

```bash
docker build -t deinname/subtrack:latest .
docker run -d --name subtrack -p 3000:3000 -v subtrack-data:/app/data --restart unless-stopped deinname/subtrack:latest
```

Zum Veröffentlichen in Docker Hub:

```bash
docker login
docker push deinname/subtrack:latest
```

## Benachrichtigungen

- **Discord:** In den Einstellungen eine Discord-Webhook-URL eintragen und mit „Test senden“ prüfen. Der Server prüft fällige Reminder jede Minute, auch wenn das Web-UI geschlossen ist.
- **Browser/Windows:** Berechtigung in den Einstellungen aktivieren. Browser-Pop-ups werden getrennt von Discord konfiguriert und erscheinen, solange Subtrack in einem Browser-Tab geöffnet ist. Außer auf `localhost` benötigen Browser-Benachrichtigungen eine HTTPS-Verbindung.

## Lokale Entwicklung

Node.js 20 oder neuer wird benötigt. Es gibt keine externen Laufzeit-Abhängigkeiten.

```bash
npm start
```

Optional können `PORT` und `DATA_DIR` als Umgebungsvariablen gesetzt werden.
