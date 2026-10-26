// src/tools/image-search.ts
// 5-Engine Image Search (Bing, DuckDuckGo, Yahoo, Wikimedia Commons, Openverse)
// + Parallel Verified Image Downloader with magic-byte verification & hotlink Referer spoofing.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  API_UA,
  BROWSER_HEADERS,
  CircuitBreaker,
  clean,
  clearCookieJar,
  DEFAULT_UA,
  EngineError,
  fetchBytesWithJar,
  fetchTextWithJar,
  hasCookies,
  hostOf,
  isHttpUrl,
  LruCache,
  num,
  proxyFetch,
  type ProxyInput,
} from '../utils/http.js';
import { attr, textOnly } from '../utils/html.js';
import type { SearchAttempt } from './web-search.js';

export interface ImageItem {
  title: string;
  imageUrl: string;
  thumbUrl: string;
  sourceUrl: string;
  sourceSite: string;
  width: number;
  height: number;
  size: string;
  type: string;
  engine: string;
  license?: string;
}

export type SafeSearch = 'off' | 'moderate' | 'strict';

export interface ImageSearchOptions {
  query: string;
  n?: number;
  safe?: SafeSearch;
  engine?: string;
  /** Verify every returned imageUrl is live (HTTP 200 + valid image magic bytes). Default: true */
  verifyUrls?: boolean;
  noCache?: boolean;
  timeoutMs?: number;
  /** Optional HTTP/HTTPS/SOCKS5 proxy URL or proxy list for rotation */
  proxy?: ProxyInput;
}

export interface ImageSearchResult {
  total: number;
  showing: number;
  images: ImageItem[];
  engine: string | null;
  engines: string[];
  no_results: boolean;
  attempts: SearchAttempt[];
  cached: boolean;
  ms: number;
}

export interface DownloadedImage extends ImageItem {
  filePath: string;
  fileName: string;
  bytes: number;
  detectedType: string;
  usedThumbnailFallback: boolean;
}

export interface ImageDownloadOptions {
  query?: string;
  images?: Array<string | Partial<ImageItem> & { imageUrl: string }>;
  outputDir: string;
  count?: number;
  safe?: SafeSearch;
  engine?: string;
  concurrency?: number;
  minBytes?: number;
  maxBytes?: number;
  timeoutPerImageMs?: number;
  allowThumbFallback?: boolean;
  saveManifest?: boolean;
  filenamePrefix?: string;
  /** Optional HTTP/HTTPS/SOCKS5 proxy URL or proxy list for rotation */
  proxy?: ProxyInput;
}

export interface ImageDownloadResult {
  outputDir: string;
  requested: number;
  downloadedCount: number;
  downloaded: DownloadedImage[];
  failedCount: number;
  failures: Array<{ url: string; reason: string }>;
  manifestPath?: string;
  ms: number;
}

type ParseResult = { images: ImageItem[]; noResults: boolean; total?: number };
type ImageEngine = {
  name: string;
  run: (
    q: string,
    n: number,
    safe: SafeSearch,
    deadline: number,
    proxy?: ProxyInput,
  ) => Promise<ParseResult>;
  skipWhen?: (safe: SafeSearch) => boolean;
};

// ── Tunables ────────────────────────────────────────────────────────────────
const ENGINE_TIMEOUT_MS = 6_000;
const TOTAL_BUDGET_MS = 14_000;
const DEFAULT_RESULTS = 20;
const MAX_RESULTS = 60;
const MAX_QUERY_CHARS = 300;

const UNUSABLE_HOST_RE =
  /(^|\.)(fbsbx\.com|fbcdn\.net|lookaside\.fbsbx\.com|cdninstagram\.com|instagram\.com|lookaside\.instagram\.com|tiktokcdn\.com|tiktokcdn-us\.com|licdn\.com|pinterest\.com|shutterstock\.com|gettyimages\.com|istockphoto\.com|alamy\.com|123rf\.com|depositphotos\.com|dreamstime\.com)$/i;
