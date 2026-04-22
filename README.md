# BingeBox Omega v4.0 — The Ultimate Streaming Platform

## 🚀 Deploy to Vercel (60 seconds)

```bash
npm i -g vercel
vercel --prod
```

Or: push to GitHub → import on [vercel.com/new](https://vercel.com/new) → done.

## 📦 What's New in v4.0

| Feature | Details |
|---------|---------|
| 🎬 11 Streaming Servers | VidLink, VidSrc PRO, Videasy, VidSrc CC, SuperEmbed, AutoEmbed, 2Embed, VidSrc.ME, Embed.su, NontonID, MoviesAPI |
| ⬇️ Download Modal | One-click download via dl.vidsrc.vip |
| ↔️ 21:9 Wide Mode | Ultra-wide cinema aspect ratio toggle |
| 🪟 Pop-Out Player | Open any stream in a new tab |
| ⭐ Search by Cast | Click any cast member to search their filmography |
| 📊 FPS Counter | Live frames-per-second overlay (toggle in settings) |
| 🎨 9 UI Themes | Netflix, Midnight, Warm, Teal, Hulu, Max, Prime, Rose, Cyber |
| 🏆 19 Achievements | 4 new: Archivist, Cinescope, Star Tracker, World Viewer |
| 🗂️ 25 Content Rows | + Family, K-Drama, Reality, New Releases, Superhero |
| 💊 22 Genre Pills | Now includes Adventure, Family, Fantasy, Music, K-Drama and more |
| ⌨️ New Shortcuts | W=Wide, D=Download, P=Pop-out |
| 📱 Mobile VH Fix | Correct mobile viewport height via --vh CSS variable |

## 🗂️ Project Structure

```
├── index.html              ← Full app — works on Vercel AND as standalone file
├── api/
│   ├── health.js           ← GET /api/health — proxy detection endpoint
│   └── tmdb/
│       └── [...path].js    ← TMDB proxy with caching, batch POST, stale-while-revalidate
├── vercel.json             ← Routes, CORS headers, security, function config
├── package.json            ← Zero runtime deps (Node built-ins only)
└── README.md
```

## ⚙️ Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `TMDB_API_KEY` | Optional | A fallback key is bundled. Get yours at themoviedb.org |

## 🌐 How It Works

**On Vercel** — index.html pings `/api/health`, detects proxy is live, routes all TMDB
calls through `/api/v1/tmdb/*` (rewrites to `/api/tmdb/[...path].js`). API key is server-side only.

**Standalone** — open index.html directly. Detects no proxy and falls back to direct TMDB
with the bundled key. Every feature except the server-side cache works the same.

## 🎮 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Search |
| `Esc` | Close |
| `F` | Cinema mode |
| `W` | 21:9 Wide mode |
| `P` | Pop-out player |
| `D` | Download modal |
| `M` | My List |
| `H` | Home |
| `S` | Settings |
| `N` | Next episode |
| `?` | Shortcuts panel |
| `↑↑↓↓←→←→BA` | 🕹️ Konami — God Mode |

## 🛡️ OmegaShield

Neural-grade ad/popup blocker — patches `fetch`, `XHR`, `window.open`, `document.write`
and uses a MutationObserver to remove injected ad nodes in real-time.
