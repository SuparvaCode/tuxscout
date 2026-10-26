#!/usr/bin/env node
// src/cli.ts
// Unified CLI for Agent Tools Pack (`agent-tools` and shorthand `at-*` commands).
import fs from 'node:fs/promises';
import path from 'node:path';
import { setGlobalProxy } from './utils/http.js';
import { searchImdb, searchPdf, webSearch, } from './tools/web-search.js';
import { downloadImages, imageSearch } from './tools/image-search.js';
import { fetchMarkdown, fetchMarkdownBatch } from './tools/markdown-fetch.js';
import { closePuppeteerPool, fetchWithPuppeteer, findBrowserExecutable, } from './tools/puppeteer-fetch.js';
import { ensureYtDlp, extractVideoId, findFfmpegBinary, youtubeTool, } from './tools/yt-downloader.js';
import { deepResearch } from './tools/deep-research.js';
import { socialIntel } from './tools/social-intel.js';
import { newsIntel } from './tools/news-intel.js';
import { smartExtract } from './tools/smart-extract.js';
import { startServer } from './server.js';
import { MCP_TOOLS, startMcpServer } from './mcp.js';
function parseCliArgs(argv) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const eqIdx = arg.indexOf('=');
            if (eqIdx !== -1) {
                const key = arg.slice(2, eqIdx);
                const val = arg.slice(eqIdx + 1);
                flags[key] = val;
            }
            else {
                const key = arg.slice(2);
                const next = argv[i + 1];
                if (next && !next.startsWith('-')) {
                    if (flags[key] !== undefined) {
                        const prev = flags[key];
                        flags[key] = Array.isArray(prev) ? [...prev, next] : [String(prev), next];
                    }
                    else {
                        flags[key] = next;
                    }
                    i++;
                }
                else {
                    flags[key] = true;
                }
            }
        }
        else if (arg.startsWith('-') && arg.length === 2) {
            const key = arg.slice(1);
            const next = argv[i + 1];
            if (next && !next.startsWith('-')) {
                flags[key] = next;
                i++;
            }
            else {
                flags[key] = true;
            }
        }
        else {
            positional.push(arg);
        }
    }
    return { positional, flags };
}
function printHelp() {
    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                 TUXSCOUT v1.1.1 (Linux • Windows • macOS)                  ║
║   Web Search • IMDb • PDF Search/Extract • Social Intel • Live News        ║
║     Markdown Fetch • Low-RAM Puppeteer JS • YouTube • Proxy Rotation       ║
╚════════════════════════════════════════════════════════════════════════════╝

USAGE:
  tuxscout <command> [arguments] [flags]

COMMANDS & SHORTHAND BINARIES:
  search   (tx-search)    Multi-engine Web Search + Advanced Filters (PDF, IMDb, Academic, Code, Site)
  imdb                    IMDb Movie/TV/Actor Search & Rich Title Dossier Extractor
  pdf                     PDF Document Search (Web + ArXiv + OpenAlex) & Direct PDF Text Extractor
  images   (tx-images)    5-Engine Image Search & Parallel Verified Downloader
  social   (tx-social)    Zero-browser Social Scraper (Twitter/X, Instagram, Reddit, GitHub, TikTok)
  news     (tx-news)      Live News & Tech Intelligence (Google News, HackerNews, Reddit, Curated RSS)
  extract  (tx-extract)   Zero-browser Smart Knowledge Extractor (IMDb, PDF, SO, ArXiv, Wiki, NPM, PyPI)
  fetch    (tx-fetch)     Fast Website-to-Markdown fetch (auto-intercepts PDF/IMDb/Social & JS fallback)
  browser  (tx-browser)   Ultra-low-RAM Headless Chromium / Puppeteer JS fetch
  yt       (tx-yt)        YouTube Video, Music/Audio, Search & Transcript tool
  research (tx-research)  4-Stage Parallel Multi-Angle Search & Deep Research
  serve    (tx-serve)     Start the HTTP REST API server (Delphos compatible)
  mcp      (tx-mcp)       Start the Model Context Protocol (MCP) stdio server
  schema                  Output JSON tool schemas for AI Agents / LLM Function Calling
  setup                   Bootstrap yt-dlp binary & verify Chrome/ffmpeg on any OS
  doctor                  Verify binaries (Chromium, yt-dlp, ffmpeg) & live test
  test                    Run the end-to-end verification suite

GLOBAL PROXY SUPPORT (works across all commands):
  --proxy <url|list>      HTTP/HTTPS/SOCKS5 proxy or comma-separated rotation pool
                          Formats: http://user:pass@host:port, socks5://host:port, host:port:user:pass
                          Env vars: TUXSCOUT_PROXY, ALL_PROXY, HTTPS_PROXY, HTTP_PROXY

ADVANCED SEARCH FLAGS (for 'search'):
  --type <vertical>       general | pdf | imdb | academic | code | docs | books
  --pdf                   Shorthand for --type pdf (search only PDF documents)
  --imdb                  Shorthand for --type imdb (search IMDb titles & people)
  --filetype <ext>        Filter by file extension (e.g. pdf, docx, csv)
  --site <domain>         Restrict to domain(s) (e.g. --site github.com)
  --exclude-site <dom>    Exclude domain(s) (e.g. --exclude-site pinterest.com)
  --intitle <term>        Require term in page title
  --inurl <term>          Require term in page URL
  --exact <phrase>        Require exact phrase match
  --exclude <term>        Exclude word/phrase
  --time <range>          day | week | month | year | any
  --region <code >        Region code (e.g. us-en, uk-en, in-en)

EXAMPLES:
  # 1. Advanced Search, IMDb & PDF Intelligence
  tuxscout search "transformer architecture" --pdf --time year -n 5
  tuxscout search "cuda kernel optimization" --type code --site github.com
  tuxscout imdb "Oppenheimer"                                   # IMDb title dossier + rating/cast/plot
  tuxscout imdb "tt15398776"                                    # Direct IMDb ID extraction
  tuxscout pdf "linux ebpf whitepaper" -n 5                     # Multi-engine + ArXiv/OpenAlex PDF search
  tuxscout pdf "https://arxiv.org/pdf/1706.03762.pdf"           # Extract text & metadata from PDF URL

  # 2. Proxy IP Support across any method
  tuxscout search "my ip" --proxy socks5://127.0.0.1:1080
  tuxscout fetch https://example.com --proxy "http://p1:8080,http://p2:8080"

  # 3. Social Media Reconnaissance (Zero-Browser Structured JSON/Markdown)
  tx-social "https://x.com/jack/status/20"                      # X/Twitter single tweet & thread stats
  tx-social "@torvalds" --platform twitter -n 5                 # X/Twitter profile + recent tweets
  tx-social "@nasa" --platform instagram -n 5                   # Instagram profile + recent posts/reels
  tx-social "https://www.instagram.com/p/DWq-l0gDegd/"          # Instagram post/reel full caption & stats
  tx-social "r/linux" --sort hot -n 10                          # Reddit subreddit feed
  tx-social "gh:trending" --lang typescript                     # GitHub trending repositories
  tx-social "torvalds/linux"                                    # GitHub repo overview, releases & README

  # 4. Live News & Tech Intelligence Aggregator
  tx-news --category ai -n 10                                   # Live AI news (Google News + HN + Tech RSS)
  tx-news "Linux kernel 6.14" --when 7d -n 10                   # Topic news search within last 7 days
  tx-news --category hn -n 15                                   # Hacker News frontpage
  tx-news --hn-id 8863                                          # Full Hacker News story + comment tree

  # 5. Zero-Browser Smart Knowledge Extractor
  tx-extract "imdb:Interstellar"                                # IMDb movie dossier & cast
  tx-extract "pdf:https://arxiv.org/pdf/1706.03762.pdf"         # Direct PDF text extraction
  tx-extract "https://stackoverflow.com/questions/11227809"     # StackOverflow question + top answers
  tx-extract "arxiv:1706.03762"                                 # ArXiv paper abstract, authors & PDF link
  tx-extract "npm:tuxscout"                                     # NPM package metadata & weekly downloads
  tx-extract "pypi:fastapi"                                     # PyPI package metadata & dependencies
  tx-extract "wiki:Linux_kernel"                                # Wikipedia structured summary

  # 6. Web Search & Verified Image Search/Download
  tx-search "Gemini 4 release notes" -n 10 --json
  tx-images "mountain landscape wallpaper" --download --out ./wallpapers -n 5

  # 7. Fast Website-to-Markdown & Low-RAM Puppeteer JS Fetch
  tx-fetch https://en.wikipedia.org/wiki/Linux --max-chars 5000
  tx-browser https://example.com --scroll --screenshot ./page.png

  # 8. YouTube Video / Music / Transcript / Search (filters Shorts vs Long videos)
  tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode transcript
  tx-yt "linux kernel tutorial" -n 5                            # Long-form videos only (default)
  tx-yt "linux tips" --shorts -n 5                              # YouTube Shorts only (<=60s)

  # 9. Multi-Stage Parallel Deep Research
  tx-research "Compare Bun vs Node.js v24 performance" --depth standard --save ./report.md
`);
}
function flagToStringOrArray(val) {
    if (typeof val === 'string')
        return val;
    if (Array.isArray(val))
        return val;
    return undefined;
}
export async function runCommand(command, rawArgs) {
    const { positional, flags } = parseCliArgs(rawArgs);
    const asJson = Boolean(flags.json || flags.j);
    const proxy = flagToStringOrArray(flags.proxy);
    if (proxy) {
        setGlobalProxy(proxy);
    }
    switch (command) {
        case 'search':
        case 'web': {
            const queries = [];
            if (Array.isArray(flags.query)) {
                queries.push(...flags.query);
            }
            else if (typeof flags.query === 'string') {
                queries.push(flags.query);
            }
            if (positional.length > 0) {
                queries.push(positional.join(' '));
            }
            if (!queries.length) {
                console.error('Error: Please provide a search query. Example: at-search "your query"');
                process.exit(1);
            }
            const n = Number(flags.n || flags.count || 10);
            const engine = typeof flags.engine === 'string' ? flags.engine : undefined;
            const rawType = typeof (flags.type || flags['search-type']) === 'string'
                ? String(flags.type || flags['search-type']).toLowerCase()
                : flags.pdf || flags['pdf-only']
                    ? 'pdf'
                    : flags.imdb
                        ? 'imdb'
                        : undefined;
            const searchType = rawType;
            const site = flagToStringOrArray(flags.site);
            const excludeSite = flagToStringOrArray(flags['exclude-site'] || flags.excludeSite);
            const filetype = typeof (flags.filetype || flags.ext) === 'string'
                ? String(flags.filetype || flags.ext)
                : undefined;
            const pdfOnly = Boolean(flags.pdf || flags['pdf-only'] || flags.pdfOnly);
            const intitle = typeof flags.intitle === 'string' ? flags.intitle : undefined;
            const inurl = typeof flags.inurl === 'string' ? flags.inurl : undefined;
            const exactPhrase = typeof (flags.exact || flags.phrase) === 'string'
                ? String(flags.exact || flags.phrase)
                : undefined;
            const excludeTerms = flagToStringOrArray(flags.exclude || flags['exclude-terms']);
            const timeRange = (typeof (flags.time || flags.when || flags['time-range']) === 'string'
                ? String(flags.time || flags.when || flags['time-range'])
                : undefined);
            const region = typeof flags.region === 'string' ? flags.region : undefined;
            const res = await webSearch({
                queries,
                n,
                engine,
                proxy,
                searchType,
                site,
                excludeSite,
                filetype,
                pdfOnly,
                intitle,
                inurl,
                exactPhrase,
                excludeTerms,
                timeRange,
                region,
            });
            if (asJson) {
                console.log(JSON.stringify(res, null, 2));
            }
            else {
                console.log(`# Web Search (${res.sources.length} results via [${res.engines.join(', ')}] in ${res.ms}ms, intent=${res.intent}${res.searchType && res.searchType !== 'general' ? `, type=${res.searchType}` : ''})\n`);
                res.sources.forEach((s, i) => {
                    const badge = s.fileType ? `[${s.fileType.toUpperCase()}] ` : '';
                    console.log(`${i + 1}. ${badge}**${s.title}**`);
                    console.log(`   URL: ${s.url}`);
                    if (s.description)
                        console.log(`   ${s.description}`);
                    console.log('');
                });
            }
            break;
        }
        case 'imdb': {
            const target = typeof flags.target === 'string'
                ? flags.target
                : typeof flags.query === 'string'
                    ? flags.query
                    : positional.join(' ');
            if (!target) {
                console.error('Error: Provide an IMDb query, title/person ID (tt.../nm...), or URL. Example: tuxscout imdb "Inception"');
                process.exit(1);
            }
            const n = Number(flags.n || flags.limit || flags.count || 8);
            if (flags['search-only'] || flags.search) {
                const res = await searchImdb(target, n, proxy);
                if (asJson) {
                    console.log(JSON.stringify(res, null, 2));
                }
                else {
                    console.log(`# IMDb Search Results (${res.sources.length} matches in ${res.ms}ms)\n`);
                    res.sources.forEach((s, i) => {
                        console.log(`${i + 1}. **${s.title}**`);
                        console.log(`   URL: ${s.url}`);
                        if (s.description)
                            console.log(`   ${s.description}`);
                        console.log('');
                    });
                }
            }
            else {
                const prefixed = /^(imdb:|https?:\/\/|(?:tt|nm)\d{5,10}$)/i.test(target.trim())
                    ? target.trim()
                    : `imdb:${target.trim()}`;
                const res = await smartExtract({
                    target: prefixed,
                    provider: 'imdb',
                    limit: n,
                    proxy,
                });
                if (asJson) {
                    console.log(JSON.stringify(res, null, 2));
                }
                else {
                    console.log(res.markdown);
                }
            }
            break;
        }
        case 'pdf': {
            const target = typeof flags.url === 'string'
                ? flags.url
                : typeof flags.query === 'string'
                    ? flags.query
                    : positional.join(' ');
            if (!target) {
                console.error('Error: Provide a PDF search query or direct PDF URL. Example: tuxscout pdf "linux ebpf"');
                process.exit(1);
            }
            const isDirectUrl = /^https?:\/\//i.test(target.trim()) || /^pdf:https?:\/\//i.test(target.trim());
            if (isDirectUrl || flags.extract) {
                const maxChars = Number(flags['max-chars'] || flags.maxChars || 12000);
                const res = await smartExtract({
                    target: target.trim(),
                    provider: 'pdf',
                    maxChars,
                    proxy,
                });
                if (asJson) {
                    console.log(JSON.stringify(res, null, 2));
                }
                else {
                    console.log(res.markdown);
                }
            }
            else {
                const n = Number(flags.n || flags.limit || flags.count || 10);
                const site = flagToStringOrArray(flags.site);
                const timeRange = (typeof (flags.time || flags.when) === 'string' ? String(flags.time || flags.when) : undefined);
                const res = await searchPdf(target, { n, proxy, site, timeRange });
                if (asJson) {
                    console.log(JSON.stringify(res, null, 2));
                }
                else {
                    console.log(`# PDF Search (${res.sources.length} PDF documents via [${res.engines.join(', ')}] in ${res.ms}ms)\n`);
                    res.sources.forEach((s, i) => {
                        console.log(`${i + 1}. [PDF] **${s.title}**`);
                        console.log(`   URL: ${s.url}`);
                        if (s.description)
                            console.log(`   ${s.description}`);
                        console.log('');
                    });
                }
            }
            break;
        }
        case 'images':
        case 'img': {
            const query = typeof flags.query === 'string' ? flags.query : positional.join(' ');
            const n = Number(flags.n || flags.count || 10);
            const safe = (typeof flags.safe === 'string' ? flags.safe : 'moderate');
            const engine = typeof flags.engine === 'string' ? flags.engine : undefined;
            const shouldDownload = Boolean(flags.download || flags.dl || flags.out || flags.output);
            if (shouldDownload) {
                const outDir = typeof (flags.out || flags.output) === 'string'
                    ? String(flags.out || flags.output)
                    : './downloads/images';
                const urls = Array.isArray(flags.url)
                    ? flags.url
                    : typeof flags.url === 'string'
                        ? [flags.url]
                        : undefined;
                const dlRes = await downloadImages({
                    query: query || undefined,
                    images: urls,
                    outputDir: outDir,
                    count: n,
                    safe,
                    engine,
                    proxy,
                });
                if (asJson) {
                    console.log(JSON.stringify(dlRes, null, 2));
                }
                else {
                    console.log(`Downloaded ${dlRes.downloadedCount}/${dlRes.requested} verified images to ${dlRes.outputDir} in ${dlRes.ms}ms:`);
                    for (const img of dlRes.downloaded) {
                        console.log(`  - ${img.fileName} (${Math.round(img.bytes / 1024)} KB, ${img.detectedType}) <- ${img.imageUrl}`);
                    }
                    if (dlRes.manifestPath) {
                        console.log(`Manifest saved: ${dlRes.manifestPath}`);
                    }
                }
            }
            else {
                if (!query) {
                    console.error('Error: Please provide an image query. Example: tx-images "query"');
                    process.exit(1);
                }
                const verifyUrls = flags['no-verify'] ? false : true;
                const res = await imageSearch({ query, n, safe, engine, verifyUrls, proxy });
                if (asJson) {
                    console.log(JSON.stringify(res, null, 2));
                }
                else {
                    console.log(`# Image Search (${res.showing} ${verifyUrls ? 'verified live ' : ''}results via [${res.engines.join(', ')}] in ${res.ms}ms)\n`);
                    res.images.forEach((img, i) => {
                        console.log(`${i + 1}. **${img.title || 'Untitled'}** (${img.width}x${img.height} ${img.type}) [${img.engine}]`);
                        console.log(`   Image:  ${img.imageUrl}`);
                        console.log(`   Source: ${img.sourceUrl || img.sourceSite}`);
                        console.log('');
                    });
                }
            }
            break;
        }
        case 'fetch':
        case 'md': {
            const urls = positional.filter((u) => /^https?:\/\//i.test(u));
            if (typeof flags.url === 'string')
                urls.push(flags.url);
            if (!urls.length) {
                console.error('Error: Please provide at least one http(s) URL. Example: at-fetch https://example.com');
                process.exit(1);
            }
            const maxChars = Number(flags['max-chars'] || flags.maxChars || 0);
            const includeLinks = flags['no-links'] ? false : true;
            const includeImages = Boolean(flags.images);
            const autoPuppeteer = flags['no-puppeteer'] ? false : true;
            const forcePuppeteer = Boolean(flags.puppeteer || flags['force-puppeteer']);
            try {
                if (urls.length === 1) {
                    const res = await fetchMarkdown({
                        url: urls[0],
                        maxChars,
                        includeLinks,
                        includeImages,
                        autoPuppeteer,
                        forcePuppeteer,
                        proxy,
                    });
                    if (typeof flags.save === 'string' || typeof flags.out === 'string') {
                        const outPath = path.resolve(String(flags.save || flags.out));
                        await fs.mkdir(path.dirname(outPath), { recursive: true });
                        await fs.writeFile(outPath, res.markdown, 'utf8');
                    }
                    if (asJson) {
                        console.log(JSON.stringify(res, null, 2));
                    }
                    else {
                        console.log(`<!-- Fetched ${res.finalUrl} via ${res.method} (status=${res.status}, words=${res.wordCount}, ${res.ms}ms) -->\n`);
                        if (res.title)
                            console.log(`# ${res.title}\n`);
                        console.log(res.markdown);
                    }
                }
                else {
                    const batch = await fetchMarkdownBatch(urls, {
                        maxChars,
                        includeLinks,
                        includeImages,
                        autoPuppeteer,
                        forcePuppeteer,
                        proxy,
                    });
                    if (asJson) {
                        console.log(JSON.stringify(batch, null, 2));
                    }
                    else {
                        for (const res of batch) {
                            console.log(`\n========================================`);
                            console.log(`URL: ${res.finalUrl} (${res.method}, ${res.wordCount} words, ${res.ms}ms)`);
                            console.log(`========================================\n`);
                            console.log(res.markdown);
                        }
                    }
                }
            }
            finally {
                await closePuppeteerPool();
            }
            break;
        }
        case 'browser':
        case 'puppeteer': {
            const url = typeof flags.url === 'string' ? flags.url : positional[0];
            if (!url) {
                console.error('Error: Please provide a URL. Example: at-browser https://example.com');
                process.exit(1);
            }
            const waitUntil = (typeof flags.wait === 'string' ? flags.wait : 'domcontentloaded');
            const maxChars = Number(flags['max-chars'] || flags.maxChars || 0);
            const screenshotPath = typeof flags.screenshot === 'string' ? flags.screenshot : undefined;
            const evaluateScript = typeof flags.eval === 'string' ? flags.eval : undefined;
            const waitForSelector = typeof flags.selector === 'string' ? flags.selector : undefined;
            const res = await fetchWithPuppeteer({
                url,
                waitUntil,
                waitForSelector,
                scrollToBottom: Boolean(flags.scroll),
                screenshotPath,
                fullPageScreenshot: Boolean(flags['full-page']),
                evaluateScript,
                maxChars,
                closeBrowserAfter: true,
                proxy,
            });
            if (asJson) {
                console.log(JSON.stringify(res, null, 2));
            }
            else {
                console.log(`<!-- Puppeteer JS Fetch: ${res.finalUrl} (status=${res.status}, blocked=${res.blockedRequestsCount} reqs, allowed=${res.allowedRequestsCount} reqs, ${res.ms}ms) -->\n`);
                if (res.title)
                    console.log(`# ${res.title}\n`);
                if (res.evaluatedResult !== undefined) {
                    console.log(`## Evaluated Result\n\`\`\`json\n${JSON.stringify(res.evaluatedResult, null, 2)}\n\`\`\`\n`);
                }
                if (res.screenshotPath) {
                    console.log(`> Screenshot saved to: ${res.screenshotPath}\n`);
                }
                console.log(res.markdown);
            }
            break;
        }
        case 'yt':
        case 'youtube': {
            const input = typeof flags.input === 'string'
                ? flags.input
                : typeof flags.url === 'string'
                    ? flags.url
                    : positional.join(' ');
            if (!input) {
                console.error('Error: Provide a YouTube URL or search query. Example: tx-yt "https://www.youtube.com/watch?v=..." --mode transcript');
                process.exit(1);
            }
            const isUrlOrId = /^https?:\/\//i.test(input) || Boolean(extractVideoId(input));
            let mode;
            if (flags.audio || flags.music)
                mode = 'audio';
            else if (flags.transcript || flags.subs)
                mode = 'transcript';
            else if (flags.info)
                mode = 'info';
            else if (flags.search || flags.shorts)
                mode = 'search';
            else if (flags.video || flags.download || flags.dl)
                mode = 'video';
            else if (typeof flags.mode === 'string')
                mode = flags.mode;
            else
                mode = isUrlOrId ? 'video' : 'search';
            let videoType = 'long';
            if (flags.shorts)
                videoType = 'shorts';
            else if (flags.all)
                videoType = 'all';
            else if (flags.long)
                videoType = 'long';
            else if (typeof flags.type === 'string') {
                const t = flags.type.toLowerCase();
                if (t === 'shorts' || t === 'short')
                    videoType = 'shorts';
                else if (t === 'all' || t === 'both')
                    videoType = 'all';
                else
                    videoType = 'long';
            }
            const outDir = typeof (flags.out || flags.output || flags.dir) === 'string'
                ? String(flags.out || flags.output || flags.dir)
                : './downloads/youtube';
            const res = await youtubeTool({
                input,
                mode,
                videoType,
                outputDir: outDir,
                audioFormat: (typeof flags.format === 'string' ? flags.format : undefined),
                videoFormat: (typeof flags.format === 'string' ? flags.format : undefined),
                maxHeight: flags.height ? Number(flags.height) : undefined,
                searchLimit: (flags.n || flags.count || flags.limit)
                    ? Number(flags.n || flags.count || flags.limit)
                    : undefined,
                subLang: typeof flags.lang === 'string' ? flags.lang : undefined,
                cookiesFile: typeof flags.cookies === 'string' ? flags.cookies : undefined,
                proxy,
            });
            if (asJson) {
                console.log(JSON.stringify(res, null, 2));
            }
            else if (!res.ok) {
                console.error(`YouTube tool error: ${res.error}`);
                process.exit(1);
            }
            else if (mode === 'search' && res.searchResults) {
                const filterLabel = videoType === 'shorts'
                    ? 'Shorts only (<=60s)'
                    : videoType === 'all'
                        ? 'All videos & Shorts'
                        : 'Long-form videos only (Shorts excluded)';
                console.log(`# YouTube Search Results (${res.searchResults.length} videos | Filter: ${filterLabel} | ${res.ms}ms)\n`);
                res.searchResults.forEach((v, i) => {
                    const badge = v.isShort ? '[SHORT]' : '[VIDEO]';
                    console.log(`${i + 1}. ${badge} **${v.title}** (${v.durationString}) — ${v.channel}`);
                    console.log(`   URL:   ${v.url}`);
                    console.log(`   Views: ${v.viewCount.toLocaleString()}`);
                    console.log('');
                });
            }
            else if (mode === 'transcript' && res.transcript) {
                console.log(res.transcript.markdown);
            }
            else if (mode === 'info' && res.metadata) {
                console.log(JSON.stringify(res.metadata, null, 2));
            }
            else {
                console.log(`Successfully downloaded (${mode}) in ${res.ms}ms:`);
                console.log(`  File:  ${res.filePath}`);
                console.log(`  Size:  ${res.bytes ? (res.bytes / 1024 / 1024).toFixed(2) + ' MB' : 'unknown'}`);
                if (res.metadata?.title)
                    console.log(`  Title: ${res.metadata.title}`);
            }
            break;
        }
        case 'research': {
            const query = typeof flags.query === 'string' ? flags.query : positional.join(' ');
            if (!query) {
                console.error('Error: Provide a research query. Example: at-research "topic"');
                process.exit(1);
            }
            const depth = (typeof flags.depth === 'string' ? flags.depth : 'standard');
            const maxPages = flags.pages ? Number(flags.pages) : undefined;
            const subQueries = Array.isArray(flags.sub)
                ? flags.sub
                : typeof flags.sub === 'string'
                    ? [flags.sub]
                    : undefined;
            try {
                const res = await deepResearch({
                    query,
                    subQueries,
                    depth,
                    maxPages,
                    includeImages: Boolean(flags.images),
                    includeYoutube: Boolean(flags.yt || flags.youtube),
                    includePdf: Boolean(flags.pdf || flags['include-pdf']),
                    searchType: typeof flags.type === 'string' ? flags.type : undefined,
                    site: flagToStringOrArray(flags.site),
                    timeRange: typeof (flags.time || flags.when) === 'string'
                        ? String(flags.time || flags.when)
                        : undefined,
                    proxy,
                });
                if (typeof flags.save === 'string' || typeof flags.out === 'string') {
                    const outPath = path.resolve(String(flags.save || flags.out));
                    await fs.mkdir(path.dirname(outPath), { recursive: true });
                    await fs.writeFile(outPath, asJson ? JSON.stringify(res, null, 2) : res.reportMarkdown, 'utf8');
                }
                if (asJson) {
                    console.log(JSON.stringify(res, null, 2));
                }
                else {
                    console.log(res.reportMarkdown);
                }
            }
            finally {
                await closePuppeteerPool();
            }
            break;
        }
        case 'social':
        case 'twitter':
        case 'x':
        case 'instagram':
        case 'insta':
        case 'reddit':
        case 'github':
        case 'tiktok': {
            const target = typeof flags.target === 'string'
                ? flags.target
                : typeof flags.url === 'string'
                    ? flags.url
                    : typeof flags.query === 'string'
                        ? flags.query
                        : positional.join(' ');
            if (!target) {
                console.error('Error: Provide a target URL, @handle, r/subreddit, owner/repo, or query. Example: tx-social "@nasa" --platform instagram');
                process.exit(1);
            }
            let platform = 'auto';
            if (command === 'twitter' || command === 'x')
                platform = 'twitter';
            else if (command === 'instagram' || command === 'insta')
                platform = 'instagram';
            else if (command === 'reddit')
                platform = 'reddit';
            else if (command === 'github')
                platform = 'github';
            else if (command === 'tiktok')
                platform = 'tiktok';
            else if (typeof flags.platform === 'string') {
                const p = flags.platform.toLowerCase();
                if (p === 'x' || p === 'twitter')
                    platform = 'twitter';
                else if (p === 'ig' || p === 'insta' || p === 'instagram')
                    platform = 'instagram';
                else if (p === 'reddit')
                    platform = 'reddit';
                else if (p === 'gh' || p === 'github')
                    platform = 'github';
                else if (p === 'tiktok')
                    platform = 'tiktok';
            }
            let action = 'auto';
            if (flags.profile)
                action = 'profile';
            else if (flags.post || flags.tweet || flags.reel)
                action = 'post';
            else if (flags.search)
                action = 'search';
            else if (flags.trending)
                action = 'trending';
            else if (flags.feed)
                action = 'feed';
            else if (typeof flags.action === 'string')
                action = flags.action;
            const limit = Number(flags.n || flags.limit || flags.count || 8);
            const sort = typeof flags.sort === 'string' ? flags.sort : undefined;
            const language = typeof (flags.lang || flags.language) === 'string'
                ? String(flags.lang || flags.language)
                : undefined;
            const res = await socialIntel({
                target,
                platform,
                action,
                limit,
                sort: sort,
                language,
                proxy,
            });
            if (typeof flags.save === 'string' || typeof flags.out === 'string') {
                const outPath = path.resolve(String(flags.save || flags.out));
                await fs.mkdir(path.dirname(outPath), { recursive: true });
                await fs.writeFile(outPath, asJson ? JSON.stringify(res, null, 2) : res.markdown, 'utf8');
            }
            if (asJson) {
                console.log(JSON.stringify(res, null, 2));
            }
            else {
                console.log(res.markdown);
            }
            break;
        }
        case 'news':
        case 'hn': {
            const query = typeof flags.query === 'string'
                ? flags.query
                : positional.length > 0
                    ? positional.join(' ')
                    : undefined;
            const category = (command === 'hn'
                ? 'hn'
                : typeof (flags.category || flags.cat) === 'string'
                    ? String(flags.category || flags.cat)
                    : 'tech');
            const when = (typeof flags.when === 'string' ? flags.when : '24h');
            const limit = Number(flags.n || flags.limit || flags.count || 15);
            const hnItemId = typeof (flags['hn-id'] || flags.hnId || flags.id) === 'string'
                ? String(flags['hn-id'] || flags.hnId || flags.id)
                : undefined;
            const res = await newsIntel({
                query,
                category,
                when,
                limit,
                hnItemId,
                proxy,
            });
            if (asJson) {
                console.log(JSON.stringify(res, null, 2));
            }
            else {
                console.log(res.markdown);
            }
            break;
        }
        case 'extract':
        case 'inspect': {
            const target = typeof flags.target === 'string'
                ? flags.target
                : typeof flags.url === 'string'
                    ? flags.url
                    : positional.join(' ');
            if (!target) {
                console.error('Error: Provide a URL or shorthand target (e.g. tx-extract "npm:tuxscout" or tx-extract "https://x.com/jack/status/20").');
                process.exit(1);
            }
            const limit = Number(flags.n || flags.limit || flags.count || 8);
            const maxChars = Number(flags['max-chars'] || flags.maxChars || 6000);
            const res = await smartExtract({ target, limit, maxChars, proxy });
            if (asJson) {
                console.log(JSON.stringify(res, null, 2));
            }
            else {
                console.log(res.markdown);
            }
            break;
        }
        case 'serve':
        case 'server': {
            const port = Number(flags.port || flags.p || process.env.PORT || 8787);
            const host = typeof flags.host === 'string' ? flags.host : '0.0.0.0';
            const secret = typeof flags.secret === 'string' ? flags.secret : undefined;
            await startServer({ port, host, secret });
            break;
        }
        case 'mcp': {
            startMcpServer();
            break;
        }
        case 'schema':
        case 'schemas':
        case 'tools': {
            console.log(JSON.stringify({ tools: MCP_TOOLS }, null, 2));
            break;
        }
        case 'setup':
        case 'init':
        case 'install-deps': {
            console.log(`🔧 Setting up TuxScout on ${process.platform} (${process.arch})...\n`);
            const ytBin = await ensureYtDlp();
            console.log(`✅ yt-dlp binary ready      : ${ytBin}`);
            const ffmpegBin = findFfmpegBinary();
            if (ffmpegBin) {
                console.log(`✅ ffmpeg detected          : ${ffmpegBin}`);
            }
            else {
                console.log('⚠️  ffmpeg not found in PATH (standalone m4a/mp4 downloads still work).');
                if (process.platform === 'win32') {
                    console.log('   -> Install on Windows: winget install -e --id Gyan.FFmpeg');
                }
                else if (process.platform === 'darwin') {
                    console.log('   -> Install on macOS  : brew install ffmpeg');
                }
                else {
                    console.log('   -> Install on Linux  : sudo apt-get install -y ffmpeg');
                }
            }
            try {
                const browserBin = findBrowserExecutable();
                console.log(`✅ Headless browser ready   : ${browserBin}`);
            }
            catch {
                console.log('⚠️  No Chrome/Edge/Chromium found.');
                if (process.platform === 'win32') {
                    console.log('   -> Install on Windows: winget install -e --id Google.Chrome');
                }
                else if (process.platform === 'darwin') {
                    console.log('   -> Install on macOS  : brew install --cask chromium');
                }
                else {
                    console.log('   -> Install on Linux  : sudo apt-get install -y chromium-browser');
                }
            }
            console.log('\n🎉 TuxScout setup complete! Try running: tuxscout doctor');
            break;
        }
        case 'doctor': {
            console.log('Running TuxScout system diagnostics...\n');
            console.log(`1. Node.js Runtime : ${process.version} (${process.platform}-${process.arch})`);
            let browserBin = 'NOT FOUND';
            try {
                browserBin = findBrowserExecutable();
            }
            catch (e) {
                browserBin = `MISSING (${e.message})`;
            }
            console.log(`2. Chromium/Chrome : ${browserBin}`);
            let ytBin = 'NOT FOUND';
            try {
                ytBin = await ensureYtDlp();
            }
            catch (e) {
                ytBin = `MISSING (${e.message})`;
            }
            console.log(`3. yt-dlp Binary   : ${ytBin}`);
            const ffBin = findFfmpegBinary();
            console.log(`4. ffmpeg Installed: ${ffBin ? `YES (${ffBin})` : 'NO (standalone m4a/mp4 stream fallback active)'}`);
            console.log('\n5. Testing Multi-Engine Web Search...');
            const searchRes = await webSearch({ query: 'Ubuntu Linux kernel release', n: 3 });
            console.log(`   -> OK=${searchRes.sources.length > 0} | Engine=${searchRes.engine} | Results=${searchRes.sources.length} | Time=${searchRes.ms}ms`);
            console.log('6. Testing Multi-Engine Image Search...');
            const imgRes = await imageSearch({ query: 'Tux Linux Penguin', n: 3 });
            console.log(`   -> OK=${imgRes.images.length > 0} | Engine=${imgRes.engine} | Images=${imgRes.images.length} | Time=${imgRes.ms}ms`);
            console.log('7. Testing Website-to-Markdown Fast Fetch...');
            const fetchRes = await fetchMarkdown({
                url: 'https://example.com',
                autoPuppeteer: false,
            });
            console.log(`   -> OK=${fetchRes.ok} | Status=${fetchRes.status} | Title="${fetchRes.title}" | Time=${fetchRes.ms}ms`);
            console.log('8. Testing Zero-Browser Social Intel (X/Twitter)...');
            const socialRes = await socialIntel({ target: 'https://x.com/jack/status/20' });
            console.log(`   -> OK=${socialRes.ok} | Platform=${socialRes.platform} | Action=${socialRes.action} | Time=${socialRes.ms}ms`);
            console.log('9. Testing Live News Aggregator (HN + Tech RSS)...');
            const newsRes = await newsIntel({ category: 'hn', limit: 3 });
            console.log(`   -> OK=${newsRes.ok} | Items=${newsRes.total} | Category=${newsRes.category} | Time=${newsRes.ms}ms`);
            await closePuppeteerPool();
            console.log('\nAll diagnostics complete!');
            break;
        }
        case 'test': {
            await import('./test-all.js');
            break;
        }
        default:
            printHelp();
            break;
    }
}
// Entrypoint when invoked as `tuxscout <cmd> ...` or `agent-tools <cmd> ...`
const argv1 = (process.argv[1] || '').replace(/\\/g, '/');
const isDirectMain = argv1.endsWith('/cli.js') ||
    argv1.endsWith('/cli.ts') ||
    /\/(tuxscout|agent-tools)(\.(js|cmd|ps1|exe))?$/i.test(argv1);
if (isDirectMain) {
    const [cmd, ...rest] = process.argv.slice(2);
    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
        printHelp();
        process.exit(0);
    }
    runCommand(cmd, rest).catch((err) => {
        console.error('Error:', err?.message || err);
        process.exit(1);
    });
}
//# sourceMappingURL=cli.js.map