const BAD_IMAGE_PATH_RE = /\.(html?|php|aspx?|jsp|cfm)(?:$|[?#])/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif|tiff?|svg)(?:$|[?#])/i;
const WEB_FRIENDLY_MIME = /^image\/(jpeg|png|gif|webp)$/i;

const breaker = new CircuitBreaker();
const cache = new LruCache<Omit<ImageSearchResult, 'cached'>>(300, 30 * 60_000);
const vqdCache = new Map<string, { vqd: string; at: number }>();

function typeOf(u: string, mime = ''): string {
  const m = /image\/([a-z0-9.+-]+)/i.exec(mime);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const e = IMAGE_EXT_RE.exec(u);
  return e ? e[1].toLowerCase().replace('jpeg', 'jpg') : '';
}

function accept(
  out: ImageItem[],
  img: Partial<ImageItem> & { imageUrl: string },
  engine: string,
): boolean {
  const imageUrl = clean(img.imageUrl);
  if (!isHttpUrl(imageUrl) || BAD_IMAGE_PATH_RE.test(imageUrl)) return false;
  const host = hostOf(imageUrl);
  if (!host || UNUSABLE_HOST_RE.test(host)) return false;
  const sourceUrl = isHttpUrl(clean(img.sourceUrl)) ? clean(img.sourceUrl) : '';
  const thumbUrl = isHttpUrl(clean(img.thumbUrl)) ? clean(img.thumbUrl) : '';
  out.push({
    title: clean(img.title).slice(0, 200),
    imageUrl,
    thumbUrl,
    sourceUrl,
    sourceSite: clean(img.sourceSite) || hostOf(sourceUrl) || host,
    width: num(img.width),
    height: num(img.height),
    size: clean(img.size),
    type: clean(img.type) || typeOf(imageUrl),
    engine,
    ...(img.license ? { license: clean(img.license).slice(0, 80) } : {}),
  });
  return true;
}

function dedupe(list: ImageItem[]): ImageItem[] {
  const seen = new Set<string>();
  const out: ImageItem[] = [];
  for (const img of list) {
    const key = img.imageUrl
      .replace(/^https?:\/\//i, '')
      .replace(/[?#].*$/, '')
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
  }
  return out;
}

function checkStatus(engine: string, status: number, body: string): void {
  if (status === 429) throw new EngineError('rate_limited', status);
  if (status === 403 || status === 999) throw new EngineError('blocked', status);
  if (status >= 500 && !body) {
    throw new EngineError(
      engine === 'yahoo' ? 'rate_limited' : 'http_error',
      status,
      `HTTP ${status} (empty body)`,
    );
  }
  if (status >= 400) throw new EngineError('http_error', status, `HTTP ${status}`);
  const lower = body.slice(0, 120_000).toLowerCase();
  if (
    lower.includes('id="b_captcha"') ||
    lower.includes('/challenge/verify') ||
    lower.includes('captcha-container') ||
    lower.includes('anomaly-modal') ||
    lower.includes('bots use duckduckgo too') ||
    lower.includes('verify you are human') ||
    lower.includes('unusual traffic from your computer')
  ) {
    throw new EngineError('challenge', status);
  }
}

// ── Engine 1: Bing Async Image Grid ─────────────────────────────────────────
function parseBingImages(html: string): ParseResult {
  const out: ImageItem[] = [];
  const tagRe = /<a\b[^>]*\bclass="iusc"[^>]*>/gi;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    let meta: Record<string, string> = {};
    try {
      meta = JSON.parse(attr(tag, 'm'));
    } catch {
      continue;
    }
    if (!meta.murl) continue;
    const href = attr(tag, 'href');
    let width = 0;
    let height = 0;
    try {
      const sp = new URL(href, 'https://www.bing.com').searchParams;
      width = num(sp.get('expw'));
      height = num(sp.get('exph'));
    } catch {
      /* optional */
    }
    accept(
      out,
      {
        title: meta.t || meta.desc || '',
        imageUrl: meta.murl,
        thumbUrl: meta.turl,
        sourceUrl: meta.purl,
        width,
        height,
      },
      'bing',
    );
  }
  const lower = html.slice(0, 50_000).toLowerCase();
  return {
    images: out,
    noResults:
      !out.length && /there are no results for|we didn't find any results/.test(lower),
  };
}

async function runBing(
  q: string,
  n: number,
  safe: SafeSearch,
  deadline: number,
  proxy?: ProxyInput,
): Promise<ParseResult> {
  const adlt = safe === 'off' ? 'off' : safe;
  const pages = n > 35 ? [0, 35] : [0];
  const all: ImageItem[] = [];
  let noResults = false;
  for (const first of pages) {
    const url = `https://www.bing.com/images/async?q=${encodeURIComponent(
      q,
    )}&first=${first}&count=35&mmasync=1&adlt=${adlt}&setlang=en`;
    const { status, text } = await fetchTextWithJar(
      'bing-img',
      url,
      deadline,
      {
        ...BROWSER_HEADERS,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      undefined,
      proxy,
    );
    checkStatus('bing', status, text);
    const parsed = parseBingImages(text);
    if (parsed.noResults) noResults = true;
    all.push(...parsed.images);
    if (!parsed.images.length || all.length >= n) break;
  }
  return { images: all, noResults: noResults && !all.length };
}

// ── Engine 2: DuckDuckGo (vqd token -> i.js JSON) ───────────────────────────
async function ddgVqd(q: string, deadline: number, proxy?: ProxyInput): Promise<string> {
  const hit = vqdCache.get(q);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.vqd;
  const { status, text } = await fetchTextWithJar(
    'ddg-img',
    `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`,
    deadline,
    undefined,
    undefined,
    proxy,
  );
  checkStatus('duckduckgo', status, text);
  const m = /vqd=["']?([\d-]+)["']?/.exec(text);
  if (!m) throw new EngineError('no_token', status, 'vqd token not found');
  if (vqdCache.size > 200) vqdCache.clear();
  vqdCache.set(q, { vqd: m[1], at: Date.now() });
  return m[1];
}

async function runDuckDuckGo(
  q: string,
  n: number,
  safe: SafeSearch,
  deadline: number,
  proxy?: ProxyInput,
): Promise<ParseResult> {
  const vqd = await ddgVqd(q, deadline, proxy);
  const p = safe === 'off' ? '-1' : '1';
  const url = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(
    q,
  )}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=${p}`;
  const { status, text } = await fetchTextWithJar(
    'ddg-img',
    url,
    deadline,
    {
      'User-Agent': DEFAULT_UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://duckduckgo.com/',
      'X-Requested-With': 'XMLHttpRequest',
    },
    undefined,
    proxy,
  );
  if (status === 403) vqdCache.delete(q);
  checkStatus('duckduckgo', status, text);
  let data: {
    results?: Array<{
      title?: string;
      image?: string;
      thumbnail?: string;
      url?: string;
      width?: number;
      height?: number;
    }>;
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new EngineError('bad_json', status, 'i.js did not return JSON');
  }
  const out: ImageItem[] = [];
  for (const r of Array.isArray(data?.results) ? data.results : []) {
    if (!r.image) continue;
    accept(
      out,
      {
        title: r.title,
        imageUrl: r.image,
        thumbUrl: r.thumbnail,
        sourceUrl: r.url,
        sourceSite: hostOf(String(r.url || '')),
        width: r.width,
        height: r.height,
      },
      'duckduckgo',
    );
    if (out.length >= n) break;
  }
  return {
    images: out,
    noResults: Array.isArray(data?.results) && data.results.length === 0,
  };
}

// ── Engine 3: Yahoo HTML Image Tiles ────────────────────────────────────────
function parseYahooImages(html: string): ParseResult {
  const out: ImageItem[] = [];
  const tileRe = /<a\b[^>]*\bimage-tile\b[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = tileRe.exec(html))) {
    const openTag = m[0].slice(0, m[0].indexOf('>') + 1);
    const inner = m[1];
    let imageUrl = attr(openTag, 'data-origurl');
    if (!imageUrl) {
      try {
        imageUrl = new URL(attr(openTag, 'href')).searchParams.get('imgurl') || '';
      } catch {
        imageUrl = '';
      }
    }
    if (!imageUrl) continue;
    const imgTag = (/<img\b[^>]*>/i.exec(inner) || [''])[0];
    let width = 0;
    let height = 0;
    try {
      const meta = JSON.parse(attr(imgTag, 'data-meta') || '{}');
      width = num(meta.ow);
      height = num(meta.oh);
    } catch {
      /* optional */
    }
    const title = textOnly(
      (/<p\b[^>]*\btile-title\b[^>]*>([\s\S]*?)<\/p>/i.exec(inner) || ['', ''])[1],
    );
    const site = textOnly(
      (/<p\b[^>]*\btile-domain\b[^>]*>([\s\S]*?)<\/p>/i.exec(inner) || ['', ''])[1],
    );
    accept(
      out,
      {
        title,
        imageUrl,
        thumbUrl: attr(imgTag, 'src') || attr(imgTag, 'data-src'),
        sourceUrl: attr(openTag, 'data-referenceurl'),
        sourceSite: site,
        width,
        height,
      },
      'yahoo',
    );
  }
  const lower = html.slice(0, 200_000).toLowerCase();
  return {
    images: out,
    noResults: !out.length && /we did not find results for|no results found for/.test(lower),
  };
}

async function runYahoo(
  q: string,
  _n: number,
  safe: SafeSearch,
  deadline: number,
  proxy?: ProxyInput,
): Promise<ParseResult> {
  const vm = safe === 'strict' ? '&vm=r' : '';
  const url = `https://images.search.yahoo.com/search/images?p=${encodeURIComponent(q)}${vm}`;
  let { status, text } = await fetchTextWithJar('yahoo-img', url, deadline, undefined, undefined, proxy);
  if (status >= 500 && !text && hasCookies('yahoo-img') && deadline - Date.now() > 1_000) {
    clearCookieJar('yahoo-img');
    ({ status, text } = await fetchTextWithJar('yahoo-img', url, deadline, undefined, undefined, proxy));
  }
  checkStatus('yahoo', status, text);
  const parsed = parseYahooImages(text);
  if (!parsed.images.length) {
    throw new EngineError(
      'soft_block',
      status,
      'Yahoo returned a zero-result page (datacenter soft block)',
    );
  }
  return parsed;
}

// ── Engine 4: Wikimedia Commons API ─────────────────────────────────────────
async function runWikimedia(
  q: string,
  n: number,
  _safe: SafeSearch,
  deadline: number,
  proxy?: ProxyInput,
): Promise<ParseResult> {
  const limit = Math.min(50, Math.max(10, n));
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2' +
    `&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(
      `${q} filetype:bitmap`,
    )}` +
    '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=LicenseShortName|ObjectName&iiurlwidth=1280';
  const { status, text } = await fetchTextWithJar(
    'wikimedia',
    url,
    deadline,
    {
      'User-Agent': API_UA,
      Accept: 'application/json',
    },
    undefined,
    proxy,
  );
  checkStatus('wikimedia', status, text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new EngineError('bad_json', status);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages: any[] = Array.isArray(data?.query?.pages) ? data.query.pages : [];
  pages.sort((a, b) => (a.index || 0) - (b.index || 0));
  const out: ImageItem[] = [];
  for (const page of pages) {
    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
    if (!info?.url) continue;
    const original =
      WEB_FRIENDLY_MIME.test(info.mime || '') && Number(info.size) < 6_000_000;
    const meta = info.extmetadata || {};
    accept(
      out,
      {
        title:
          clean(meta.ObjectName?.value) ||
          String(page.title || '')
            .replace(/^File:/, '')
            .replace(/\.[a-z0-9]+$/i, ''),
        imageUrl: original ? info.url : info.thumburl || info.url,
        thumbUrl: info.thumburl || info.url,
        sourceUrl: info.descriptionurl,
        sourceSite: 'commons.wikimedia.org',
        width: original ? info.width : info.thumbwidth || info.width,
        height: original ? info.height : info.thumbheight || info.height,
        size: info.size ? `${Math.round(Number(info.size) / 1024)} KB` : '',
        type: typeOf(info.url, info.mime),
        license: textOnly(String(meta.LicenseShortName?.value || '')),
      },
      'wikimedia',
    );
  }
  return { images: out, noResults: !pages.length };
}

// ── Engine 5: Openverse API ─────────────────────────────────────────────────
async function runOpenverse(
  q: string,
  n: number,
  _safe: SafeSearch,
  deadline: number,
  proxy?: ProxyInput,
): Promise<ParseResult> {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(
    q,
  )}&page_size=${Math.min(20, Math.max(5, n))}&mature=false`;
  const { status, text } = await fetchTextWithJar(
    'openverse',
    url,
    deadline,
    {
      'User-Agent': API_UA,
      Accept: 'application/json',
    },
    undefined,
    proxy,
  );
  checkStatus('openverse', status, text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new EngineError('bad_json', status);
  }
  const out: ImageItem[] = [];
  for (const r of Array.isArray(data?.results) ? data.results : []) {
    accept(
      out,
      {
        title: r.title,
        imageUrl: r.url,
        thumbUrl: r.thumbnail,
        sourceUrl: r.foreign_landing_url,
        sourceSite: hostOf(String(r.foreign_landing_url || '')) || r.source,
        width: r.width,
        height: r.height,
        size: r.filesize ? `${Math.round(Number(r.filesize) / 1024)} KB` : '',
        type: r.filetype || '',
        license: r.license
          ? `CC ${String(r.license).toUpperCase()} ${r.license_version || ''}`.trim()
          : '',
      },
      'openverse',
    );
  }
  return {
    images: out,
    noResults: Number(data?.result_count) === 0,
    total: num(data?.result_count),
  };
}

const ENGINES: ImageEngine[] = [
  { name: 'bing', run: runBing },
  { name: 'duckduckgo', run: runDuckDuckGo },
  { name: 'yahoo', run: runYahoo },
  { name: 'wikimedia', run: runWikimedia, skipWhen: (safe) => safe === 'strict' },
  { name: 'openverse', run: runOpenverse },
];

function configuredEngines(): ImageEngine[] {
  const raw = (process.env.IMAGE_ENGINE_ORDER || '').toLowerCase();
  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const picked = wanted
    .map((name) => ENGINES.find((e) => e.name === name))
    .filter((e): e is ImageEngine => !!e);
  return picked.length ? [...new Set(picked)] : ENGINES;
}

// ── Live Parallel URL & Magic-Byte Verifier ─────────────────────────────────
async function probeImageUrl(
  url: string,
  timeoutMs = 2400,
  proxy?: ProxyInput,
): Promise<{ ok: boolean; ext?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await proxyFetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      proxy,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Range: 'bytes=0-2047',
      },
    });
    if (res.status < 200 || res.status >= 400) {
      await res.body?.cancel().catch(() => {});
      return { ok: false };
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      await res.body?.cancel().catch(() => {});
      return { ok: false };
    }
    const contentLen = Number(res.headers.get('content-length') || 0);
    // Reject tiny 1x1 tracking pixels when full content-length is reported on a 200 response
    if (res.status === 200 && contentLen > 0 && contentLen < 500) {
      await res.body?.cancel().catch(() => {});
      return { ok: false };
    }

    if (!res.body) return { ok: false };
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let totalRead = 0;
    while (totalRead < 512) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(Buffer.from(value));
      totalRead += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    const headerBuf = Buffer.concat(chunks);
    const ext = detectImageFormat(headerBuf, contentType, url);
    if (!ext) return { ok: false };
    return { ok: true, ext };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyImageCandidates(
  candidates: ImageItem[],
  targetCount: number,
  deadline: number,
  proxy?: ProxyInput,
): Promise<ImageItem[]> {
  if (!candidates.length) return [];
  const pool = candidates.slice(0, Math.max(targetCount * 3, 24));
  const verifiedPrimary: Array<{ idx: number; item: ImageItem }> = [];
  const fallbackThumbs: Array<{ idx: number; item: ImageItem }> = [];
  let cursor = 0;
  const concurrency = Math.min(10, pool.length);

  async function worker() {
    while (verifiedPrimary.length < targetCount && cursor < pool.length) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 350) break;
      const idx = cursor++;
      const item = pool[idx];
      if (!item) break;

      const probeTimeout = Math.min(2400, Math.max(600, remainingMs - 100));
      const primary = await probeImageUrl(item.imageUrl, probeTimeout, proxy);
      if (primary.ok) {
        verifiedPrimary.push({
          idx,
          item: {
            ...item,
            type: item.type || primary.ext || '',
          },
        });
        continue;
      }

      // If primary imageUrl is dead/hotlink-blocked, check if thumbUrl is a valid working image
      if (item.thumbUrl && isHttpUrl(item.thumbUrl) && item.thumbUrl !== item.imageUrl) {
        const thumbProbe = await probeImageUrl(item.thumbUrl, Math.min(1500, probeTimeout), proxy);
        if (thumbProbe.ok) {
          fallbackThumbs.push({
            idx,
            item: {
              ...item,
              imageUrl: item.thumbUrl,
              type: item.type || thumbProbe.ext || '',
            },
          });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  verifiedPrimary.sort((a, b) => a.idx - b.idx);
  const out = verifiedPrimary.map((v) => v.item);
  if (out.length < targetCount && fallbackThumbs.length) {
    fallbackThumbs.sort((a, b) => a.idx - b.idx);
    for (const fb of fallbackThumbs) {
      if (out.length >= targetCount) break;
      out.push(fb.item);
    }
  }
  return out.slice(0, targetCount);
}

export async function imageSearch(options: ImageSearchOptions): Promise<ImageSearchResult> {
  const query = clean(options.query).slice(0, MAX_QUERY_CHARS);
  if (!query) throw new Error('imageSearch requires a non-empty "query" string.');

  const n = Math.max(1, Math.min(MAX_RESULTS, Math.floor(Number(options.n) || DEFAULT_RESULTS)));
  const safe: SafeSearch =
    options.safe === 'off' || options.safe === 'strict' ? options.safe : 'moderate';
  const only = clean(options.engine).toLowerCase().slice(0, 40) || undefined;
  const verifyUrls = options.verifyUrls !== false;
  const budgetMs = options.timeoutMs || TOTAL_BUDGET_MS;

  const cacheKey = `${n}:${safe}:${only || ''}:${verifyUrls ? 'v1' : 'raw'}:${query.toLowerCase()}`;
  if (!options.noCache) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, cached: true };
  }

  const started = Date.now();
  const deadline = started + budgetMs;
  const attempts: SearchAttempt[] = [];
  let merged: ImageItem[] = [];
  const used: string[] = [];
  let sawNoResults = false;
  let total = 0;
  // Fetch a larger candidate pool when verifying URLs so dead/403 links can be filtered out
  const targetPoolSize = verifyUrls ? Math.min(MAX_RESULTS, Math.max(n * 3, 24)) : Math.min(n, 12);

  const usable = (only ? ENGINES : configuredEngines()).filter((e) => !e.skipWhen?.(safe));
  for (const engine of breaker.order(usable, only)) {
    if (Date.now() > deadline - 500) break;
    const t0 = Date.now();
    try {
      const engineDeadline = Math.min(deadline, Date.now() + ENGINE_TIMEOUT_MS);
      const parsed = await engine.run(query, targetPoolSize, safe, engineDeadline, options.proxy);
      if (!parsed.images.length && !parsed.noResults) {
        throw new EngineError('empty_or_layout_changed', 200);
      }
      breaker.reportOk(engine.name);
      attempts.push({
        engine: engine.name,
        ok: true,
        status: 200,
        ms: Date.now() - t0,
        count: parsed.images.length,
      });
      if (parsed.noResults) sawNoResults = true;
      if (parsed.images.length) {
        merged = dedupe(merged.concat(parsed.images));
        used.push(engine.name);
        total = Math.max(total, parsed.total || 0);
      }
      if (merged.length >= targetPoolSize) break;
      if (sawNoResults && !merged.length && ['bing', 'duckduckgo'].includes(engine.name)) break;
    } catch (err) {
      const e = err as EngineError;
      breaker.reportFail(engine.name, e.reason || 'error');
      attempts.push({
        engine: engine.name,
        ok: false,
        status: e.status || 0,
        ms: Date.now() - t0,
        count: 0,
        reason: e.reason || 'error',
        ...(e.message && e.message !== e.reason ? { detail: clean(e.message).slice(0, 160) } : {}),
      });
    }
  }

  const images = verifyUrls
    ? await verifyImageCandidates(merged, n, deadline, options.proxy)
    : merged.slice(0, n);
  const body = {
    total: Math.max(total, merged.length),
    showing: images.length,
    images,
    engine: used[0] || null,
    engines: used,
    no_results: sawNoResults && !images.length,
    attempts,
    ms: Date.now() - started,
  };

  if (images.length || body.no_results) {
    cache.set(cacheKey, body);
  }
  return { ...body, cached: false };
}

// ── Magic-Byte Image Verification & Downloader ──────────────────────────────
function detectImageFormat(buf: Buffer, contentType = '', url = ''): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return 'png';
  // GIF: GIF87a or GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return 'webp';
  // BMP: BM
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  // AVIF / HEIC: ....ftypavif / ftypheic
  const ftyp = buf.subarray(4, 12).toString('ascii');
  if (ftyp.startsWith('ftypavif') || ftyp.startsWith('ftypavis')) return 'avif';
  // TIFF: II*\0 or MM\0*
  if (
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
    (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)
  )
    return 'tiff';
  // Check if HTML error page disguised as image
  const headText = buf.subarray(0, 256).toString('utf8').trim().toLowerCase();
  if (
    headText.startsWith('<!doctype html') ||
    headText.startsWith('<html') ||
    headText.startsWith('<head') ||
    headText.startsWith('{"error')
  ) {
    return null;
  }
  if (headText.includes('<svg')) return 'svg';
  const t = typeOf(url, contentType);
  if (t && contentType.toLowerCase().startsWith('image/')) return t;
  return null;
}

function sanitizeSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'image'
  );
}

async function fetchSingleValidImage(
  candidate: ImageItem,
  timeoutMs: number,
  minBytes: number,
  maxBytes: number,
  allowThumbFallback: boolean,
  proxy?: ProxyInput,
): Promise<{ buffer: Buffer; ext: string; usedThumbnail: boolean }> {
  const urlsToTry: Array<{ url: string; isThumb: boolean }> = [
    { url: candidate.imageUrl, isThumb: false },
  ];
  if (
    allowThumbFallback &&
    candidate.thumbUrl &&
    candidate.thumbUrl !== candidate.imageUrl
  ) {
    urlsToTry.push({ url: candidate.thumbUrl, isThumb: true });
  }

  let lastErr = 'unknown error';
  for (const attempt of urlsToTry) {
    try {
      const originReferer = candidate.sourceUrl || new URL(attempt.url).origin + '/';
      const headers: Record<string, string> = {
        'User-Agent': DEFAULT_UA,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: originReferer,
      };
      const { status, buffer, contentType } = await fetchBytesWithJar(
        'img-dl',
        attempt.url,
        Date.now() + timeoutMs,
        headers,
        maxBytes,
        proxy,
      );
      if (status >= 400) {
        lastErr = `HTTP ${status}`;
        continue;
      }
      if (buffer.length < (attempt.isThumb ? Math.min(minBytes, 800) : minBytes)) {
        lastErr = `File too small (${buffer.length} bytes)`;
        continue;
      }
      const ext = detectImageFormat(buffer, contentType, attempt.url);
      if (!ext) {
        lastErr = `Invalid image magic bytes (content-type: ${contentType || 'none'})`;
        continue;
      }
      return { buffer, ext, usedThumbnail: attempt.isThumb };
    } catch (err) {
      lastErr = (err as Error)?.message || String(err);
    }
  }
  throw new Error(lastErr);
}

export async function downloadImages(
  options: ImageDownloadOptions,
): Promise<ImageDownloadResult> {
  const started = Date.now();
  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const requested = Math.max(1, Math.min(60, Math.floor(Number(options.count) || 5)));
  const concurrency = Math.max(1, Math.min(12, Math.floor(Number(options.concurrency) || 5)));
  const minBytes = options.minBytes ?? 1_500;
  const maxBytes = options.maxBytes ?? 35 * 1024 * 1024;
  const timeoutPerImageMs = options.timeoutPerImageMs ?? 8_000;
  const allowThumbFallback = options.allowThumbFallback ?? true;
  const prefix = options.filenamePrefix ? `${sanitizeSlug(options.filenamePrefix)}-` : '';

  let pool: ImageItem[] = [];
  if (Array.isArray(options.images) && options.images.length) {
    for (const item of options.images) {
      if (typeof item === 'string') {
        accept(pool, { imageUrl: item, title: path.basename(new URL(item).pathname) }, 'direct');
      } else if (item && typeof item.imageUrl === 'string') {
        accept(pool, item, item.engine || 'direct');
      }
    }
  } else if (options.query) {
    // Request a larger candidate pool so if some hosts timeout/403, we still fulfill `requested`
    const searchCount = Math.min(60, Math.max(requested * 3, 20));
    const searchRes = await imageSearch({
      query: options.query,
      n: searchCount,
      safe: options.safe,
      engine: options.engine,
      verifyUrls: false,
      proxy: options.proxy,
    });
    pool = searchRes.images;
  } else {
    throw new Error('downloadImages requires either "query" or "images" array.');
  }

  const downloaded: DownloadedImage[] = [];
  const failures: Array<{ url: string; reason: string }> = [];
  let cursor = 0;

  async function worker() {
    while (downloaded.length < requested && cursor < pool.length) {
      const idx = cursor++;
      const candidate = pool[idx];
      if (!candidate) break;
      try {
        const { buffer, ext, usedThumbnail } = await fetchSingleValidImage(
          candidate,
          timeoutPerImageMs,
          minBytes,
          maxBytes,
          allowThumbFallback,
          options.proxy,
        );
        if (downloaded.length >= requested) break;
        const slot = downloaded.length + 1;
        const hash = crypto.createHash('md5').update(candidate.imageUrl).digest('hex').slice(0, 6);
        const slug = sanitizeSlug(candidate.title || options.query || 'img');
        const fileName = `${prefix}${String(slot).padStart(2, '0')}-${slug}-${hash}.${ext}`;
        const filePath = path.join(outputDir, fileName);
        await fs.writeFile(filePath, buffer);
        downloaded.push({
          ...candidate,
          filePath,
          fileName,
          bytes: buffer.length,
          detectedType: ext,
          usedThumbnailFallback: usedThumbnail,
        });
      } catch (err) {
        failures.push({
          url: candidate.imageUrl,
          reason: (err as Error)?.message || String(err),
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pool.length || 1) }, () => worker());
  await Promise.all(workers);

  let manifestPath: string | undefined;
  if (options.saveManifest !== false) {
    manifestPath = path.join(outputDir, 'manifest.json');
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          query: options.query || null,
          downloadedAt: new Date().toISOString(),
          count: downloaded.length,
          images: downloaded,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  return {
    outputDir,
    requested,
    downloadedCount: downloaded.length,
    downloaded,
    failedCount: failures.length,
    failures,
    manifestPath,
    ms: Date.now() - started,
  };
}
