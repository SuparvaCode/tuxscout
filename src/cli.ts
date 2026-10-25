#!/usr/bin/env node
// src/cli.ts
// Unified CLI for Agent Tools Pack (`agent-tools` and shorthand `at-*` commands).

import fs from 'node:fs/promises';
import path from 'node:path';
import { webSearch } from './tools/web-search.js';
import { downloadImages, imageSearch, type SafeSearch } from './tools/image-search.js';
import { fetchMarkdown, fetchMarkdownBatch } from './tools/markdown-fetch.js';
import {
  closePuppeteerPool,
  fetchWithPuppeteer,
  findBrowserExecutable,
} from './tools/puppeteer-fetch.js';
import {
  type AudioFormat,
  ensureYtDlp,
  extractVideoId,
  findFfmpegBinary,
  hasFfmpeg,
  type VideoFormat,
  type YtMode,
  type YtVideoType,
  youtubeTool,
} from './tools/yt-downloader.js';
import { deepResearch, type ResearchDepth } from './tools/deep-research.js';
import { startServer } from './server.js';
import { MCP_TOOLS, startMcpServer } from './mcp.js';

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean | string[]>;
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          if (flags[key] !== undefined) {
            const prev = flags[key];
            flags[key] = Array.isArray(prev) ? [...prev, next] : [String(prev), next];
          } else {
            flags[key] = next;
          }
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printHelp(): void {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                 TUXSCOUT v1.0.0 (Linux • Windows • macOS)                  ║
║   Web Search • Image Search/DL • Markdown Fetch • Low-RAM Puppeteer JS     ║
║         YouTube Video/Audio/Transcript • Multi-Stage Deep Research         ║
╚════════════════════════════════════════════════════════════════════════════╝

USAGE:
  tuxscout <command> [arguments] [flags]

COMMANDS & SHORTHAND BINARIES:
  search   (tx-search)    Multi-engine Web Search with 4-layer relevance filter
  images   (tx-images)    5-Engine Image Search & Parallel Verified Downloader
  fetch    (tx-fetch)     Fast Website-to-Markdown fetch (auto-escalates to JS)
  browser  (tx-browser)   Ultra-low-RAM Headless Chromium / Puppeteer JS fetch
  yt       (tx-yt)        YouTube Video, Music/Audio, Search & Transcript tool
  research (tx-research)  4-Stage Parallel Multi-Angle Search & Deep Research
  serve    (tx-serve)     Start the HTTP REST API server (Delphos compatible)
  mcp      (tx-mcp)       Start the Model Context Protocol (MCP) stdio server
  schema                  Output JSON tool schemas for AI Agents / LLM Function Calling
  setup                   Bootstrap yt-dlp binary & verify Chrome/ffmpeg on any OS
  doctor                  Verify binaries (Chromium, yt-dlp, ffmpeg) & live test
  test                    Run the 14-step end-to-end verification suite

EXAMPLES:
  # 1. Web Search (single query or multiple parallel query angles)
  tuxscout search "Gemini 4 release notes" -n 10 --json
  tx-search --query "Linux kernel 6.12" --query "Linux 6.12 benchmarks"

  # 2. Image Search & Parallel Download (auto-probes & filters dead/blocked links)
  tuxscout images "futuristic server room" -n 10
  tx-images "mountain landscape wallpaper" --download --out ./wallpapers -n 5

  # 3. Fast Website to Markdown Fetch
  tuxscout fetch https://en.wikipedia.org/wiki/Linux --max-chars 5000
  tx-fetch https://news.ycombinator.com --json

  # 4. Low-Memory Puppeteer JS Website Fetch
  tuxscout browser https://example.com --scroll --screenshot ./page.png
  tx-browser https://react.dev --wait networkidle2

  # 5. YouTube Video / Music / Transcript / Search (filters Shorts vs Long videos)
  tx-yt "https://www.youtube.com/watch?v=jNQXAC9IVRw" --mode transcript
  tx-yt "linux kernel tutorial" -n 5                     # Long-form videos only (default)
  tx-yt "linux tips" --shorts -n 5                       # YouTube Shorts only (<=60s)
  tx-yt "linux" --type all -n 5                          # Both Long-form and Shorts
  tuxscout yt "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --mode audio --format mp3 --out ./music
  tx-yt "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --mode video --height 1080 --out ./videos

  # 6. Multi-Stage Parallel Deep Research
  tuxscout research "Compare Bun vs Node.js v24 performance and memory usage" --depth standard --save ./report.md
  tx-research "Latest breakthroughs in solid state batteries" --depth deep --images --yt

  # 7. Start HTTP API Server, MCP Server, or Export LLM Tool Schemas
  tuxscout serve --port 8787
  tuxscout mcp
  tuxscout schema
`);
}

export async function runCommand(command: string, rawArgs: string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(rawArgs);
  const asJson = Boolean(flags.json || flags.j);

  switch (command) {
    case 'search':
    case 'web': {
      const queries: string[] = [];
      if (Array.isArray(flags.query)) {
        queries.push(...flags.query);
      } else if (typeof flags.query === 'string') {
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
      const res = await webSearch({
        queries,
        n,
        engine,
      });

      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `# Web Search (${res.sources.length} results via [${res.engines.join(', ')}] in ${res.ms}ms, intent=${res.intent})\n`,
        );
        res.sources.forEach((s, i) => {
          console.log(`${i + 1}. **${s.title}**`);
          console.log(`   URL: ${s.url}`);
          if (s.description) console.log(`   ${s.description}`);
          console.log('');
        });
      }
      break;
    }

    case 'images':
    case 'img': {
      const query =
        typeof flags.query === 'string' ? flags.query : positional.join(' ');
      const n = Number(flags.n || flags.count || 10);
      const safe = (typeof flags.safe === 'string' ? flags.safe : 'moderate') as SafeSearch;
      const engine = typeof flags.engine === 'string' ? flags.engine : undefined;
      const shouldDownload = Boolean(flags.download || flags.dl || flags.out || flags.output);

      if (shouldDownload) {
        const outDir =
          typeof (flags.out || flags.output) === 'string'
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
        });
        if (asJson) {
          console.log(JSON.stringify(dlRes, null, 2));
        } else {
          console.log(
            `Downloaded ${dlRes.downloadedCount}/${dlRes.requested} verified images to ${dlRes.outputDir} in ${dlRes.ms}ms:`,
          );
          for (const img of dlRes.downloaded) {
            console.log(
              `  - ${img.fileName} (${Math.round(img.bytes / 1024)} KB, ${img.detectedType}) <- ${img.imageUrl}`,
            );
          }
          if (dlRes.manifestPath) {
            console.log(`Manifest saved: ${dlRes.manifestPath}`);
          }
        }
      } else {
        if (!query) {
          console.error('Error: Please provide an image query. Example: tx-images "query"');
          process.exit(1);
        }
        const verifyUrls = flags['no-verify'] ? false : true;
        const res = await imageSearch({ query, n, safe, engine, verifyUrls });
        if (asJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(
            `# Image Search (${res.showing} ${verifyUrls ? 'verified live ' : ''}results via [${res.engines.join(', ')}] in ${res.ms}ms)\n`,
          );
          res.images.forEach((img, i) => {
            console.log(
              `${i + 1}. **${img.title || 'Untitled'}** (${img.width}x${img.height} ${img.type}) [${img.engine}]`,
            );
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
      if (typeof flags.url === 'string') urls.push(flags.url);
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
          });
          if (typeof flags.save === 'string' || typeof flags.out === 'string') {
            const outPath = path.resolve(String(flags.save || flags.out));
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, res.markdown, 'utf8');
          }
          if (asJson) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(
              `<!-- Fetched ${res.finalUrl} via ${res.method} (status=${res.status}, words=${res.wordCount}, ${res.ms}ms) -->\n`,
            );
            if (res.title) console.log(`# ${res.title}\n`);
            console.log(res.markdown);
          }
        } else {
          const batch = await fetchMarkdownBatch(urls, {
            maxChars,
            includeLinks,
            includeImages,
            autoPuppeteer,
            forcePuppeteer,
          });
          if (asJson) {
            console.log(JSON.stringify(batch, null, 2));
          } else {
            for (const res of batch) {
              console.log(`\n========================================`);
              console.log(`URL: ${res.finalUrl} (${res.method}, ${res.wordCount} words, ${res.ms}ms)`);
              console.log(`========================================\n`);
              console.log(res.markdown);
            }
          }
        }
      } finally {
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
      const waitUntil = (
        typeof flags.wait === 'string' ? flags.wait : 'domcontentloaded'
      ) as 'domcontentloaded' | 'networkidle2' | 'networkidle0' | 'load';
      const maxChars = Number(flags['max-chars'] || flags.maxChars || 0);
      const screenshotPath =
        typeof flags.screenshot === 'string' ? flags.screenshot : undefined;
      const evaluateScript =
        typeof flags.eval === 'string' ? flags.eval : undefined;
      const waitForSelector =
        typeof flags.selector === 'string' ? flags.selector : undefined;

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
      });

      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `<!-- Puppeteer JS Fetch: ${res.finalUrl} (status=${res.status}, blocked=${res.blockedRequestsCount} reqs, allowed=${res.allowedRequestsCount} reqs, ${res.ms}ms) -->\n`,
        );
        if (res.title) console.log(`# ${res.title}\n`);
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
      const input =
        typeof flags.input === 'string'
          ? flags.input
          : typeof flags.url === 'string'
            ? flags.url
            : positional.join(' ');
      if (!input) {
        console.error(
          'Error: Provide a YouTube URL or search query. Example: tx-yt "https://www.youtube.com/watch?v=..." --mode transcript',
        );
        process.exit(1);
      }

      const isUrlOrId = /^https?:\/\//i.test(input) || Boolean(extractVideoId(input));
      let mode: YtMode;
      if (flags.audio || flags.music) mode = 'audio';
      else if (flags.transcript || flags.subs) mode = 'transcript';
      else if (flags.info) mode = 'info';
      else if (flags.search || flags.shorts) mode = 'search';
      else if (flags.video || flags.download || flags.dl) mode = 'video';
      else if (typeof flags.mode === 'string') mode = flags.mode as YtMode;
      else mode = isUrlOrId ? 'video' : 'search';

      let videoType: YtVideoType = 'long';
      if (flags.shorts) videoType = 'shorts';
      else if (flags.all) videoType = 'all';
      else if (flags.long) videoType = 'long';
      else if (typeof flags.type === 'string') {
        const t = flags.type.toLowerCase();
        if (t === 'shorts' || t === 'short') videoType = 'shorts';
        else if (t === 'all' || t === 'both') videoType = 'all';
        else videoType = 'long';
      }

      const outDir =
        typeof (flags.out || flags.output || flags.dir) === 'string'
          ? String(flags.out || flags.output || flags.dir)
          : './downloads/youtube';

      const res = await youtubeTool({
        input,
        mode,
        videoType,
        outputDir: outDir,
        audioFormat: (typeof flags.format === 'string' ? flags.format : undefined) as AudioFormat,
        videoFormat: (typeof flags.format === 'string' ? flags.format : undefined) as VideoFormat,
        maxHeight: flags.height ? Number(flags.height) : undefined,
        searchLimit: (flags.n || flags.count || flags.limit)
          ? Number(flags.n || flags.count || flags.limit)
          : undefined,
        subLang: typeof flags.lang === 'string' ? flags.lang : undefined,
        cookiesFile: typeof flags.cookies === 'string' ? flags.cookies : undefined,
      });

      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else if (!res.ok) {
        console.error(`YouTube tool error: ${res.error}`);
        process.exit(1);
      } else if (mode === 'search' && res.searchResults) {
        const filterLabel =
          videoType === 'shorts'
            ? 'Shorts only (<=60s)'
            : videoType === 'all'
              ? 'All videos & Shorts'
              : 'Long-form videos only (Shorts excluded)';
        console.log(
          `# YouTube Search Results (${res.searchResults.length} videos | Filter: ${filterLabel} | ${res.ms}ms)\n`,
        );
        res.searchResults.forEach((v, i) => {
          const badge = v.isShort ? '[SHORT]' : '[VIDEO]';
          console.log(`${i + 1}. ${badge} **${v.title}** (${v.durationString}) — ${v.channel}`);
          console.log(`   URL:   ${v.url}`);
          console.log(`   Views: ${v.viewCount.toLocaleString()}`);
          console.log('');
        });
      } else if (mode === 'transcript' && res.transcript) {
        console.log(res.transcript.markdown);
      } else if (mode === 'info' && res.metadata) {
        console.log(JSON.stringify(res.metadata, null, 2));
      } else {
        console.log(`Successfully downloaded (${mode}) in ${res.ms}ms:`);
        console.log(`  File:  ${res.filePath}`);
        console.log(`  Size:  ${res.bytes ? (res.bytes / 1024 / 1024).toFixed(2) + ' MB' : 'unknown'}`);
        if (res.metadata?.title) console.log(`  Title: ${res.metadata.title}`);
      }
      break;
    }

    case 'research': {
      const query =
        typeof flags.query === 'string' ? flags.query : positional.join(' ');
      if (!query) {
        console.error('Error: Provide a research query. Example: at-research "topic"');
        process.exit(1);
      }
      const depth = (
        typeof flags.depth === 'string' ? flags.depth : 'standard'
      ) as ResearchDepth;
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
        });

        if (typeof flags.save === 'string' || typeof flags.out === 'string') {
          const outPath = path.resolve(String(flags.save || flags.out));
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(
            outPath,
            asJson ? JSON.stringify(res, null, 2) : res.reportMarkdown,
            'utf8',
          );
        }

        if (asJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(res.reportMarkdown);
        }
      } finally {
        await closePuppeteerPool();
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
      } else {
        console.log('⚠️  ffmpeg not found in PATH (standalone m4a/mp4 downloads still work).');
        if (process.platform === 'win32') {
          console.log('   -> Install on Windows: winget install -e --id Gyan.FFmpeg');
        } else if (process.platform === 'darwin') {
          console.log('   -> Install on macOS  : brew install ffmpeg');
        } else {
          console.log('   -> Install on Linux  : sudo apt-get install -y ffmpeg');
        }
      }

      try {
        const browserBin = findBrowserExecutable();
        console.log(`✅ Headless browser ready   : ${browserBin}`);
      } catch {
        console.log('⚠️  No Chrome/Edge/Chromium found.');
        if (process.platform === 'win32') {
          console.log('   -> Install on Windows: winget install -e --id Google.Chrome');
        } else if (process.platform === 'darwin') {
          console.log('   -> Install on macOS  : brew install --cask chromium');
        } else {
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
      } catch (e) {
        browserBin = `MISSING (${(e as Error).message})`;
      }
      console.log(`2. Chromium/Chrome : ${browserBin}`);

      let ytBin = 'NOT FOUND';
      try {
        ytBin = await ensureYtDlp();
      } catch (e) {
        ytBin = `MISSING (${(e as Error).message})`;
      }
      console.log(`3. yt-dlp Binary   : ${ytBin}`);
      const ffBin = findFfmpegBinary();
      console.log(
        `4. ffmpeg Installed: ${ffBin ? `YES (${ffBin})` : 'NO (standalone m4a/mp4 stream fallback active)'}`,
      );

      console.log('\n5. Testing Multi-Engine Web Search...');
      const searchRes = await webSearch({ query: 'Ubuntu Linux kernel release', n: 3 });
      console.log(
        `   -> OK=${searchRes.sources.length > 0} | Engine=${searchRes.engine} | Results=${searchRes.sources.length} | Time=${searchRes.ms}ms`,
      );

      console.log('6. Testing Multi-Engine Image Search...');
      const imgRes = await imageSearch({ query: 'Tux Linux Penguin', n: 3 });
      console.log(
        `   -> OK=${imgRes.images.length > 0} | Engine=${imgRes.engine} | Images=${imgRes.images.length} | Time=${imgRes.ms}ms`,
      );

      console.log('7. Testing Website-to-Markdown Fast Fetch...');
      const fetchRes = await fetchMarkdown({
        url: 'https://example.com',
        autoPuppeteer: false,
      });
      console.log(
        `   -> OK=${fetchRes.ok} | Status=${fetchRes.status} | Title="${fetchRes.title}" | Time=${fetchRes.ms}ms`,
      );

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
const isDirectMain =
  argv1.endsWith('/cli.js') ||
  argv1.endsWith('/cli.ts') ||
  /\/(tuxscout|agent-tools)(\.(js|cmd|ps1|exe))?$/i.test(argv1);

if (isDirectMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printHelp();
    process.exit(0);
  }
  runCommand(cmd, rest).catch((err) => {
    console.error('Error:', (err as Error)?.message || err);
    process.exit(1);
  });
}
