// src/mcp.ts
// Zero-dependency Model Context Protocol (MCP) Server over stdio (JSON-RPC 2.0).
// Exposes all tools in Agent Tools Pack natively to AI Agents:
//   - web_search
//   - image_search
//   - image_download
//   - fetch_markdown
//   - fetch_puppeteer_js
//   - youtube_tool
//   - deep_research

import readline from 'node:readline';
import { webSearch } from './tools/web-search.js';
import { downloadImages, imageSearch, type SafeSearch } from './tools/image-search.js';
import { fetchMarkdown } from './tools/markdown-fetch.js';
import { fetchWithPuppeteer } from './tools/puppeteer-fetch.js';
import { youtubeTool, type YtMode, type YtVideoType, extractVideoId } from './tools/yt-downloader.js';
import { deepResearch, type ResearchDepth } from './tools/deep-research.js';

export const MCP_TOOLS = [
  {
    name: 'web_search',
    description:
      'Multi-engine resilient Internet Web Search (DuckDuckGo, Brave, Yahoo, Wikipedia) with 4-layer relevance scoring, landing-page rejection, and multi-query parallel execution.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Primary search query.' },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of 2-4 query angles to run in parallel and merge round-robin.',
        },
        n: { type: 'number', description: 'Number of results to return (1-30, default 10).' },
        engine: {
          type: 'string',
          description: 'Optional pin to specific engine: duckduckgo, duckduckgo-lite, brave, yahoo, bing, wikipedia.',
        },
      },
    },
  },
  {
    name: 'image_search',
    description:
      'Multi-engine Image Search across 5 independent engines (Bing, DuckDuckGo, Yahoo, Wikimedia Commons, Openverse) with parallel live magic-byte probing so only working, non-broken image URLs are returned.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Image search query.' },
        n: { type: 'number', description: 'Number of verified images to return (1-60, default 15).' },
        safe: {
          type: 'string',
          enum: ['off', 'moderate', 'strict'],
          description: 'SafeSearch filter (default moderate).',
        },
        engine: {
          type: 'string',
          description: 'Optional engine: bing, duckduckgo, yahoo, wikimedia, openverse.',
        },
        verifyUrls: {
          type: 'boolean',
          description: 'Probe image URLs in parallel to filter out dead/403/HTML links (default true).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'image_download',
    description:
      'Search and download verified images in parallel to local disk with magic-byte validation, Referer hotlink spoofing, automatic thumbnail fallback, and manifest.json output.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to find and download images for.' },
        images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional explicit array of image URLs to download instead of searching.',
        },
        outputDir: { type: 'string', description: 'Directory path to save downloaded images.' },
        count: { type: 'number', description: 'Number of valid images to save (default 5).' },
        safe: { type: 'string', enum: ['off', 'moderate', 'strict'] },
      },
      required: ['outputDir'],
    },
  },
  {
    name: 'fetch_markdown',
    description:
      'Fetch any website URL and convert its main article content into clean, LLM-ready Markdown. Automatically detects SPA/JS-walls and escalates to low-memory headless Chromium when needed.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Website URL to fetch.' },
        maxChars: { type: 'number', description: 'Max Markdown characters to return (0 = unlimited).' },
        includeLinks: { type: 'boolean', description: 'Preserve hyperlinks in Markdown (default true).' },
        includeImages: { type: 'boolean', description: 'Preserve image tags in Markdown (default false).' },
        autoPuppeteer: {
          type: 'boolean',
          description: 'Automatically fallback to low-RAM Puppeteer if page requires JS (default true).',
        },
        forcePuppeteer: {
          type: 'boolean',
          description: 'Skip HTTP and render directly with low-RAM Puppeteer (default false).',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'fetch_puppeteer_js',
    description:
      'Fetch a JavaScript-heavy SPA or dynamic webpage using Headless Chromium (Puppeteer) with ultra-low memory consumption (blocks heavy media/fonts/ads, reuses singleton browser pool, auto-evicts on idle).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL to render with JavaScript enabled.' },
        waitUntil: {
          type: 'string',
          enum: ['domcontentloaded', 'networkidle2', 'networkidle0', 'load'],
          description: 'Navigation wait condition (default domcontentloaded).',
        },
        waitForSelector: { type: 'string', description: 'Optional CSS selector to wait for.' },
        scrollToBottom: { type: 'boolean', description: 'Auto-scroll page to trigger lazy loading.' },
        evaluateScript: { type: 'string', description: 'Optional JS expression to evaluate in page.' },
        screenshotPath: { type: 'string', description: 'Optional file path to save a PNG screenshot.' },
        maxChars: { type: 'number', description: 'Max Markdown characters to return.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'youtube_tool',
    description:
      'YouTube Video & Music Downloader, Searcher (with Long-form vs Shorts filtering), Metadata Inspector, and fast timeout-proof Subtitle/Transcript Extractor.',
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'YouTube video URL, 11-char video ID, OR search query (e.g. "linux tutorial").',
        },
        mode: {
          type: 'string',
          enum: ['video', 'audio', 'transcript', 'info', 'search'],
          description:
            'Operation mode: "search" (search YouTube), "transcript" (extract clean text captions), "video" (download mp4), "audio" (download mp3/m4a), "info" (metadata JSON). Auto-detected if omitted.',
        },
        videoType: {
          type: 'string',
          enum: ['long', 'shorts', 'all'],
          description:
            'Filter for mode="search": "long" (default, only normal long-form videos >60s, excludes Shorts), "shorts" (only YouTube Shorts <=60s), or "all" (both).',
        },
        outputDir: { type: 'string', description: 'Directory to save downloaded video/audio.' },
        audioFormat: {
          type: 'string',
          enum: ['mp3', 'm4a', 'opus', 'wav', 'flac', 'best'],
          description: 'Audio format when mode="audio" (default mp3).',
        },
        maxHeight: {
          type: 'number',
          description: 'Max video resolution height when mode="video" (e.g. 1080, 720, 480).',
        },
        searchLimit: { type: 'number', description: 'Number of results when mode="search" (default 5).' },
        subLang: { type: 'string', description: 'Subtitle language code for mode="transcript" (default "en").' },
      },
      required: ['input'],
    },
  },
  {
    name: 'deep_research',
    description:
      'Multi-Parallel Stage Search & Deep Research tool. Expands query into multiple angles, searches multiple engines concurrently, fetches top diverse pages in parallel (HTTP -> Puppeteer JS fallback), ranks passages, and synthesizes a citation-backed Markdown research report.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Primary research topic, question, or goal.' },
        subQueries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional custom sub-queries to include in parallel search.',
        },
        depth: {
          type: 'string',
          enum: ['quick', 'standard', 'deep'],
          description: 'Research depth: quick (3 pages), standard (5 pages), deep (8 pages).',
        },
        maxPages: { type: 'number', description: 'Override max pages to fetch and analyze.' },
        includeImages: { type: 'boolean', description: 'Also search for verified relevant images.' },
        includeYoutube: {
          type: 'boolean',
          description: 'Also search YouTube (long-form videos) and extract top video transcript.',
        },
      },
      required: ['query'],
    },
  },
];

