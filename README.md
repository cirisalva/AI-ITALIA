# AI Italia

Repository unico per **AI Italia**.

## GitHub Pages
I file dell'app PWA sono nella root del repository:
- `index.html`
- `icon-180.png`
- `icon-192.png`
- `icon-512.png`
- `manifest.webmanifest`
- `sw.js`

Questa parte può essere pubblicata con GitHub Pages.

## Backend
Il codice del backend è nella cartella `backend/`.

Il backend **non viene eseguito da GitHub Pages**: deve essere pubblicato su un servizio server compatibile (per esempio Render/Railway/VPS).

## Sicurezza
Non caricare mai il file `backend/.env` su GitHub.
La chiave API deve restare nelle variabili d'ambiente del servizio backend.
