# 9router-MW Independent Dashboard — Implementation Plan

> **Versi:** 0.5.35-mw.8
> **Status:** PLAN — final locked, siap eksekusi
> **Untuk agent executor:** Gunakan `superpowers:subagent-driven-development` untuk implementasi task-by-task.
> Steps menggunakan checkbox (`- [ ]`) untuk tracking.

**Goal:** Build an independent, iOS-style production monitoring dashboard for 9router-MW — served as a static SPA under `/mw/`, reading live data via SSE + REST from Redis and SQLite, without requiring a Next.js rebuild.

**Architecture:** A React Vite SPA (`/dashboard/` within the 9router-mw repo) built on VPS and served by nginx as static files at `router.budgezen.com/mw/`. A lightweight Express handler (`dashboard-express.js`) loaded by `custom-server.js` provides dedicated REST endpoints for provider stats and Redis state. Auth uses a static password (`DASHBOARD_PASSWORD` env) with cookie-session. Live updates use SSE streaming from the existing `/api/usage/stream` endpoint, extended with full metrics.

**Tech Stack:**
- React 19 + Vite 6 (SPA build)
- Framer Motion (iOS-style animations)
- Tailwind CSS 4 (utility-first styling)
- Lucide React (iOS SF Symbols–style icons)
- System font stack (`-apple-system`, San Francisco)
- SSE (EventSource) for live streaming
- Express (new `dashboard-express.js` for API handlers)

**Global Constraints:**
- No changes to core gateway hot-path (chat, executor, translator, provider, proxyFetch)
- No changes to SQLite schema
- Nginx handles `/mw/` before proxying to Next.js — Next.js must never see `/mw/`
- Build on VPS; `node_modules` cleaned after build (source + cache kept)
- Static files served from `/opt/9router-mw/dashboard/dist/`
- Hotfix: edit JS/CSS directly in dist/ on VPS
- English UI language
- All credentials (DASHBOARD_PASSWORD) in `/etc/9router-mw/env`

---

## 1. System Architecture

```
                                Internet
                                    |
                          Cloudflare (proxy)
                                    |
                          Nginx :443 (router.budgezen.com)
                           /                \
                   location /mw/*      location /
                          |                  |
               ┌──────────┐          ┌──────────────────┐
               │ dist/     │          │ Next.js :20128    │
               │ (static)  │          │ (4 workers)       │
               └──────────┘          └──────────────────┘
                                           |
                               ┌───────────┴───────────┐
                               │ dashboard-express.js   │
                               │ (in custom-server.js)  │
                               └───────────────────────┘
                                           |
                               ┌───────────┴───────────┐
                               │    Redis :6381         │
                               │ (mw:live:* state)      │
                               └───────────────────────┘
```

### Request Flow

