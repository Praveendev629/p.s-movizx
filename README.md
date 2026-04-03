# [Film Camera] P.S Movizx – Tamil Movies Hub

> All Tamil movies • No ads • Direct download • Custom video player • Global search • Notifications

---

## [Lightning Bolt] Quick Start (Your Local PC)

### Step 1 — Install Node.js
Download from https://nodejs.org (LTS version, v18 or v20 recommended)

### Step 2 — Install dependencies
Open a terminal/CMD in the `ps-movizx` folder and run:
```bash
npm install
```

### Step 3 — Start the server
```bash
node server.js
```

### Step 4 — Open in browser
```
http://localhost:3000
```

---

## [Rocket] Features

| Feature | Status |
|---------|--------|
| All movies from all years scraped | ✓ |
| All pages per category (not just 1/25) | ✓ |
| IMDB posters + ratings + plot | ✓ |
| Direct MP4 download (no ads, no new tab) | ✓ |
| Custom HTML5 video player (watch in-app) | ✓ |
| Global search across all loaded categories | ✓ |
| Per-category search bar | ✓ |
| Live notifications ticker | ✓ |
| Year-wise navigation | ✓ |
| Sidebar + mobile responsive | ✓ |
| Playback speed control | ✓ |
| Fullscreen player | ✓ |
| Server-side cache (1 hour) | ✓ |

---

## [Folder] Folder Structure

```
ps-movizx/
├── server.js          ← Express backend + scraper
├── package.json       ← Dependencies
├── README.md          ← This file
└── public/
    └── index.html     ← Full frontend (HTML + CSS + JS)
```

---

## [Gear/Tools] How It Works

The scraper follows a 3-hop chain to get direct MP4 links:

```
moviesda18.com/tamil-2025-movies/
  └── /movie-slug/
        └── /quality-slug/
              └── /resolution-slug/
                    └── /download/file-slug/
                          └── download.moviespage.xyz/download/file/ID
                                └── movies.downloadpage.xyz/download/page/ID
                                      ├── Direct MP4 URL (download)
                                      └── Watch stream URL (player)
```

---

## [Wrench] Troubleshooting

**Port in use?**
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# Mac/Linux
lsof -ti:3000 | xargs kill
```

**Change port:**
```bash
PORT=4000 node server.js    # Mac/Linux
set PORT=4000 && node server.js  # Windows
```

**Movies not loading?**
- Check your internet connection
- The source site may be temporarily down
- Try refreshing after 30 seconds

---

## ⚠️ Disclaimer

This app scrapes publicly accessible content. It is intended for **personal/educational use only**.
The developer is not responsible for any misuse. Respect copyright laws in your country.
