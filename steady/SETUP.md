# Steady: setup

Steady is a static web app (no build, no dependencies). Host the `steady/` folder anywhere that serves HTTPS, then "install" it on your phone and desktop.

## 1. Host it (pick one, all free)
- **Netlify Drop**: go to app.netlify.com/drop and drag the `steady` folder in. You get an https URL.
- **Cloudflare Pages / GitHub Pages**: point at this folder.
- **Quick local test**: `cd steady && python3 -m http.server 8123`, then open http://localhost:8123

## 2. Install
- **iPhone**: open the URL in Safari, then Share, then Add to Home Screen.
- **Android**: Chrome menu, then Install app.
- **Desktop**: Chrome or Edge, install icon in the address bar.

## 3. Sync phone and desktop through your Google Drive (optional)
Data is stored on each device. To keep them in step:
1. Go to console.cloud.google.com, create a project, and enable the **Google Drive API**.
2. APIs & Services, then Credentials, then Create credentials, then **OAuth client ID**, type **Web application**.
3. Under **Authorized JavaScript origins**, add your hosted URL (for example `https://yourname.netlify.app`).
4. Configure the OAuth consent screen (External; add yourself as a test user).
5. Copy the Client ID. In Steady go to More, then Backup & Google Drive sync, paste it, and tap Connect.

Steady only requests the private `drive.appdata` scope, a hidden app folder nobody else can see. Do the same Connect step on your other device. Changes merge per item (newest edit wins).

Without Drive sync, use More, then Backup, then Download backup / Restore from file.

## Reminders
Browsers can't reliably fire alarms while the app is closed. For real nagging on hard deadlines and bills, use More, then Export deadline reminders (.ics) and open the file on your phone to add alerts to your calendar.