```
User browser → https://router.budgezen.com/mw/
  → Nginx: location /mw/ → alias /opt/9router-mw/dashboard/dist/
  → SPA loads index.html, JS, CSS
  → SPA fetches:
      GET /api/health              → Nginx proxy → Next.js :20128
      GET /api/usage/stream (SSE)  → Nginx proxy → Next.js :20128
      GET /api/usage/summary       → Nginx proxy → Next.js :20128
      GET /mw/api/providers        → Nginx proxy → dashboard-express.js
      GET /mw/api/redis            → Nginx proxy → dashboard-express.js
      POST /mw/api/auth/login      → Nginx proxy → dashboard-express.js
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Independent SPA (not Next.js) | Zero rebuild of gateway for UI changes. Decoupled lifecycle. |
| Express handler in same process | No extra port/server to manage. Shared Redis client. Trivial latency. |
| Nginx first for `/mw/` | Prevents Next.js from catching `/mw/` routes. Simple, reliable. |
| Static password + cookie | No JWT overhead. Simple. Single shared password. |
| SSE for live data | Already have `/api/usage/stream`. Extend, don't duplicate. |

---

## 2. Directory Structure

```
9router-mw/
├── dashboard/                          # NEW — independent SPA
│   ├── index.html                      # Vite entry HTML (iOS-style shell)
│   ├── vite.config.js                  # Vite config (base: '/mw/', build output)
│   ├── package.json                    # React, Framer Motion, Tailwind, Lucide
│   ├── postcss.config.js               # Tailwind PostCSS
│   ├── tailwind.config.js              # Tailwind config (iOS theme tokens)
│   ├── src/
│   │   ├── main.jsx                    # React entry — mount App
│   │   ├── App.jsx                     # Root — React Router + AuthGate
│   │   ├── auth/
│   │   │   ├── AuthContext.jsx         # Auth state, login/logout, cookie check
│   │   │   └── LoginPage.jsx          # iOS-style login form
│   │   ├── components/
│   │   │   ├── TabBar.jsx              # iOS bottom tab bar (6 tabs)
│   │   │   ├── StatusBadge.jsx         # Green/red status dot
│   │   │   ├── MetricCard.jsx          # iOS-style rounded card with icon
│   │   │   ├── LoadingSpinner.jsx      # iOS UIActivityIndicator-style
│   │   │   └── ErrorState.jsx          # Empty/error state component
│   │   ├── pages/
│   │   │   ├── OverviewPage.jsx        # Live dashboard — SSE consumer
│   │   │   ├── ProvidersPage.jsx       # Provider connection stats
│   │   │   ├── WorkersPage.jsx         # 4 worker health status
│   │   │   ├── RedisPage.jsx           # mw:live:keys state viewer
│   │   │   ├── UsagePage.jsx           # Usage chart (24h/7d/30d)
│   │   │   └── SettingsPage.jsx        # Change password, section visibility
│   │   ├── hooks/
│   │   │   ├── useSSE.js               # EventSource hook (auto-reconnect)
│   │   │   ├── useApi.js               # fetch wrapper with auth + error
│   │   │   └── useChartData.js         # Usage data aggregation hook
│   │   ├── lib/
│   │   │   ├── api.js                  # API client functions (health, providers, etc.)
│   │   │   ├── auth.js                 # login/logout HTTP calls
│   │   │   └── constants.js            # API base URLs, refresh intervals
│   │   └── styles/
│   │       ├── index.css               # Tailwind directives + iOS base styles
│   │       └── ios-tokens.css          # iOS design tokens (spacing, radius, blur)
│   └── public/
│       └── favicon.svg                 # MW favicon
│
├── custom-server.js                    # MODIFY — import dashboard-express.js
├── dashboard-express.js                # NEW — Express Router for /mw/api/*
│
├── docs/plans/9router-mw-dashboard-plan.md  # THIS FILE
│
└── ...existing MW files...
```

---

## 3. Component Tree

```
<App>
  <AuthGate>                              // Checks cookie → show Login or Dashboard
    ├── <LoginPage />                     // If not authenticated
    │     └─ Password form → POST /mw/api/auth/login → set cookie
    │
    └── <Dashboard>                       // If authenticated
          ├── <TabBar />                  // iOS bottom tab — fixed position
          │    ├─ Tab "Overview"  (icon: LayoutDashboard)
          │    ├─ Tab "Providers" (icon: Cable)
          │    ├─ Tab "Workers"   (icon: Cpu)
          │    ├─ Tab "Redis"     (icon: Database)
          │    ├─ Tab "Usage"     (icon: BarChart3)
          │    └─ Tab "Settings"  (icon: Settings)
          │
          └── <Routes>
                ├── <OverviewPage>
                │     ├── <StatusBar />         // Workers 4/4 · Redis · Uptime
                │     ├── <PendingSection />     // Pending requests count + per-provider
                │     ├── <ActiveSection />      // Active connections list
                │     ├── <RecentList />         // Recent requests (10-20 entries)
                │     └── <ErrorRateCard />      // Error rate + latency sparkline
                │
                ├── <ProvidersPage>
                │     ├── <SearchBar />          // Filter by provider name
                │     └── <ProviderTable />      // Name · Total · Active · Today Req · Proxies · Error%
                │
                ├── <WorkersPage>
                │     └── <WorkerGrid />         // 4 cards × worker ID
                │           └── <WorkerCard />   // ID · PID · Uptime · Memory · Last health · Status dot
                │
                ├── <RedisPage>
                │     ├── <ActiveSection />      // mw:live:active SET contents
                │     ├── <RecentSection />      // mw:live:recent LIST entries
                │     └── <CounterSection />     // mw:live:cnt:* keys
                │
                ├── <UsagePage>
                │     ├── <TimeRangeSelector />  // 24h · 7d · 30d pills
                │     └── <UsageChart />         // Recharts line/bar chart
                │
                └── <SettingsPage>
                      ├── <ChangePasswordForm /> // Current + new password → POST
                      └── <SectionToggles />     // Show/hide Overview sections (localStorage)