function sendRpcResponse(id: string | number | null, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`${msg}\n`);
}

function sendRpcError(id: string | number | null, code: number, message: string): void {
  const msg = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
  process.stdout.write(`${msg}\n`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleToolCall(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'web_search':
      return await webSearch({
        query: args.query ?? args.q ?? args.search_query,
        queries: args.queries,
        n: args.n ?? args.count ?? args.limit ?? args.max_results,
        engine: args.engine,
      });

    case 'image_search':
      return await imageSearch({
        query: args.query ?? args.q ?? args.search_query,
        n: args.n ?? args.count ?? args.limit ?? 15,
        safe: (args.safe as SafeSearch) || 'moderate',
        engine: args.engine,
        verifyUrls: args.verifyUrls !== undefined ? Boolean(args.verifyUrls) : true,
      });

    case 'image_download':
      return await downloadImages({
        query: args.query ?? args.q,
        images: args.images ?? args.urls,
        outputDir: args.outputDir ?? args.output_dir ?? args.dir ?? './downloads/images',
        count: args.count ?? args.n ?? args.limit,
        safe: args.safe as SafeSearch,
      });

    case 'fetch_markdown':
      return await fetchMarkdown({
        url: args.url ?? args.uri ?? args.link,
        maxChars: args.maxChars ?? args.max_chars,
        includeLinks: args.includeLinks,
        includeImages: args.includeImages,
        autoPuppeteer: args.autoPuppeteer,
        forcePuppeteer: args.forcePuppeteer,
      });

    case 'fetch_puppeteer_js':
      return await fetchWithPuppeteer({
        url: args.url ?? args.uri ?? args.link,
        waitUntil: args.waitUntil,
        waitForSelector: args.waitForSelector,
        scrollToBottom: args.scrollToBottom,
        evaluateScript: args.evaluateScript,
        screenshotPath: args.screenshotPath,
        maxChars: args.maxChars ?? args.max_chars,
      });

    case 'youtube_tool': {
      const ytInput = String(args.input ?? args.url ?? args.query ?? args.q ?? '');
      const isUrlOrId =
        /^https?:\/\//i.test(ytInput) || Boolean(extractVideoId(ytInput));
      const defaultMode: YtMode = isUrlOrId ? 'video' : 'search';
      return await youtubeTool({
        input: ytInput,
        mode: (args.mode as YtMode) || defaultMode,
        videoType: (args.videoType ?? args.video_type ?? args.type ?? 'long') as YtVideoType,
        outputDir: args.outputDir ?? args.output_dir ?? args.dir,
        audioFormat: args.audioFormat ?? args.format,
        maxHeight: args.maxHeight ?? args.height,
        searchLimit: args.searchLimit ?? args.n ?? args.limit ?? args.count,
        subLang: args.subLang ?? args.lang,
      });
    }

    case 'deep_research':
      return await deepResearch({
        query: args.query ?? args.q ?? args.topic,
        subQueries: args.subQueries ?? args.sub_queries,
        depth: (args.depth as ResearchDepth) || 'standard',
        maxPages: args.maxPages ?? args.max_pages,
        includeImages: args.includeImages ?? args.include_images,
        includeYoutube: args.includeYoutube ?? args.include_youtube,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function startMcpServer(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let req: any;
    try {
      req = JSON.parse(trimmed);
    } catch {
      sendRpcError(null, -32700, 'Parse error');
      return;
    }

    const { id, method, params } = req;

    try {
      if (method === 'initialize') {
        sendRpcResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'tuxscout',
            version: '1.0.0',
          },
        });
        return;
      }

      if (method === 'notifications/initialized') {
        return;
      }

      if (method === 'ping') {
        sendRpcResponse(id, {});
        return;
      }

      if (method === 'tools/list') {
        sendRpcResponse(id, { tools: MCP_TOOLS });
        return;
      }

      if (method === 'tools/call') {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        try {
          const output = await handleToolCall(toolName, toolArgs);
          sendRpcResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(output, null, 2),
              },
            ],
            isError: false,
          });
        } catch (toolErr) {
          sendRpcResponse(id, {
            content: [
              {
                type: 'text',
                text: `Error executing ${toolName}: ${(toolErr as Error)?.message || String(toolErr)}`,
              },
            ],
            isError: true,
          });
        }
        return;
      }

      if (id !== undefined) {
        sendRpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      if (id !== undefined) {
        sendRpcError(id, -32603, (err as Error)?.message || 'Internal error');
      }
    }
  });
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('mcp.js') || process.argv[1].endsWith('mcp.ts'))
) {
  startMcpServer();
}
