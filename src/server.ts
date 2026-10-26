// src/server.ts
// Lightweight, zero-framework HTTP REST API Server for Agent Tools Pack.
// Drop-in compatible with Delphos Web Search & Image Search gateways + full endpoints
// for Markdown Fetch, Low-Memory Puppeteer JS Fetch, YouTube Downloader, and Deep Research.

import http from 'node:http';
import crypto from 'node:crypto';
import { clean } from './utils/http.js';
import { webSearch } from './tools/web-search.js';
import { downloadImages, imageSearch, type SafeSearch } from './tools/image-search.js';
import { fetchMarkdown, fetchMarkdownBatch } from './tools/markdown-fetch.js';
import {
  closePuppeteerPool,
  fetchWithPuppeteer,
  findBrowserExecutable,
} from './tools/puppeteer-fetch.js';
import {
  ensureYtDlp,
  extractVideoId,
  hasFfmpeg,
  youtubeTool,
  type YtMode,
  type YtVideoType,
} from './tools/yt-downloader.js';
import { deepResearch, type ResearchDepth } from './tools/deep-research.js';
import { socialIntel, type SocialAction, type SocialPlatform } from './tools/social-intel.js';
import { newsIntel, type NewsCategory, type NewsRecency } from './tools/news-intel.js';
import { smartExtract } from './tools/smart-extract.js';
import { MCP_TOOLS } from './mcp.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  secret?: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, apikey, x-client-info, x-api-key, x-delphos-secret',
};

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  res.end(payload);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseParams(req: http.IncomingMessage, urlObj: URL): Promise<Record<string, any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryParams: Record<string, any> = Object.fromEntries(urlObj.searchParams.entries());
  if (req.method === 'GET') return queryParams;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve(queryParams);
        return;
      }
      try {
        const json = JSON.parse(raw);
        resolve({ ...queryParams, ...json });
      } catch {
        reject(new Error('Bad Request: body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export async function startServer(options: ServerOptions = {}): Promise<http.Server> {
  const port = Number(options.port || process.env.PORT || 8787);
  const host = options.host || process.env.HOST || '0.0.0.0';
  const configuredSecret =
    options.secret ??
    process.env.AGENT_TOOLS_SECRET ??
    process.env.DELPHOS_SEARCH_SECRET ??
    process.env.DELPHOS_IMAGE_SECRET ??
    '';

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, CORS_HEADERS);
      res.end('ok');
      return;
    }

    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname.replace(/\/+$/, '') || '/';

    // Optional Secret Verification
    if (configuredSecret && pathname !== '/health') {
      const headerSecret =
        (req.headers['x-delphos-secret'] as string) ||
        (req.headers['x-api-key'] as string) ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!headerSecret || !safeEqual(headerSecret, configuredSecret)) {
        sendJson(res, 403, { error: 'Forbidden: invalid or missing secret header.' });
        return;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let params: Record<string, any> = {};
    try {
      params = await parseParams(req, urlObj);
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
      return;
    }

    try {
      // ── 1. Health & System Diagnostics ────────────────────────────────────
      if (pathname === '/' || pathname === '/health') {
        const mem = process.memoryUsage();
        let browserBin: string | null = null;
        try {
          browserBin = findBrowserExecutable();
        } catch {
          browserBin = null;
        }
        let ytBin: string | null = null;
        try {
          ytBin = await ensureYtDlp();
        } catch {
          ytBin = null;
        }
        sendJson(res, 200, {
          ok: true,
          service: 'tuxscout',
          version: '1.1.1',
          platform: `${process.platform}-${process.arch}`,
          uptimeSec: Math.round(process.uptime()),
          memoryMb: {
            rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
            heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
          },
          capabilities: {
            chromium: browserBin,
            ytDlp: ytBin,
            ffmpeg: hasFfmpeg(),
          },
          endpoints: [
            'GET      /schema (AI Agent OpenAI/Anthropic/MCP tool schemas)',
            'GET/POST /search (or /delphos-web-search, /apis/v1/search)',
            'GET/POST /images (or /delphos-image-search, /apis/v1/images)',
            'POST     /images/download',
            'GET/POST /fetch',
            'GET/POST /puppeteer',
            'GET/POST /yt',
            'POST     /research',
            'GET/POST /social (Zero-browser Twitter/X, Instagram, Reddit, GitHub, TikTok)',
            'GET/POST /news (Live Google News, Hacker News, Reddit News, Curated Tech/AI/World RSS)',
            'GET/POST /extract (Zero-browser Smart Extract for StackOverflow, ArXiv, Wiki, NPM, PyPI, Web)',
          ],
        });
        return;
      }

      if (pathname === '/schema' || pathname === '/tools') {
        sendJson(res, 200, { tools: MCP_TOOLS });
        return;
      }

      // ── 2. Internet Web Search (Delphos Gateway Compatible) ───────────────
      if (
        pathname === '/search' ||
        pathname === '/delphos-web-search' ||
        pathname === '/apis/v1/search'
      ) {
        const query = clean(params.query ?? params.q);
        const queries = Array.isArray(params.queries) ? params.queries : undefined;
        if (!query && (!queries || !queries.length)) {
          sendJson(res, 400, { error: 'Bad Request: missing or empty "query".' });
          return;
        }
        const result = await webSearch({
          query,
          queries,
          n: params.n ? Number(params.n) : undefined,
          engine: params.engine,
          noCache: Boolean(params.noCache),
        });
        if (result.sources.length || result.no_results) {
          sendJson(res, 200, result);
        } else {
          sendJson(res, 502, {
            error: 'All upstream search engines failed or were blocked.',
            internet_data: '',
            sources: [],
            attempts: result.attempts,
          });
        }
        return;
      }

      // ── 3. Image Search (Delphos Gateway Compatible + Optional Download) ──
      if (
        pathname === '/images' ||
        pathname === '/delphos-image-search' ||
        pathname === '/apis/v1/images'
      ) {
        const query = clean(params.query ?? params.q);
        if (!query) {
          sendJson(res, 400, { error: 'Missing q parameter' });
          return;
        }
        const safeRaw = clean(params.safe).toLowerCase();
        const safe: SafeSearch =
          safeRaw === 'off' || safeRaw === 'strict' ? safeRaw : 'moderate';

        if (params.download && params.outputDir) {
          const dlRes = await downloadImages({
            query,
            outputDir: String(params.outputDir),
            count: params.n ? Number(params.n) : 5,
            safe,
            engine: params.engine,
          });
          sendJson(res, 200, dlRes);
          return;
        }

        const result = await imageSearch({
          query,
          n: params.n ? Number(params.n) : undefined,
          safe,
          engine: params.engine,
          noCache: Boolean(params.noCache),
          verifyUrls: params.verifyUrls !== undefined ? Boolean(params.verifyUrls) : true,
        });

        if (result.images.length || result.no_results) {
          sendJson(res, 200, result);
        } else {
          sendJson(res, 502, {
            error: 'All upstream image engines failed or were blocked.',
            total: 0,
            showing: 0,
            images: [],
            attempts: result.attempts,
          });
        }
        return;
      }

      // ── 4. Image Downloader ───────────────────────────────────────────────
      if (pathname === '/images/download') {
        const outputDir = clean(params.outputDir || params.dir || './downloads/images');
        const result = await downloadImages({
          query: params.query ?? params.q,
          images: params.images ?? params.urls,
          outputDir,
          count: params.count ?? params.n,
          safe: params.safe,
          engine: params.engine,
          concurrency: params.concurrency,
          filenamePrefix: params.filenamePrefix,
        });
        sendJson(res, 200, result);
        return;
      }

      // ── 5. Fast Website-to-Markdown Fetch ─────────────────────────────────
      if (pathname === '/fetch') {
        if (Array.isArray(params.urls) && params.urls.length) {
          const batch = await fetchMarkdownBatch(params.urls, {
            maxChars: params.maxChars ? Number(params.maxChars) : undefined,
            includeLinks: params.includeLinks !== undefined ? Boolean(params.includeLinks) : true,
            includeImages: Boolean(params.includeImages),
            onlyMainContent:
              params.onlyMainContent !== undefined ? Boolean(params.onlyMainContent) : true,
            autoPuppeteer:
              params.autoPuppeteer !== undefined ? Boolean(params.autoPuppeteer) : true,
            forcePuppeteer: Boolean(params.forcePuppeteer),
            concurrency: params.concurrency ? Number(params.concurrency) : undefined,
          });
          sendJson(res, 200, { count: batch.length, results: batch });
          return;
        }

        const url = clean(params.url);
        if (!url) {
          sendJson(res, 400, { error: 'Missing "url" or "urls" parameter.' });
          return;
        }
        const page = await fetchMarkdown({
          url,
          maxChars: params.maxChars ? Number(params.maxChars) : undefined,
          includeLinks: params.includeLinks !== undefined ? Boolean(params.includeLinks) : true,
          includeImages: Boolean(params.includeImages),
          onlyMainContent:
            params.onlyMainContent !== undefined ? Boolean(params.onlyMainContent) : true,
          autoPuppeteer:
            params.autoPuppeteer !== undefined ? Boolean(params.autoPuppeteer) : true,
          forcePuppeteer: Boolean(params.forcePuppeteer),
          timeoutMs: params.timeoutMs ? Number(params.timeoutMs) : undefined,
        });
        sendJson(res, page.ok ? 200 : 502, page);
        return;
      }

      // ── 6. Low-Memory Puppeteer JS Website Fetch ──────────────────────────
      if (pathname === '/puppeteer' || pathname === '/browser') {
        const url = clean(params.url);
        if (!url) {
          sendJson(res, 400, { error: 'Missing "url" parameter.' });
          return;
        }
        const result = await fetchWithPuppeteer({
          url,
          waitUntil: params.waitUntil,
          timeoutMs: params.timeoutMs ? Number(params.timeoutMs) : undefined,
          waitForSelector: params.waitForSelector,
          waitAfterLoadMs: params.waitAfterLoadMs ? Number(params.waitAfterLoadMs) : undefined,
          scrollToBottom: Boolean(params.scrollToBottom),
          blockResources:
            params.blockResources !== undefined ? Boolean(params.blockResources) : undefined,
          blockStylesheets:
            params.blockStylesheets !== undefined ? Boolean(params.blockStylesheets) : undefined,
          includeLinks: params.includeLinks !== undefined ? Boolean(params.includeLinks) : true,
          includeImages: Boolean(params.includeImages),
          maxChars: params.maxChars ? Number(params.maxChars) : undefined,
          onlyMainContent:
            params.onlyMainContent !== undefined ? Boolean(params.onlyMainContent) : true,
          evaluateScript: params.evaluateScript,
          screenshotPath: params.screenshotPath,
          fullPageScreenshot: Boolean(params.fullPageScreenshot),
        });
        sendJson(res, 200, result);
        return;
      }

      // ── 7. YouTube Video / Audio / Transcript / Search ────────────────────
      if (pathname === '/yt' || pathname === '/youtube') {
        const input = clean(params.input ?? params.url ?? params.query ?? params.q);
        if (!input) {
          sendJson(res, 400, { error: 'Missing "input" (YouTube URL or search query).' });
          return;
        }
        const isUrlOrId = /^https?:\/\//i.test(input) || Boolean(extractVideoId(input));
        const defaultMode: YtMode = isUrlOrId ? 'video' : 'search';
        const result = await youtubeTool({
          input,
          mode: (params.mode as YtMode) || defaultMode,
          videoType: (params.videoType ?? params.type ?? 'long') as YtVideoType,
          outputDir: params.outputDir || params.dir,
          audioFormat: params.audioFormat,
          videoFormat: params.videoFormat,
          maxHeight: params.maxHeight ? Number(params.maxHeight) : undefined,
          searchLimit: (params.searchLimit ?? params.n) ? Number(params.searchLimit ?? params.n) : undefined,
          subLang: params.subLang,
          cookiesFile: params.cookiesFile,
          filenamePrefix: params.filenamePrefix,
        });
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }

      // ── 8. Multi-Stage Parallel Deep Research ─────────────────────────────
      if (pathname === '/research') {
        const query = clean(params.query ?? params.q);
        if (!query) {
          sendJson(res, 400, { error: 'Missing "query" parameter.' });
          return;
        }
        const result = await deepResearch({
          query,
          subQueries: Array.isArray(params.subQueries) ? params.subQueries : undefined,
          depth: (params.depth as ResearchDepth) || 'standard',
          maxPages: params.maxPages ? Number(params.maxPages) : undefined,
          maxCharsPerPage: params.maxCharsPerPage ? Number(params.maxCharsPerPage) : undefined,
          maxPerDomain: params.maxPerDomain ? Number(params.maxPerDomain) : undefined,
          autoPuppeteer:
            params.autoPuppeteer !== undefined ? Boolean(params.autoPuppeteer) : true,
          includeImages: Boolean(params.includeImages),
          includeYoutube: Boolean(params.includeYoutube),
        });
        sendJson(res, 200, result);
        return;
      }

      // ── 9. Social Media Reconnaissance (Twitter/X, Instagram, Reddit, GitHub, TikTok) ──
      if (pathname === '/social' || pathname === '/apis/v1/social') {
        const target = clean(params.target ?? params.url ?? params.query ?? params.q);
        if (!target) {
          sendJson(res, 400, { error: 'Missing "target" parameter (URL, @handle, r/subreddit, owner/repo, or query).' });
          return;
        }
        const result = await socialIntel({
          target,
          platform: (params.platform as SocialPlatform) || 'auto',
          action: (params.action as SocialAction) || 'auto',
          limit: (params.limit ?? params.n) ? Number(params.limit ?? params.n) : undefined,
          sort: params.sort,
          language: params.language ?? params.lang,
        });
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }

      // ── 10. Live News & Tech Intelligence Aggregator ──────────────────────
      if (pathname === '/news' || pathname === '/apis/v1/news') {
        const result = await newsIntel({
          query: clean(params.query ?? params.q ?? params.topic) || undefined,
          category: params.category as NewsCategory,
          when: params.when as NewsRecency,
          limit: (params.limit ?? params.n) ? Number(params.limit ?? params.n) : undefined,
          hnItemId: params.hnItemId ?? params.hn_item_id,
        });
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }

      // ── 11. Zero-Browser Smart Extract Router ─────────────────────────────
      if (pathname === '/extract' || pathname === '/apis/v1/extract') {
        const target = clean(params.target ?? params.url ?? params.query ?? params.q);
        if (!target) {
          sendJson(res, 400, { error: 'Missing "target" parameter.' });
          return;
        }
        const result = await smartExtract({
          target,
          limit: (params.limit ?? params.n) ? Number(params.limit ?? params.n) : undefined,
          maxChars: params.maxChars ? Number(params.maxChars) : undefined,
        });
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }

      sendJson(res, 404, { error: `Unknown endpoint: ${pathname}` });
    } catch (err) {
      sendJson(res, 500, {
        error: (err as Error)?.message || String(err),
      });
    }
  });

  const cleanup = async () => {
    await closePuppeteerPool();
    server.close();
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`[tuxscout] HTTP API server listening on http://${host}:${port}`);
      resolve(server);
    });
  });
}

// Allow running `node dist/server.js` directly
if (
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server.ts'))
) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