```

---

## 4. Route & Nginx Design

### 4.1 Nginx Config (addition to existing)

```nginx
# router.budgezen.com — existing HTTPS server block

# Serve dashboard static files FIRST (before proxy to Next.js)
location /mw/ {
    alias /opt/9router-mw/dashboard/dist/;
    try_files $uri $uri/ /mw/index.html;

    # Cache static assets (hashed by Vite)
    location ~* \.(js|css|svg|png|jpg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Never cache index.html (contains latest asset links)
    location = /mw/index.html {
        expires -1;
        add_header Cache-Control "no-store";
    }
}

# API for dashboard (proxied to dashboard-express.js via Next.js port)
location /mw/api/ {
    proxy_pass http://127.0.0.1:20128;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Cookie-based auth — pass thru for validation
    proxy_set_header Cookie $http_cookie;
}
```

### 4.2 Express Router Routes (`/mw/api/`)

All routes are mounted on an Express Router at path `/mw/api` inside `dashboard-express.js`, which is attached to the main Express app in `custom-server.js`.

| Method | Path | Auth | Handler | Description |
|--------|------|------|---------|-------------|
| POST | `/mw/api/auth/login` | No | `loginHandler` | Accept `{password}`, set httpOnly cookie if match |
| POST | `/mw/api/auth/logout` | Cookie | `logoutHandler` | Clear auth cookie |
| GET | `/mw/api/auth/check` | Cookie | `checkHandler` | Return `{authenticated: true/false}` |
| GET | `/mw/api/providers` | Cookie | `providersHandler` | SELECT provider, COUNT(*), active, today reqs, proxy count, error rate from SQLite |
| GET | `/mw/api/redis` | Cookie | `redisHandler` | SMEMBERS mw:live:active, LRANGE mw:live:recent 0 49, SCAN mw:live:cnt:* |
| GET | `/mw/api/health` | No | `healthHandler` | Same as /api/health — workers count, redis ping, version |
| GET | `/mw/api/settings/password` | Cookie | `getPasswordStatus` | Return `{hasPassword: true}` (never return actual) |

### 4.3 Express Router Implementation

```js
// dashboard-express.js — loaded by custom-server.js
// Provides REST endpoints for the independent dashboard under /mw/api/

const { Router } = require('express');

function createDashboardRouter({ redisClient, db, getWorkerCount }) {
  const router = new Router();
  const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin';

  // --- Auth Middleware ---
  function requireAuth(req, res, next) {
    if (req.cookies?.mw_dashboard_session === DASHBOARD_PASSWORD) {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // --- POST /mw/api/auth/login ---
  router.post('/auth/login', (req, res) => {
    const { password } = req.body || {};
    if (password === DASHBOARD_PASSWORD) {
      res.cookie('mw_dashboard_session', DASHBOARD_PASSWORD, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24h
        path: '/',
      });
      return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Invalid password' });
  });

  // --- POST /mw/api/auth/logout ---
  router.post('/auth/logout', requireAuth, (req, res) => {
    res.clearCookie('mw_dashboard_session', { path: '/' });
    return res.json({ success: true });
  });

  // --- GET /mw/api/auth/check ---
  router.get('/auth/check', (req, res) => {
    const ok = req.cookies?.mw_dashboard_session === DASHBOARD_PASSWORD;
    return res.json({ authenticated: ok });
  });

  // --- GET /mw/api/providers ---
  router.get('/providers', requireAuth, async (req, res) => {
    try {
      // Aggregate from providerConnections
      const rows = db.prepare(`
        SELECT
          provider,
          COUNT(*) AS total,
          SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN proxyPoolId IS NOT NULL THEN 1 ELSE 0 END) AS proxy_count
        FROM providerConnections
        GROUP BY provider
        ORDER BY total DESC
      `).all();

      // Today's request count per provider (from usageHistory)
      const today = new Date().toISOString().slice(0, 10);
      const todayReqs = db.prepare(`
        SELECT provider, COUNT(*) AS req_count
        FROM usageHistory
        WHERE DATE(createdAt) = ?
        GROUP BY provider
      `).all(today);

      const reqMap = Object.fromEntries(todayReqs.map(r => [r.provider, r.req_count]));

      const enriched = rows.map(row => ({
        ...row,
        today_requests: reqMap[row.provider] || 0,
        error_rate: 0, // from requestDetails join — future enhancement
      }));

      return res.json({ providers: enriched });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // --- GET /mw/api/redis ---
  router.get('/redis', requireAuth, async (req, res) => {
    try {
      if (!redisClient) {
        return res.json({ status: 'redis-unavailable', active: [], recent: [], counters: {} });
      }

      const [active, recent, counterKeys] = await Promise.all([
        redisClient.smembers('mw:live:active'),
        redisClient.lrange('mw:live:recent', 0, 49),
        redisClient.keys('mw:live:cnt:*'),
      ]);

      let counters = {};
      if (counterKeys.length > 0) {
        const vals = await Promise.all(counterKeys.map(k => redisClient.get(k)));
        counters = Object.fromEntries(counterKeys.map((k, i) => [k, vals[i]]));
      }

      return res.json({ status: 'ok', active, recent, counters });
    } catch (err) {
      return res.json({ status: 'redis-error', error: err.message, active: [], recent: [], counters: {} });
    }
  });

  // --- GET /mw/api/health ---
  router.get('/health', (req, res) => {
    return res.json({
      status: 'ok',
      workers: typeof getWorkerCount === 'function' ? getWorkerCount() : null,
      version: process.env.npm_package_version || '0.5.35-mw.8',
      uptime: process.uptime(),
    });
  });

  // --- POST /mw/api/settings/password ---
  router.post('/settings/password', requireAuth, (req, res) => {
    // Note: In production, this requires writing to /etc/9router-mw/env
    // For v1, return instructions or implement via helper script
    return res.json({
      success: false,
      message: 'Password change requires env file update. SSH to VPS and update DASHBOARD_PASSWORD in /etc/9router-mw/env, then restart 9router-mw.',
    });
  });

  return router;
}

module.exports = { createDashboardRouter };
```

---

## 5. API Contract

### 5.1 SSE Stream — Extended (`/api/usage/stream`)

The existing Next.js SSE endpoint at `/api/usage/stream` is extended to push full metrics. Current behavior already pushes `{ currentRequest, pendingCount, byAccount }`. Extended message format:

```json
{
  "type": "live",
  "timestamp": "2026-07-20T12:00:00.000Z",
  "pending": {
    "total": 3,
    "byProvider": { "openai": 2, "grok": 1 }
  },
  "active": {
    "total": 5,
    "connections": [
      { "id": "conn_xxx", "provider": "openai", "model": "gpt-4", "elapsed": 2340, "workerId": 2 }
    ]
  },
  "recent": [
    { "id": "req_xxx", "provider": "openai", "model": "gpt-4", "status": 200, "elapsed": 1200, "timestamp": "..." }
  ],
  "errors": {
    "total": 0,
    "rate": 0.0
  },
  "latency": {
    "avg": 1450,
    "p95": 3200
  }
}
```

### 5.2 REST Endpoints

#### `GET /api/health` (existing Next.js)
```json
{
  "status": "ok",
  "workers": 4,
  "redis": { "status": "ok", "latency": 1 },
  "version": "0.5.35-mw.8",
  "undici": { "enabled": true, "connections": 32 },
  "sqlite": "better-sqlite3+WAL"
}
```

#### `GET /api/usage/summary` (existing Next.js)
```json
{
  "today": { "requests": 5297, "tokens": 232347392 },
  "period": "24h",
  "series": [
    { "hour": "2026-07-19T13:00:00Z", "requests": 245, "tokens": 12000000 }
  ]
}
```

#### `GET /mw/api/providers` (Express — auth required)
```json
{
  "providers": [
    { "provider": "openai", "total": 150, "active": 142, "today_requests": 3200, "proxy_count": 5, "error_rate": 0.02 },
    { "provider": "grok-cli", "total": 3078, "active": 3050, "today_requests": 1200, "proxy_count": 0, "error_rate": 0.001 }
  ]
}
```

#### `GET /mw/api/redis` (Express — auth required)
```json
{
  "status": "ok",
  "active": ["conn_xxx:gpt-4", "conn_yyy:claude-3"],
  "recent": [
    {"connectionId": "conn_xxx", "model": "gpt-4", "provider": "openai", "timestamp": "...", "endpoint": "/v1/chat/completions"}
  ],
  "counters": {
    "mw:live:cnt:openai:gpt-4": "42",
    "mw:live:cnt:grok:grok-4.5": "18"
  }
}
```

#### `POST /mw/api/auth/login` (Express — no auth)
```json
// Request
{ "password": "thePassword" }
// Response 200
{ "success": true }
// Response 401
{ "error": "Invalid password" }
```

#### `GET /mw/api/auth/check` (Express)
```json
{ "authenticated": true }
```

---

## 6. Data Flow

### 6.1 Live Data (SSE)

```
Redis mw:live:* changes
  → Next.js /api/usage/stream (extended) pushes JSON events
  → Nginx proxied to client
  → OverviewPage useSSE hook parses event
  → React state updated → UI re-renders (Framer Motion animate)
```

**SSE EventSource lifecycle:**
```js
// hooks/useSSE.js
function useSSE(url) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        setData(JSON.parse(event.data));
        setError(null);
      } catch (e) { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setError('SSE disconnected');
      // EventSource auto-reconnects
    };

    return () => es.close();
  }, [url]);

  return { data, error };
}
```

### 6.2 Static Data (REST)

```
Page mount → useApi() → fetch /mw/api/providers (or /api/usage/summary)
  → Express handler queries SQLite / Redis
  → JSON response → React state → UI
```

**Fetch wrapper with auth:**
```js
// lib/api.js
const BASE = '';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include', // send cookies
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:logout'));
    throw new Error('Unauthorized');
  }
  return res.json();
}

