# TuxScout MCP (Model Context Protocol) Integration Guide

TuxScout includes a native, zero-dependency MCP server communicating over `stdio` via JSON-RPC 2.0.

## 1. Client Configuration

### Claude Desktop (`claude_desktop_config.json`)
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tuxscout": {
      "command": "tx-mcp"
    }
  }
}
```
*Note: If `tx-mcp` is not in your system PATH, use `npx -y tuxscout mcp` or `node /absolute/path/to/tuxscout/dist/mcp.js`.*

### Cursor (`.cursor/mcp.json` or Global Settings)
```json
{
  "mcpServers": {
    "tuxscout": {
      "command": "npx",
      "args": ["-y", "tuxscout", "mcp"]
    }
  }
}
```

### Cline / Roo Code / Windsurf
Add TuxScout under MCP servers:
```json
{
  "mcpServers": {
    "tuxscout": {
      "command": "tx-mcp",
      "env": {
        "TUXSCOUT_PROXY": ""
      }
    }
  }
}
```

---

## 2. Exposed MCP Tools Reference

| Tool Name | Key Parameters | Description |
|-----------|----------------|-------------|
| `web_search` | `query`, `queries`, `n`, `searchType`, `site`, `filetype`, `pdfOnly`, `imdbOnly`, `timeRange`, `proxy` | Multi-engine web search with relevance filter & advanced operators |
| `smart_extract` | `target` (`imdb:...`, `pdf:...`, `arxiv:...`, `so:...`, `npm:...`, `url`), `limit`, `maxChars`, `proxy` | Structured knowledge extraction without browser |
| `fetch_markdown` | `url`, `maxChars`, `autoPuppeteer`, `proxy` | Converts HTML/PDF to token-efficient GitHub Flavored Markdown |
| `fetch_puppeteer_js` | `url`, `waitUntil`, `scrollToBottom`, `screenshotPath`, `proxy` | Headless Chromium rendering with ad-blocking and 0 MB idle RAM |
| `image_search` | `query`, `n`, `verifyUrls`, `download`, `outputDir`, `proxy` | 5-engine image search with parallel binary byte validation |
| `image_download` | `query`, `images`, `outputDir`, `count`, `proxy` | Parallel verified image downloader with Referer spoofing |
| `social_intel` | `target`, `platform`, `action`, `limit`, `sort`, `proxy` | Zero-browser scraper for Twitter/X, Instagram, Reddit, GitHub, TikTok |
| `news_intel` | `query`, `category`, `when`, `limit`, `hnItemId`, `proxy` | Live news aggregator (Google News, Hacker News, Reddit, RSS) |
| `youtube_tool` | `input`, `mode` (`transcript`/`search`/`info`/`video`/`audio`), `videoType`, `proxy` | Fast 3-second transcripts, video search, and media download |
| `deep_research` | `query`, `subQueries`, `depth` (`quick`/`standard`/`deep`), `includePdf`, `proxy` | Autonomous 4-stage multi-angle research report generator |

---

## 3. Best Practices for MCP Agents
1. **Pass `searchType: "pdf"` or `"imdb"`** to `web_search` when you need specific document or entertainment queries.
2. **Use `smart_extract`** directly when given well-known URLs (ArXiv, StackOverflow, GitHub, IMDb, Reddit, npm, PyPI) or `.pdf` files to get rich JSON without scraping overhead.
3. **Use `fetch_markdown`** instead of `fetch_puppeteer_js` for documentation and articles; only use `fetch_puppeteer_js` if the page is a blank SPA or requires screenshots.
4. **Use `youtube_tool` with `mode: "transcript"`** to understand video content instantly rather than downloading media files.
