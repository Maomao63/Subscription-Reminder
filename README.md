# Subscription Reminder · Subtrack

Ein selbst gehosteter Subscription-Reminder mit moderner Graphit-Oberfläche, Kategorien, Discord-Webhooks und nativen Browser-Benachrichtigungen.

## Unraid – direkt als fertiges Image starten

Das Image wird bei jedem Push automatisch für `amd64` und `arm64` gebaut und in der GitHub Container Registry veröffentlicht.

```bash
docker run -d \
  --name subscription-reminder \
  -p 13000:13000 \
  -v /mnt/user/appdata/subscription-reminder:/config \
  --restart unless-stopped \
  ghcr.io/maomao63/subscription-reminder:latest
```

Danach `http://UNRAID-IP:13000` öffnen.

Alle Einstellungen befinden sich gemeinsam in:

```text
/mnt/user/appdata/subscription-reminder/config.json
```

Die Datei enthält den Benutzer, den sicheren Passwort-Hash, Kategorien, Reminder, Benachrichtigungsstatus und den Discord-Webhook. Sie sollte deshalb nicht öffentlich geteilt werden.

## Docker Compose – Unraid

```bash
docker compose pull
docker compose up -d
```

Die mitgelieferte `docker-compose.yml` verwendet standardmäßig:

- Image: `ghcr.io/maomao63/subscription-reminder:latest`
- Port: `13000:13000`
- Config-Pfad: `./config`
- Zeitzone: `Europe/Berlin`
- Pull-Policy: `always`

Für Unraid eine `.env` neben der Compose-Datei anlegen:

```env
CONFIG_PATH=/mnt/user/appdata/subscription-reminder
TZ=Europe/Berlin
PUID=99
PGID=100
```

## Andere Linux-Server

Der Speicherort ist frei wählbar. Lege neben der Compose-Datei eine `.env` an:

```env
CONFIG_PATH=/opt/subscription-reminder
TZ=Europe/Berlin
PUID=1000
PGID=1000
```

Ohne `.env` wird automatisch der relative Ordner verwendet:

```env
CONFIG_PATH=./config
```

Anschließend:

```bash
mkdir -p /opt/subscription-reminder
sudo chown -R 1000:1000 /opt/subscription-reminder
docker compose pull
docker compose up -d
```

Der Container speichert immer nach `/config/config.json`; nur die linke Seite des Volume-Mounts wird über `CONFIG_PATH` geändert.

`PUID` und `PGID` bestimmen, welchem Host-Benutzer die Config-Dateien gehören. Die Standardwerte `99:100` entsprechen Unraid (`nobody:users`). Auf normalen Linux-Systemen ist für den ersten Benutzer häufig `1000:1000` passend. Das Startskript korrigiert die Rechte des gemounteten Config-Ordners automatisch und startet Node danach ohne Root-Rechte.

## Erster Login

Beim ersten Start einen Benutzernamen wählen und anschließend mit dem Startpasswort `admin` anmelden. Subtrack verlangt direkt ein neues sicheres Passwort.

## Benachrichtigungen

- **Discord:** In den Einstellungen eine Discord-Webhook-URL eintragen und mit „Test senden“ prüfen. Jeder Reminder sendet zuerst zum gewählten Vorlauf (z. B. „30 days left“) und zusätzlich einen finalen Hinweis einen Tag vor Ablauf. Für den finalen Hinweis kann eine Discord-Rolle, ein Benutzer, `@everyone` oder `@here` als Ping-Ziel gewählt werden. Im Reminder-Dialog lässt sich die Nachricht vorab ohne Ping testen. Der Server kontrolliert fällige Reminder jede Minute, auch wenn das Web-UI geschlossen ist.
- **Browser/Windows:** Berechtigung in den Einstellungen aktivieren. Browser-Pop-ups funktionieren unabhängig von Discord und erscheinen, solange Subtrack in einem Browser-Tab geöffnet ist. Außer auf `localhost` benötigen Browser-Benachrichtigungen HTTPS.

## Image aktualisieren

```bash
docker compose pull
docker compose up -d
```

Da `/config` als Host-Verzeichnis eingebunden ist, bleiben alle Daten bei Updates und Container-Neuerstellungen erhalten.

## Lokale Entwicklung

Node.js 20 oder neuer wird benötigt. Externe Laufzeit-Abhängigkeiten gibt es nicht.

```bash
npm start
```

Optional stehen `PORT`, `CONFIG_DIR` und `CONFIG_FILE` als Umgebungsvariablen zur Verfügung.