export const getProviders = () => apiFetch('/mw/api/providers');
export const getRedisState = () => apiFetch('/mw/api/redis');
export const getHealth = () => apiFetch('/api/health');
export const getUsageSummary = () => apiFetch('/api/usage/summary');
export const login = (password) => apiFetch('/mw/api/auth/login', {
  method: 'POST', body: JSON.stringify({ password }),
});
export const checkAuth = () => apiFetch('/mw/api/auth/check');
```

### 6.3 Auth Flow

```
1. SPA loads → AuthGate checks cookie via GET /mw/api/auth/check
2. If false → show <LoginPage>
3. User enters password → POST /mw/api/auth/login
4. Express compares with DASHBOARD_PASSWORD env
5. If match → set httpOnly cookie mw_dashboard_session (24h)
6. Client re-checks → authenticated=true → render Dashboard
7. All API calls include credentials: 'include' → cookie sent automatically
8. On 401 → dispatch auth:logout → redirect to LoginPage
```

---

## 7. UI/UX Design (iOS-Style)

### 7.1 Design Tokens

```css
/* ios-tokens.css */
:root {
  /* iOS Light Mode Colors */
  --ios-bg:          #F2F2F7;  /* System grouped background */
  --ios-card-bg:     #FFFFFF;
  --ios-separator:   #C6C6C8;
  --ios-label:       #000000;
  --ios-secondary:   #3C3C43;  /* Secondary label */
  --ios-tint:        #007AFF;  /* iOS blue */
  --ios-green:       #34C759;
  --ios-red:         #FF3B30;
  --ios-orange:      #FF9500;
  --ios-gray:        #8E8E93;

  /* Spacing (iOS standard: 16px base) */
  --ios-spacing:     16px;
  --ios-radius:      12px;     /* Card corner radius */
  --ios-radius-sm:   8px;
  --ios-blur:        20px;     /* Backdrop blur for tab bar */
}
```

### 7.2 Tab Bar (iOS-style)

- Fixed bottom, backdrop-blur background
- 6 tabs with Lucide icons + text label
- Active tab: tint blue, inactive: gray
- Safe area inset for iPhone notch
- 49pt height (iOS standard)

### 7.3 Card Components

- White rounded rectangle (`border-radius: 12px`)
- Subtle shadow (`0 1px 3px rgba(0,0,0,0.08)`)
- 16px padding
- iOS-style list inside cards with separators

### 7.4 Navigation Bar

- Large title style (iOS 13+)
- Translucent navigation bar with separator
- Back gesture (swipe) if applicable

### 7.5 Animations (Framer Motion)

- Page transitions: slide up/down (iOS push animation)
- Cards: fade in + slight scale on mount
- Status changes: scale pulse on active/pending count change
- Tab switch: cross-fade
- Pull-to-refresh style gesture (optional v2)

---

## 8. Page Specifications

### 8.1 Overview Page (`/mw/`)

| Section | Source | Update |
|---------|--------|--------|
| **Status Bar** — Workers 4/4 · Redis · Uptime | `GET /api/health` | On mount + every 30s |
| **Pending** — Total pending + per-provider breakdown | SSE `pending` field | Live (SSE push) |
| **Active Connections** — Current active requests | SSE `active` field | Live (SSE push) |
| **Recent Requests** — Last 10-20 completed | SSE `recent` field | Live (SSE push) |
| **Error Rate** — % errors + count | SSE `errors` field | Live (SSE push) |
| **Latency** — Avg + p95 | SSE `latency` field | Live (SSE push) |

Empty state: "Waiting for requests…" with animated pulse dot.
Error state: "Stream disconnected — retrying…" with orange badge.

### 8.2 Providers Page (`/mw/providers`)

- Table/list of all providers with active connections
- Columns: Provider name · Total connections · Active · Today requests · Proxy pools · Error rate
- Search bar: filter by provider name (client-side)
- Sortable columns (click header)
- Count summary header: "X providers · Y total connections · Z active"

### 8.3 Workers Page (`/mw/workers`)

- 4 cards in 2×2 grid (desktop) or vertical list (mobile)
- Each card:
  - Worker ID (1-4) · PID · Status dot (green=healthy)
  - Uptime · Memory usage
  - Last health check timestamp
  - Requests handled (from health endpoint if available)

### 8.4 Redis Page (`/mw/redis`)

Three sections with collapse/expand:

1. **Active Requests** (`SMEMBERS mw:live:active`) — list of active connection:model keys
2. **Recent Requests** (`LRANGE mw:live:recent 0 49`) — table with timestamp, provider, model, endpoint
3. **Counters** (`SCAN mw:live:cnt:*`) — key-value list of provider:model → count

Empty state per section: "No active requests" / "No recent entries"

### 8.5 Usage Page (`/mw/usage`)

- Time range selector: 24h | 7d | 30d (iOS pill-style segmented control)
- Line chart (Recharts) showing requests over time
- Optional: token usage overlay (v2)
- Summary cards: Total requests today · Total tokens · Peak RPM

### 8.6 Settings Page (`/mw/settings`)

Two sections:

1. **Password**
   - Current password input
   - New password input × 2 (confirm)
   - Note: "Password change requires SSH + restart. Changes apply after restart."

2. **Overview Sections**
   - Toggle switches (iOS-style) for each Overview section:
     - Pending · Active · Recent · Error Rate · Latency
   - Saved to `localStorage`

---

## 9. Build & Deploy

### 9.1 Build Process (on VPS)

```bash
# As user 'router' or root (then chown)

