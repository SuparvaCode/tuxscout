# TuxScout CLI Cheatsheet for AI Agents

All commands can be invoked via `tuxscout <cmd>`, `npx tuxscout <cmd>`, or direct binary aliases (`tx-*`).
Always prefer `--json` when you need structured, parseable machine output.

---

## 1. Multi-Engine Web Search (`tx-search` / `tuxscout search`)
```bash
# Basic search (returns title, url, snippet)
tx-search "query" -n 5

# Parseable JSON output
tx-search "query" -n 5 --json

# Parallel multi-angle search (merges results round-robin)
tx-search --query "angle 1" --query "angle 2" --json

# Advanced operators & vertical search modes
tx-search "transformer architecture" --type pdf -n 5
tx-search "linux kernel" --site kernel.org,github.com --time year
tx-search "CUDA optimization" --exact "warp shuffle" --exclude windows
tx-search "breaking tech news" --time day -n 5
```

### Flags
- `-n, --limit <num>`: Max results to return (default: 5)
- `--json`: Output machine-readable JSON
- `--engine <name>`: `duckduckgo` | `brave` | `yahoo` | `wiki` | `bing` | `imdb` | `arxiv` | `openalex`
- `--type <vertical>`: `general` | `pdf` | `imdb` | `academic` | `code` | `docs` | `books`
- `--pdf`: Shorthand for `--type pdf`
- `--imdb`: Shorthand for `--type imdb`
- `--site <domains>`: Restrict to domain(s), comma-separated
- `--exclude-site <dom>`: Exclude domain(s)
- `--filetype <ext>`: Filter by file extension
- `--intitle <term>`: Require term in title
- `--inurl <term>`: Require term in URL
- `--exact <phrase>`: Require exact phrase
- `--exclude <term>`: Exclude term
- `--time <range>`: `day` | `week` | `month` | `year` | `any`
- `--region <code>`: Regional search code (e.g. `us-en`)
- `--proxy <proxy>`: HTTP/HTTPS/SOCKS5 proxy or pool

---

## 2. Dedicated IMDb Search & Extraction (`tx-imdb` / `tuxscout imdb`)
```bash
# Search movies, TV series, actors, directors
tx-imdb "Inception" -n 5 --json

# Extract full dossier by title or person ID
tx-imdb tt1375666 --extract --json
tx-imdb nm0634240 --extract --json

# Extract dossier by query directly
tx-imdb "Interstellar" --extract
```

---

## 3. Dedicated PDF Search & Text Extraction (`tx-pdf` / `tuxscout pdf`)
```bash
# Multi-engine PDF search (Web + ArXiv + OpenAlex)
tx-pdf "Attention Is All You Need" -n 5 --json

# Extract text & metadata directly from remote PDF URL (0 external dependencies)
tx-pdf "https://arxiv.org/pdf/1706.03762.pdf" --extract --max-chars 10000

# JSON output with title, author, pageCount, and text
tx-pdf "https://arxiv.org/pdf/1706.03762.pdf" --extract --json
```

---

## 4. Website-to-Markdown Fetcher (`tx-fetch` / `tuxscout fetch`)
```bash
# Fast Readability-style clean Markdown extraction
tx-fetch "https://en.wikipedia.org/wiki/Linux" --max-chars 8000

# Output structured JSON (title, markdown, url, status, ms)
tx-fetch "https://news.ycombinator.com" --json

# Batch fetch multiple URLs in parallel
tx-fetch "https://site1.com" "https://site2.com" --json
```

---

