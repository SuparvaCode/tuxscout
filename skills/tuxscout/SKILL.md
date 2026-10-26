---
name: tuxscout
description: >-
  Ultra-fast, cross-platform AI agent reconnaissance, web search, PDF & IMDb intelligence,
  social reconnaissance (X/Twitter, Reddit, Instagram, GitHub, TikTok), live tech news,
  low-memory headless browser automation, YouTube transcript/media downloader, and multi-stage
  deep research with zero-dependency proxy rotation (HTTP/HTTPS/SOCKS5). Use this skill whenever
  an AI agent needs to perform internet research, extract clean Markdown from webpages or PDFs,
  inspect social profiles/posts without browser overhead, fetch YouTube transcripts in 3-4s,
  look up IMDb movies/actors, or route traffic through proxy pools.
---

# TuxScout AI Agent Skill

TuxScout (`tuxscout`) is a cross-platform, ultra-low-RAM intelligence suite engineered specifically for autonomous AI agents. It prioritizes **speed**, **0 MB idle RAM**, **zero browser overhead** whenever possible, and **clean Markdown/JSON output** to protect LLM context windows.

---

## 🎯 When to Use TuxScout

Activate this skill when you need to:
1. **Search the Web**: Multi-engine search with relevance filtering, date ranges (`--time`), or domain scoping (`--site`).
2. **Find & Read PDFs**: Multi-engine PDF search (`tx-pdf`) and instant text extraction from remote `.pdf` files without external dependencies.
3. **Lookup Movies, TV Series & Actors**: IMDb search (`tx-imdb`) and deep dossier extraction (`plot`, `rating`, `directors`, `cast`).
4. **Scrape Social Media (<1s, 0 Browser)**: Read X/Twitter tweets/threads, Reddit subreddit feeds & comment trees, Instagram profiles/reels, GitHub trending repos, and TikTok metadata.
5. **Fetch Clean Web Content**: Convert websites to clean GitHub-Flavored Markdown (`tx-fetch`) while stripping ads, scripts, and navigation clutter.
6. **Fetch YouTube Transcripts**: Get timestamped video transcripts in ~3 seconds (`tx-yt <url> --mode transcript`) without 429 rate limits.
7. **Read Live Tech & AI News**: Google News RSS, Hacker News stories & nested comment trees, and curated tech feeds (`tx-news`).
8. **Render Complex SPAs / Take Screenshots**: Headless Chromium with aggressive ad/tracker blocking and 0 MB idle RAM (`tx-browser`).
9. **Conduct Multi-Stage Research**: Autonomous query expansion, parallel search, and citation-backed report synthesis (`tx-research`).
10. **Bypass IP Blocks / Rate Limits**: Pass `--proxy` (HTTP, HTTPS, SOCKS5, or comma-separated pool) to **any** tool.

---

## ⚡ Quick Decision Matrix for AI Agents

| Task / Goal | Preferred Command | Shorthand | Key Flags |
|---|---|---|---|
| General web search | `tuxscout search "<query>"` | `tx-search` | `-n 5 --json --time week` |
| Academic / technical PDF search | `tuxscout pdf "<query>"` | `tx-pdf` | `-n 5 --json` |
| Read remote PDF text | `tuxscout pdf "<url>" --extract` | `tx-pdf` | `--max-chars 8000 --json` |
| Movie / TV / Actor lookup | `tuxscout imdb "<title>"` | `tx-imdb` | `-n 5 --json` |
| Movie / TV dossier extraction | `tuxscout imdb "<id|title>" --extract` | `tx-imdb` | `--json` |
| Read webpage as Markdown | `tuxscout fetch "<url>"` | `tx-fetch` | `--max-chars 8000 --json` |
| Extract known entity (SO, Wiki, ArXiv, NPM) | `tuxscout extract "<prefix:id>"` | `tx-extract` | `--json` |
| Inspect Tweet or X profile | `tuxscout social "<url|@user>"` | `tx-social` | `--platform twitter --json` |
| Read Subreddit or Reddit thread | `tuxscout social "r/<subname>"` | `tx-social` | `-n 10 --sort hot --json` |
| Check GitHub Trending / Repo | `tuxscout social "gh:trending"` | `tx-social` | `--lang typescript --json` |
| Fresh AI / Tech news | `tuxscout news --category ai` | `tx-news` | `-n 10 --when 24h --json` |
| Hacker News story & comments | `tuxscout news --hn-id <id>` | `tx-news` | `--json` |
| YouTube fast transcript | `tuxscout yt "<url>" --mode transcript` | `tx-yt` | `--transcript` |
| Render JS SPA / Screenshot | `tuxscout browser "<url>"` | `tx-browser` | `--screenshot ./shot.png` |
| Deep multi-angle topic research | `tuxscout research "<topic>"` | `tx-research` | `--depth standard --save ./r.md` |

---

## 📋 Core Agent Guidelines

### 1. Always Prefer `--json` for Machine Consumption
When you need to parse results programmatically, add `--json`. It outputs clean JSON objects:
```bash
tx-search "fastapi vs axum" -n 3 --json
tx-extract "arxiv:1706.03762" --json
```

### 2. Guard Token Context with `-n` and `--max-chars`
Avoid dumping megabytes of text into context:
- For searches, limit results: `-n 3` or `-n 5`.
- For text extraction: use `--max-chars 6000` or `--max-chars 10000`.

### 3. Progressive Escalation: Fetch vs Browser
- **Step 1**: Use `tx-fetch <url>`. It executes lightweight HTTP requests and extracts clean Markdown via heuristic content extraction.
- **Step 2**: Only if `tx-fetch` encounters an impenetrable SPA shell or Cloudflare wall does it escalate to `tx-browser`. Do NOT invoke `tx-browser` directly unless screenshots or heavy JavaScript execution are explicitly needed.

### 4. Smart Target Prefixes in `tx-extract`
Save time by passing prefixed targets directly:
- `imdb:Inception` or `tt1375666`
- `pdf:https://arxiv.org/pdf/1706.03762.pdf`
- `arxiv:1706.03762`
- `so:how to parse json in bash`
- `npm:tuxscout`
- `pypi:fastapi`
- `wiki:Artificial_intelligence`
- `gh:torvalds/linux` or `gh:trending`

### 5. Universal Proxy IP Usage
If you encounter geo-blocks, CAPTCHAs, or rate limits:
- Pass `--proxy <url|list>` to any command.
- Formats supported: `http://user:pass@host:port`, `socks5://host:port`, `host:port:user:pass`.
- Rotation pool: `--proxy "http://1.1.1.1:8080,socks5://2.2.2.2:1080"`
- Or set environment variable: `export TUXSCOUT_PROXY="socks5://127.0.0.1:1080"`

---

## 🔗 Detailed Reference Guides
- [CLI Cheatsheet & Command Options](./references/cli-cheatsheet.md)
- [MCP (Model Context Protocol) Server Integration](./references/mcp-cheatsheet.md)