# 1. Ensure source is up to date
cd /opt/9router-mw/releases/0.5.35-mw.8
git pull origin master

# 2. Install dashboard dependencies
cd dashboard
npm ci --production=false

# 3. Build SPA
npm run build
# → Output: dashboard/dist/

# 4. Cleanup (node_modules only, keep source + cache)
rm -rf node_modules

# 5. Verify dist/ exists
ls -la dist/
# → index.html, assets/*.js, assets/*.css

# 6. If first deploy: symlink or copy to serve location
ln -sfn /opt/9router-mw/releases/0.5.35-mw.8/dashboard/dist /opt/9router-mw/dashboard

# 7. Reload nginx (no restart needed)
nginx -s reload
```

### 9.2 Build Configuration

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/mw/',           // All asset paths relative to /mw/
  build: {
    outDir: 'dist',
    sourcemap: false,      // Production — no sourcemaps
    minify: 'esbuild',     // Fast production minify
  },
});
```

### 9.3 Hotfix Workflow

For small CSS/JS fixes without full rebuild:

```bash
# 1. Edit file directly in dist/
vim /opt/9router-mw/dashboard/dist/assets/index-abc123.js

# 2. No reload needed — browser fetches updated file on next request
# (Only affected if file is cached — add cache-bust query param)
```