## 5. Zero-Browser Smart Knowledge Extractor (`tx-extract` / `tuxscout extract`)
Instantly resolves structured data from prefixes or URLs in `<1s` without a browser:
```bash
tx-extract "imdb:Oppenheimer"                      # Movie/TV dossier
tx-extract "pdf:https://arxiv.org/pdf/1706.03762.pdf" # PDF text & metadata
tx-extract "arxiv:1706.03762"                      # ArXiv paper abstract & metadata
tx-extract "so:how to cancel fetch in javascript"  # StackOverflow Q&A with code blocks
tx-extract "npm:tuxscout"                          # NPM package stats & weekly downloads
tx-extract "pypi:fastapi"                          # PyPI package stats & dependencies
tx-extract "wiki:Linux_kernel"                     # Wikipedia summary
tx-extract "gh:torvalds/linux"                     # GitHub repo overview & releases
tx-extract "https://example.com"                   # JSON-LD, tables, metadata, markdown
```

---

## 6. Zero-Browser Social Media Intel (`tx-social` / `tuxscout social`)
```bash
# Twitter/X (single tweet, thread stats, or profile)
tx-social "https://x.com/jack/status/20" --json
tx-social "@nasa" --platform twitter -n 5 --json

# Instagram (profile or post/reel)
tx-social "@nasa" --platform instagram -n 5 --json
tx-social "https://www.instagram.com/p/DWq-l0gDegd/" --json

# Reddit (subreddit feeds or post comment trees)
tx-social "r/linux" --sort hot -n 10 --json
tx-social "https://www.reddit.com/r/technology/comments/..." --json

# GitHub (trending repos or repo overview)
tx-social "gh:trending" --lang rust --json
tx-social "torvalds/linux" --json

# TikTok (oEmbed info & author metadata)
tx-social "https://www.tiktok.com/@scout/video/..." --json
```

---

## 7. Live Tech & Global News Intel (`tx-news` / `tuxscout news`)
```bash
# Categorized news: ai, tech, security, linux, opensource, hn, top, world, crypto, science
tx-news --category ai -n 10 --json
tx-news --category hn -n 15 --json

# Search news by topic with recency filter: 1h, 24h, 7d, 30d
tx-news "deepseek v3" --when 7d -n 10 --json

# Fetch full nested Hacker News comment tree
tx-news --hn-id 8863 --json
```

---

## 8. YouTube Transcript, Search & Media Downloader (`tx-yt` / `tuxscout yt`)
```bash
# Search long-form videos only (default excludes Shorts)
tx-yt "linux kernel tutorial" -n 5 --json

# Search Shorts only (<=60s)
tx-yt "linux tips" --shorts -n 5 --json

# Fast transcript extraction in ~3 seconds (clean Markdown + timestamps)
tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode transcript

# Video info metadata
tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode info --json

# Download audio (mp3, m4a, opus, flac) or video (mp4, mkv)
tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode audio --format mp3 --out ./music
tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode video --height 720 --out ./videos
```

---

## 9. Ultra-Low-RAM Puppeteer Browser (`tx-browser` / `tuxscout browser`)
Used only when JavaScript execution, SPA rendering, or screenshots are required:
```bash
tx-browser "https://react.dev" --wait networkidle2 --json
tx-browser "https://example.com" --screenshot ./shot.png
tx-browser "https://infinite-scroll-site.com" --scroll --max-chars 10000
```

---

## 10. 4-Stage Autonomous Deep Research (`tx-research` / `tuxscout research`)
```bash
# Quick synthesis (2 angles, 4 sources)
tx-research "Compare DuckDB vs SQLite WAL mode" --depth quick

# Comprehensive report with images, YouTube references, and saved markdown
tx-research "Recent breakthroughs in room temperature superconductors" \
  --depth standard --images --yt --save ./report.md
```

---

## 11. Universal Proxy Support (`--proxy`)
Works seamlessly across **all** commands:
```bash
# Single proxy (HTTP, HTTPS, SOCKS5)
tx-search "linux" --proxy socks5://127.0.0.1:1080
tx-social "@nasa" --proxy 192.168.1.10:8080:user:pass

# Rotation pool (comma-separated, auto-failover)
tx-research "ai news" --proxy "http://p1:8080,socks5://p2:1080"
```
Or set environment variables:
`export TUXSCOUT_PROXY="socks5://127.0.0.1:1080"`
