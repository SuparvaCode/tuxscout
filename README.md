# 🐧 TuxScout (`tuxscout`)

**Cross-Platform AI Agent Reconnaissance, Media & Deep Research Suite (Linux • Windows • macOS)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-orange.svg)](#quick-installation)
[![MCP Ready](https://img.shields.io/badge/MCP-Stdio%20Server-purple.svg)](#mcp-model-context-protocol-server-tx-mcp)

**TuxScout** is a high-performance, ultra-low-memory AI Agent Toolkit engineered for Linux servers, Docker containers, Windows workstations, and macOS environments. It provides:
- **Global CLI Binaries** (`tuxscout`, `tx-search`, `tx-images`, `tx-fetch`, `tx-browser`, `tx-yt`, `tx-research`, `tx-serve`, `tx-mcp`)
- **Model Context Protocol (MCP) Server** (`tx-mcp` — zero-dependency JSON-RPC 2.0 over stdio)
- **HTTP REST API Server** (`tx-serve` — drop-in compatible with Delphos web/image gateways)
- **TypeScript / Node.js SDK** (`import { webSearch, imageSearch, fetchMarkdown, fetchWithPuppeteer, youtubeTool, deepResearch } from 'tuxscout'`)

---

## ⚡ Quick Installation

### 1. One-Line Install via NPM (Linux, Windows, macOS)
```bash
npm install -g git+https://github.com/SuparvaCode/tuxscout.git
tuxscout setup
```

### 2. Windows PowerShell One-Liner (`irm`)
```powershell
irm https://raw.githubusercontent.com/SuparvaCode/tuxscout/main/install.ps1 | iex
```

### 3. Linux (Ubuntu/Debian/Fedora/Arch) & macOS One-Liner (`curl`)
```bash
curl -fsSL https://raw.githubusercontent.com/SuparvaCode/tuxscout/main/install.sh | bash
```

### 4. Clone & Local Install
```bash
git clone https://github.com/SuparvaCode/tuxscout.git
cd tuxscout
npm install && npm run build && npm install -g .
tuxscout setup
```

---

## 🛠️ Included Tools & Architecture

### 1. Multi-Engine Internet Web Search (`tx-search`)
- **Engines:** DuckDuckGo HTML, DuckDuckGo Lite, Brave Search, Yahoo Search (with manual `/_bv` redirect & `YBV` cookie jar persistence), Wikipedia API, and Bing.
- **4-Layer Relevance & Quality Filter:**
  1. **Intent Classification:** Distinguishes `news` / release queries from `evergreen` and `navigational` queries.
  2. **Subject vs. Freshness Separation:** Prevents generic news portals from hijacking queries containing words like `"latest"` or `"upcoming"`.
  3. **Landing-Page Rejection:** Filters out bare marketing homepages when the query asks for news, releases, or changelogs.
  4. **Engine-Level Relevance Verdict:** Detects off-topic SERPs (`ratio < 0.34`) and automatically fails over to the next engine.
- **Multi-Query Parallel Execution:** Accepts multiple `--query` angles, executes them concurrently, and merges results round-robin by rank.

### 2. 5-Engine Live-Verified Image Search & Parallel Downloader (`tx-images`)
- **Engines:** Bing Async Image Grid, DuckDuckGo (`vqd` token + `i.js`), Yahoo Image Tiles, Wikimedia Commons API, and Openverse CC API.
- **Live Magic-Byte URL Probing (`verifyUrls: true` by default):** Over-fetches candidates and probes the first 512 bytes in parallel (`Range: bytes=0-2047`) to confirm `HTTP 200/206` and valid binary image magic bytes (`JPG`, `PNG`, `WEBP`, `GIF`, `AVIF`, `SVG`, `BMP`, `TIFF`). Broken `404` links, `403` hotlink-blocked URLs, watermarked stock hosts (`gettyimages`, `shutterstock`, `istockphoto`, `alamy`, `pinterest`), and HTML error pages are automatically filtered out.
- **Parallel Verified Downloader (`--download`):** Saves `N` verified images concurrently to disk with automatic `Referer` spoofing, thumbnail fallback, and a `manifest.json` index.

### 3. Fast Website-to-Markdown Fetcher (`tx-fetch`)
- Zero-DOM-dependency Readability-style main content extractor (`<article>`, `<main>`, noise/nav/footer/ad stripping).
- Converts HTML into clean, token-efficient GitHub-Flavored Markdown (preserving fenced code blocks with language tags, Markdown tables, headings, lists, blockquotes, and resolved absolute links).
- **Automatic JS-Wall / SPA Escalation:** Detects Cloudflare challenges, `<noscript>` SPA shells, or empty `#root`/`#app` containers and automatically escalates to the Low-RAM Puppeteer fetcher.

### 4. Ultra-Low-Memory Puppeteer JS Fetcher (`tx-browser`)
- **0 MB Idle RAM:** Singleton browser pool automatically closes headless Chromium/Chrome/Edge/Brave after 45s of inactivity.
- **Concurrency Semaphore & Page Recycling:** Caps simultaneous tabs (max 3) and recycles the browser every 25 pages to eliminate memory leaks.
- **Aggressive Request Interception:** Blocks `image`, `media`, `font`, `websocket`, and 35+ ad/analytics/tracker domains at the network layer—reducing page memory by **60–80%** and speeding up loads by **3–5x**.
- **Built-in Stealth Evasions:** Spoofs `navigator.webdriver`, `window.chrome`, plugins, and languages.

### 5. YouTube Video, Music, Search & Fast Transcript Tool (`tx-yt`)
- Powered by `yt-dlp` + `ffmpeg` (auto-discovers system binaries or self-bootstraps `yt-dlp` into `~/.tuxscout/bin/`).
- **Strict Long-Form vs. Shorts Filter (`videoType: 'long' | 'shorts' | 'all'`):**
  - By default (`--type long`), YouTube searches return **only normal long-form videos** (`> 60s`) and exclude YouTube Shorts.
  - Pass `--shorts` (or `--type shorts`) to search **only YouTube Shorts** (`<= 60s`), or `--type all` for both.
- **Fast Single-Track Transcript Extractor (`--mode transcript` / `--transcript`):** Extracts clean timestamped Markdown + plain text captions (`WEBVTT`, `SRT`, `JSON3`, `SRV1/XML`) in **~3–4 seconds** without hitting YouTube multi-track HTTP 429 rate limits.
- **High-Quality Video & Audio Downloads:** Supports `mp4`, `mkv`, `webm` video downloads (up to `2160p`/`1080p`/`720p`) and `mp3`, `m4a`, `opus`, `flac`, `wav` audio extraction.

### 6. 4-Stage Parallel Deep Research Pipeline (`tx-research`)
- **Stage 1 (Query Expansion):** Classifies intent and generates 2–4 orthogonal search angles.
- **Stage 2 (Parallel Multi-Engine Discovery):** Executes all angles concurrently across search engines (+ optional verified Image & YouTube discovery) and selects domain-diverse top URLs.
- **Stage 3 (Parallel Tiered Content Extraction):** Fetches candidate pages concurrently in Markdown, escalating JS-walled pages to Low-RAM Puppeteer and topping up failed pages from backup candidates.
- **Stage 4 (Passage Ranking & Synthesis):** Scores paragraphs by query-term & factual density and compiles a citation-backed Markdown Research Report (`[1]`, `[2]`, ...).

---

## 💻 CLI Usage & Examples

```bash
# System diagnostics & binary setup
tuxscout setup
tuxscout doctor

# Export JSON tool schemas for AI Agents / LLM Function Calling
tuxscout schema

# 1. Web Search (single query or parallel multi-angle queries)
tx-search "Linux kernel 6.12 release notes" -n 5
tx-search --query "Node.js v24 features" --query "Node 24 vs Bun benchmarks" --json

# 2. Image Search (live-verified URLs) & Parallel Download
tx-images "Linux Tux penguin" -n 5
tx-images "mountain landscape wallpaper" --download --out ./wallpapers -n 5

# 3. Fast Website-to-Markdown Fetch (auto-escalates to JS browser if needed)
tx-fetch https://en.wikipedia.org/wiki/Linux --max-chars 5000
tx-fetch https://news.ycombinator.com --json

# 4. Ultra-Low-RAM Puppeteer JS Browser Fetch
tx-browser https://example.com --scroll --screenshot ./page.png
tx-browser https://react.dev --wait networkidle2

# 5. YouTube Search (Long-Form vs Shorts), Transcript, Audio & Video Download
tx-yt "linux kernel tutorial" -n 5                     # Default: Long-form videos only (no Shorts)
tx-yt "linux tips" --shorts -n 5                       # YouTube Shorts only (<=60s)
tx-yt "linux" --type all -n 5                          # Both Long-form and Shorts
tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode transcript
tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode info
tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode audio --format mp3 --out ./music
tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode video --height 720 --out ./videos

# 6. 4-Stage Parallel Deep Research
tx-research "Compare SQLite WAL mode vs DuckDB for embedded analytics" --depth quick
tx-research "Latest breakthroughs in solid state batteries" --depth standard --images --yt --save ./report.md
```

---

## 🔌 MCP (Model Context Protocol) Server (`tx-mcp`)

TuxScout includes a built-in, zero-dependency MCP server over `stdio`. After installing globally, add `tx-mcp` to your AI Agent client (`claude_desktop_config.json`, Cursor, Windsurf, Cline, OpenClaw, etc.):

```json
{
  "mcpServers": {
    "tuxscout": {
      "command": "tx-mcp"
    }
  }
}
```

### Exposed MCP Tools
| Tool Name | Description |
|-----------|-------------|
| `web_search` | Multi-engine Web Search with 4-layer relevance filtering & parallel query angles |
| `image_search` | 5-engine Image Search with live parallel magic-byte URL verification |
| `image_download` | Parallel verified image downloader with Referer spoofing & `manifest.json` |
| `fetch_markdown` | Fast Website-to-Markdown converter with automatic Puppeteer JS fallback |
| `fetch_puppeteer_js` | Ultra-low-RAM Headless Chromium JS renderer with request interception |
| `youtube_tool` | YouTube Search (`long` / `shorts` / `all`), fast Transcripts, Info, Audio & Video downloader |
| `deep_research` | 4-Stage Parallel Multi-Angle Search & Deep Research dossier generator |

---

## 🌐 HTTP REST API Server (`tx-serve`)

Start the HTTP API server:
```bash
tx-serve --port 8787
# Optional API key / secret protection:
AGENT_TOOLS_SECRET="your-secret-key" tx-serve --port 8787
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check, RAM usage, and detected system binaries |
| `GET` | `/schema` | Full OpenAI / Anthropic / MCP JSON tool schemas |
| `GET/POST` | `/search` | Multi-engine Web Search (`{ query, queries?, n?, engine? }`) |
| `GET/POST` | `/images` | Live-verified Image Search (`{ q, n?, safe?, verifyUrls?, download?, outputDir? }`) |
| `POST` | `/images/download` | Parallel verified image downloader (`{ query?, images?, outputDir, count? }`) |
| `GET/POST` | `/fetch` | Website-to-Markdown (`{ url }` or batch `{ urls: string[], autoPuppeteer?: true }`) |
| `GET/POST` | `/puppeteer` | Low-RAM Headless Chromium JS fetch (`{ url, waitUntil?, scrollToBottom?, screenshotPath? }`) |
| `GET/POST` | `/yt` | YouTube tool (`{ input, mode?: 'search'|'transcript'|'video'|'audio'|'info', videoType?: 'long'|'shorts'|'all' }`) |
| `POST` | `/research` | 4-Stage Parallel Deep Research (`{ query, subQueries?, depth?: 'quick'|'standard'|'deep' }`) |

---

## 📦 Node.js / TypeScript SDK Usage

```typescript
import {
  webSearch,
  imageSearch,
  downloadImages,
  fetchMarkdown,
  fetchWithPuppeteer,
  youtubeTool,
  deepResearch,
} from 'tuxscout';

// 1. Web Search
const search = await webSearch({ queries: ['Linux 6.12 kernel', 'Linux 6.12 benchmarks'], n: 10 });

// 2. Live-Verified Image Search
const images = await imageSearch({ query: 'Tux penguin', n: 5, verifyUrls: true });

// 3. Fast Website to Markdown
const page = await fetchMarkdown({ url: 'https://en.wikipedia.org/wiki/Linux', maxChars: 8000 });

// 4. YouTube Search (Long-form only) & Fast Transcript
const videos = await youtubeTool({ input: 'linux kernel tutorial', mode: 'search', videoType: 'long', searchLimit: 5 });
const transcript = await youtubeTool({ input: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', mode: 'transcript' });

// 5. Multi-Stage Deep Research
const dossier = await deepResearch({ query: 'Compare io_uring vs epoll performance', depth: 'standard' });
console.log(dossier.reportMarkdown);
```

---

## 📄 License

Released under the [MIT License](./LICENSE).