### 9.4 Nginx Cache Strategy

- Hash-named assets (`.js`, `.css`) → `Cache-Control: public, immutable, max-age=31536000`
- `index.html` → `Cache-Control: no-store` (always fetch latest)
- This means hotfix edits to dist/ JS/CSS need a filename change or cache bust

---

## 10. Implementation Steps

### Task 1: Scaffold Dashboard SPA

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/vite.config.js`
- Create: `dashboard/index.html`
- Create: `dashboard/postcss.config.js`
- Create: `dashboard/tailwind.config.js`
- Create: `dashboard/src/main.jsx`
- Create: `dashboard/src/App.jsx`
- Create: `dashboard/src/styles/index.css`
- Create: `dashboard/src/styles/ios-tokens.css`
- Create: `dashboard/public/favicon.svg`

**Steps:**

1. Write `package.json` with dependencies:
   ```json
   {
     "name": "9router-mw-dashboard",
     "private": true,
     "version": "0.5.35-mw.8",
     "type": "module",
     "scripts": {
       "dev": "vite",
       "build": "vite build",
       "preview": "vite preview"
     },
     "dependencies": {
       "react": "^19.0.0",
       "react-dom": "^19.0.0",
       "react-router-dom": "^7.0.0",
       "framer-motion": "^12.0.0",
       "lucide-react": "^0.400.0",
       "recharts": "^2.0.0"
     },
     "devDependencies": {
       "@vitejs/plugin-react": "^4.0.0",
       "vite": "^6.0.0",
       "tailwindcss": "^4.0.0",
       "postcss": "^8.0.0",
       "@tailwindcss/postcss": "^4.0.0"
     }
   }
   ```

2. Write `vite.config.js` (base: `/mw/`, build outDir: `dist`)

3. Write `index.html` — minimal HTML shell with `<div id="root">` and iOS-style meta viewport

4. Write `main.jsx` — `createRoot(document.getElementById('root')).render(<App />)`

5. Write `ios-tokens.css` — CSS custom properties from §7.1

6. Write `index.css` — Tailwind directives + iOS base styles

7. Write `App.jsx` — `BrowserRouter` with `basename="/mw"`, wrap in `AuthGate`

### Task 2: Auth Layer

**Files:**
- Create: `dashboard/src/auth/AuthContext.jsx`
- Create: `dashboard/src/auth/LoginPage.jsx`
- Create: `dashboard/src/lib/auth.js`

**Key behaviors:**
- On app mount: `GET /mw/api/auth/check` → if false, show LoginPage
- Login form: password input → submit → `POST /mw/api/auth/login`
- Success → re-check → show Dashboard
- On any API 401 → redirect to LoginPage

### Task 3: Core Components

**Files:**
- Create: `dashboard/src/components/TabBar.jsx`
- Create: `dashboard/src/components/StatusBadge.jsx`
- Create: `dashboard/src/components/MetricCard.jsx`
- Create: `dashboard/src/components/LoadingSpinner.jsx`
- Create: `dashboard/src/components/ErrorState.jsx`

**Key behaviors:**
- TabBar: 6 tabs with Lucide icons, `react-router-dom` NavLink, bottom-fixed, backdrop-blur
- StatusBadge: green/red/orange dot with optional label
- MetricCard: white rounded card with icon, label, value
- LoadingSpinner: iOS-style activity indicator (Framer Motion rotate)
- ErrorState: alert icon + message + retry button

### Task 4: Overview Page + SSE Hook

**Files:**
- Create: `dashboard/src/pages/OverviewPage.jsx`
- Create: `dashboard/src/hooks/useSSE.js`
- Create: `dashboard/src/lib/api.js`
- Create: `dashboard/src/lib/constants.js`

**Key behaviors:**
- `useSSE('/api/usage/stream')` connects EventSource, parses JSON, returns `{ data, error }`
- OverviewPage renders sections based on SSE data
- Empty state when no data yet
- Reconnection on error (EventSource built-in)
- Framer Motion animations for count changes (AnimatePresence)

### Task 5: Providers Page

**Files:**
- Create: `dashboard/src/pages/ProvidersPage.jsx`
- Create: `dashboard/src/hooks/useApi.js`

**Key behaviors:**
- Fetch `GET /mw/api/providers` on mount
- Client-side search filter
- Sortable columns
- Loading state: skeleton cards
- Error state: retry button
- Empty state: "No providers found"

### Task 6: Workers + Redis + Usage Pages

**Files:**
- Create: `dashboard/src/pages/WorkersPage.jsx`
- Create: `dashboard/src/pages/RedisPage.jsx`
- Create: `dashboard/src/pages/UsagePage.jsx`
- Create: `dashboard/src/hooks/useChartData.js`

**Key behaviors:**
- WorkersPage: grid of 4 cards, data from `/api/health`
- RedisPage: 3 collapsible sections, data from `/mw/api/redis`
- UsagePage: time range selector (24h/7d/30d pills), Recharts line chart, data from `/api/usage/summary`

### Task 7: Settings Page

**Files:**
- Create: `dashboard/src/pages/SettingsPage.jsx`

**Key behaviors:**
- Change password form (shows info about SSH+restart requirement)
- Section visibility toggles (stored in localStorage)
- iOS-style switch components

### Task 8: Express Handler

**Files:**
- Create: `dashboard-express.js` (in repo root)
- Modify: `custom-server.js` (add `const { createDashboardRouter } = require('./dashboard-express')` and mount router)

**Key behaviors:**
- Load Redis client from existing `open-sse/services/redisClient.js`
- Load DB from existing `src/lib/db/` (better-sqlite3)
- Mount router at `/mw/api`
- Implement all endpoints per §5.2
- Cookie auth middleware per §4.3

### Task 9: Nginx Config + Deploy

**Files:**
- Modify: nginx config (on VPS)
- Run: build + deploy on VPS

**Key behaviors:**
- Add `location /mw/` block before proxy pass
- Run `npm ci && npm run build && rm -rf node_modules` in `/dashboard/` on VPS
- Symlink dist/ to `/opt/9router-mw/dashboard/`
- `nginx -s reload`

---

## 11. Verification & Acceptance

| Check | Method |
|-------|--------|
| SPA loads at `/mw/` | Browser → `router.budgezen.com/mw/` → see login page |
| Auth works | Enter wrong password → 401; correct → dashboard loads |
| Tab navigation | Click each tab → correct page renders |
| SSE live data | Overview shows pending/active/recent updating |
| Provider data | Providers page shows list with counts |
| Worker status | Workers page shows 4 cards with green dots |
| Redis viewer | Redis page shows active/recent/counters |
| Usage chart | Usage page shows chart, switch time ranges |
| Settings | Change section visibility → overview hides sections |
| Express API auth | `/mw/api/providers` without cookie → 401 |
| Nginx serves first | curl `/mw/index.html` → returns file (not Next.js 404) |
| Build cleanup | `node_modules` removed after build; `dist/` intact |
| nginx -t | Config syntax valid |

---

## 12. Future Enhancements (v2)

| Feature | Reason |
|---------|--------|
| Dark mode | iOS dark mode toggle |
| Push notifications | Worker down alert |
| Real-time chart | SSE-fed live chart (not polled) |
| Provider detail page | Per-provider connection list, activity |
| Export data | CSV download of usage |
| Multi-user auth | Separate accounts (overkill for MVP) |
| Mobile app | PWA / standalone mode |
| Rate limiter stats | Per-provider RPM/TPS visualization |
| Log viewer | Tail recent request logs |
| Auto-refresh password | Rotate on schedule |

---

> **Plan prepared:** 2026-07-20
> **Plan status:** FINAL — locked, ready for execution
> **Locked by:** User + Sisyphus (all questions resolved)
> **Estimated effort:** ~8–12 tasks, ~4–6h executor time
