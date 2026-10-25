// src/tools/web-search.ts
// Multi-engine resilient Web Search with 4-layer relevance scoring,
// intent classification, landing-page rejection, engine-level hijack detection,
// per-engine circuit breaker, cookie jar, and concurrent multi-angle query merging.

import {
  API_UA,
  BROWSER_HEADERS,
  CircuitBreaker,
  clean,
  clearCookieJar,
  EngineError,
  fetchTextWithJar,
  hasCookies,
  isHttpUrl,
  LruCache,
} from '../utils/http.js';
import {
  attr,
  extractTagBlocks,
  firstTag,
  firstText,
  ownClassIncludes,
  textOnly,
} from '../utils/html.js';

export interface WebSource {
  title: string;
  url: string;
  description: string;
  engine?: string;
}

export interface SearchAttempt {
  engine: string;
  ok: boolean;
  status: number;
  ms: number;
  count: number;
  reason?: string;
  detail?: string;
}

export interface WebSearchOptions {
  query?: string;
  queries?: string[];
  n?: number;
  engine?: string;
  noCache?: boolean;
  timeoutMs?: number;
}

export interface WebSearchResult {
  internet_data: string;
  sources: WebSource[];
  engine: string | null;
  engines: string[];
  no_results: boolean;
  attempts: SearchAttempt[];
  cached: boolean;
  ms: number;
  intent?: Intent;
  queries_executed?: string[];
}

type ParseResult = { sources: WebSource[]; noResults: boolean };
export type Intent = 'news' | 'evergreen' | 'navigational';

// ── Tunables ────────────────────────────────────────────────────────────────
const ENGINE_TIMEOUT_MS = 7_000;
const TOTAL_BUDGET_MS = 20_000;
const MIN_GOOD_RESULTS = 4;
const MIN_ENGINE_RELEVANCE = 0.34;
const DEFAULT_RESULTS = 10;
const MAX_RESULTS = 30;
const MAX_QUERY_CHARS = 400;
const MAX_QUERIES = 6;

const breaker = new CircuitBreaker();
const cache = new LruCache<Omit<WebSearchResult, 'cached'>>(300, 10 * 60_000);

// ── Stopwords & Intent Classification ───────────────────────────────────────
const STOPWORDS = new Set(
  (
    'a an the and or but if then than that this these those is are was were be been being am ' +
    'i me my mine you your yours he she it we they them his her its our their of to in on at for with from by as ' +
    'so not no do does did doing have has had having will would can could should about into over under again more ' +
    'most some such only own same too very just also what which who whom when where why how all any both each few ' +
    'other please thanks thank hello hi hey'
  ).split(/\s+/),
);

const GENERIC_QUERY_TERMS = new Set(
  (
    'latest newest news today tonight yesterday recent recently current currently now upcoming soon breaking live trending ' +
    'update updates updated week month year daily weekly headlines headline roundup'
  ).split(/\s+/),
);

export function queryTerms(query: string): string[] {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s+]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export function subjectTerms(query: string): string[] {
  return queryTerms(query).filter((t) => !GENERIC_QUERY_TERMS.has(t));
}

const NEWS_INTENT_RE =
  /\b(news|latest|recent|release|releases|released|launch|launched|announce|announced|announcement|update|updates|updated|changelog|release notes|version|versions|breaking|deprecat\w*|this week|this month|today|yesterday|20\d\d|patch|patched|fix|fixed|bug|just out|out now)\b/i;

const NAVIGATIONAL_RE =
  /^[\w\s-]{0,40}(pricing|plans|login|sign in|sign up|download|install|docs|documentation|official|website|homepage|contact|support|faq|status|legal|terms|privacy|careers|jobs|about|blog|github)\b/i;

export function classifyIntent(query: string): Intent {
  if (NEWS_INTENT_RE.test(query)) return 'news';
  if (NAVIGATIONAL_RE.test(String(query).trim())) return 'navigational';
  return 'evergreen';
}

export function looksLikeLandingPage(url: string): boolean {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return true;
    if (segs.length > 2) return false;
    const path_ = segs.join('/').toLowerCase();
    if (
      /\b(blog|news|release|releases|changelog|update|updates|post|posts|article|articles|docs?|guides?|announcement|wiki)\b/.test(
        path_,
      )
    ) {
      return false;
    }
    const last = segs[segs.length - 1].toLowerCase();
    if (/\d{4}/.test(last)) return false;
    if (/\d/.test(last)) return false;
    if (segs.length >= 2) return false;
    return true;
  } catch {
    return false;
  }
}

const NAV_CHROME_RE = new RegExp(
  '^(?:https?://(?:[a-z0-9-]+\\.)*(?:google\\.[a-z.]{2,}|bing\\.com|duckduckgo\\.com|search\\.yahoo\\.com|baidu\\.com|yandex\\.[a-z.]{2,}|ecosia\\.org|search\\.brave\\.com)/(?:search|webhp|imghp|images|video)(?:/|\\?|$))' +
    '|(?:[?&](?:q|p|query|wd)=)',
  'i',
);

const AD_URL_RE = /\/aclick\?|\/cbclk|duckduckgo\.com\/y\.js|[?&]ad_domain=|[?&]ad_provider=/i;

function isSearchEngineRoot(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave)\.[a-z.]+$/.test(
      u.hostname,
    );
  } catch {
    return false;
  }
}

export function relevance(source: WebSource, terms: string[]): number {
  if (!terms.length) return 1;
  const title = source.title.toLowerCase();
  const desc = (source.description || '').toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 2;
    else if (desc.includes(t)) score += 1;
  }
  return score / (terms.length * 2);
}

export function isWorthKeeping(
  source: WebSource,
  terms: string[],
  intent: Intent,
  subject: string[],
): boolean {
  if (
    NAV_CHROME_RE.test(source.url) ||
    /^(google|bing|duckduckgo|yahoo|brave)\s+search$/i.test(source.title.trim())
  ) {
    return false;
  }
  const subjectTermsList = subject && subject.length ? subject : terms;
  if (relevance(source, subjectTermsList) <= 0) {
    if (intent === 'navigational' && isSearchEngineRoot(source.url)) return true;
    return false;
  }
  if (intent === 'news' && looksLikeLandingPage(source.url)) return false;
  return true;
}

export function engineRelevanceVerdict(sources: WebSource[], query: string) {
  const subject = subjectTerms(query);
  const total = sources.length;
  if (!total) return { total: 0, strong: 0, ratio: 0 };
  if (!subject.length) return { total, strong: total, ratio: 1 };
  let strong = 0;
  const need = Math.min(2, subject.length);
  for (const s of sources) {
    const text = `${s.title} ${s.description || ''} ${s.url}`.toLowerCase();
    let n = 0;
    for (const t of subject) if (text.includes(t)) n += 1;
    if (n >= need) strong += 1;
  }
  return { total, strong, ratio: strong / total };
}

export function rankSources(sources: WebSource[], terms: string[]): WebSource[] {
  return sources
    .map((s, i) => ({ s, i, r: relevance(s, terms) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.s);
}

function dedupe(list: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const s of list) {
    const key = s.url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ── URL Unwrapping ──────────────────────────────────────────────────────────
function unwrapYahoo(href: string): string {
  const marker = href.indexOf('/RU=');
  if (marker === -1) return href;
  const encoded = href.slice(marker + 4).split('/')[0];
  try {
    const decoded = decodeURIComponent(encoded);
    return isHttpUrl(decoded) ? decoded : href;
  } catch {
    return href;
  }
}

function unwrapBing(href: string): string {
  try {
    const parsed = new URL(href, 'https://www.bing.com');
    if (!/(^|\.)bing\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith('/ck/'))
      return parsed.href;
    const u = parsed.searchParams.get('u') || '';
    if (!u.startsWith('a1')) return parsed.href;
    let b64 = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    return isHttpUrl(decoded) ? decoded : parsed.href;
  } catch {
    return href;
  }
}

function unwrapDuckDuckGo(href: string): string {
  let raw = String(href || '').trim();
  if (raw.startsWith('//')) raw = `https:${raw}`;
  try {
    const parsed = new URL(raw, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return raw;
  }
}

function accept(
  out: WebSource[],
  title: string,
  url: string,
  description: string,
  engine: string,
): void {
  if (!title || !isHttpUrl(url) || AD_URL_RE.test(url)) return;
  out.push({
    title: title.slice(0, 300),
    url,
    description: description.slice(0, 600),
    engine,
  });
}

// ── Engine Parsers ──────────────────────────────────────────────────────────
function parseYahoo(html: string): ParseResult {
  const out: WebSource[] = [];
  const wrappers = extractTagBlocks(html, 'ol', 'searchCenterMiddle');
  const scope = wrappers.length ? wrappers.join('') : html;
  let nodes = extractTagBlocks(scope, 'div', 'algo');
  if (!nodes.length) nodes = extractTagBlocks(html, 'div', 'algo');
  for (const node of nodes) {
    const link = firstTag(node, 'h3')?.inner ?? node;
    const a = firstTag(link, 'a') ?? firstTag(node, 'a');
    if (!a) continue;
    const url = unwrapYahoo(attr(a.openTag, 'href'));
    const title = clean(attr(a.openTag, 'aria-label') || textOnly(a.inner));
    const description = clean(firstText(node, 'div', 'compText'));
    accept(out, title, url, description, 'yahoo');
  }
  const text = textOnly(html).toLowerCase();
  return {
    sources: out,
    noResults: !out.length && /we did not find results for|no results found for/.test(text),
  };
}

function parseBing(html: string): ParseResult {
  const out: WebSource[] = [];
  for (const node of extractTagBlocks(html, 'li', 'b_algo')) {
    const heading = firstTag(node, 'h2')?.inner;
    const a = (heading ? firstTag(heading, 'a') : null) ?? firstTag(node, 'a');
    if (!a) continue;
    const url = unwrapBing(attr(a.openTag, 'href'));
    const title = clean(textOnly(a.inner));
    const captionScope = firstTag(node, 'div', 'b_caption')?.inner ?? '';
    const caption =
      firstText(captionScope, 'p') || firstText(node, 'p') || firstText(node, 'p', 'b_lineclamp2');
    accept(out, title, url, clean(caption), 'bing');
  }
  const text = textOnly(html).toLowerCase();
  return { sources: out, noResults: !out.length && /there are no results for/.test(text) };
}

function parseDuckDuckGoHtml(html: string): ParseResult {
  const out: WebSource[] = [];
  for (const node of extractTagBlocks(html, 'div', 'result')) {
    if (ownClassIncludes(node, 'result--ad')) continue;
    const a = firstTag(node, 'a', 'result__a');
    if (!a) continue;
    const url = unwrapDuckDuckGo(attr(a.openTag, 'href'));
    accept(
      out,
      clean(textOnly(a.inner)),
      url,
      clean(firstText(node, 'a', 'result__snippet') || firstText(node, 'div', 'result__snippet')),
      'duckduckgo',
    );
  }
  const text = textOnly(html).toLowerCase();
  return {
    sources: out,
    noResults: !out.length && /no results\.|no more results/.test(text),
  };
}

function parseDuckDuckGoLite(html: string): ParseResult {
  const out: WebSource[] = [];
  let last: WebSource | null = null;
  for (const row of extractTagBlocks(html, 'tr')) {
    if (ownClassIncludes(row, 'result-sponsored')) {
      last = null;
      continue;
    }
    const link = firstTag(row, 'a', 'result-link');
    if (link) {
      const before = out.length;
      accept(
        out,
        clean(textOnly(link.inner)),
        unwrapDuckDuckGo(attr(link.openTag, 'href')),
        '',
        'duckduckgo-lite',
      );
      last = out.length > before ? out[out.length - 1] : null;
      continue;
    }
    const snippet = firstText(row, 'td', 'result-snippet');
    if (snippet && last && !last.description) {
      last.description = clean(snippet).slice(0, 600);
    }
  }
  const text = textOnly(html).toLowerCase();
  return { sources: out, noResults: !out.length && /no results\./.test(text) };
}

function parseBrave(html: string): ParseResult {
  const out: WebSource[] = [];
  const blocks = extractTagBlocks(html, 'div', 'snippet');
  for (const block of blocks) {
    const a = firstTag(block, 'a');
    if (!a) continue;
    const url = attr(a.openTag, 'href');
    if (!isHttpUrl(url) || url.includes('brave.com')) continue;
    const title =
      firstText(block, 'div', 'title') ||
      firstText(block, 'span', 'snippet-title') ||
      clean(textOnly(a.inner));
    const desc =
      firstText(block, 'div', 'snippet-description') ||
      firstText(block, 'p', 'snippet-description') ||
      '';
    accept(out, clean(title), url, clean(desc), 'brave');
  }
  const text = textOnly(html).toLowerCase();
  return {
    sources: out,
    noResults: !out.length && /not many results contain|no results found/.test(text),
  };
}

async function runWikipedia(query: string, deadline: number): Promise<ParseResult> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query,
    )}&utf8=&format=json&srlimit=10`;
  const { status, text } = await fetchTextWithJar('wikipedia', url, deadline, {
    'User-Agent': API_UA,
    Accept: 'application/json',
  });
  if (status >= 400) throw new EngineError('http_error', status, `HTTP ${status}`);
  let data: { query?: { search?: Array<{ title: string; snippet: string }> } };
  try {
    data = JSON.parse(text);
  } catch {
    throw new EngineError('bad_json', status);
  }
  const items = Array.isArray(data?.query?.search) ? data.query.search : [];
  const out: WebSource[] = [];
  for (const item of items) {
    const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(
      item.title.replace(/\s+/g, '_'),
    )}`;
    accept(out, clean(item.title), pageUrl, textOnly(item.snippet || ''), 'wikipedia');
  }
  return { sources: out, noResults: items.length === 0 };
}

function looksChallenged(engine: string, status: number, html: string): string | null {
  if (status === 429) return 'rate_limited';
  if (status === 403 || status === 999) return 'blocked';
  if (engine === 'yahoo' && status >= 500 && !html) return 'rate_limited';
  const lower = html.slice(0, 200_000).toLowerCase();
  if (
    engine.startsWith('duckduckgo') &&
    (lower.includes('anomaly-modal') || lower.includes('bots use duckduckgo too'))
  )
    return 'challenge';
  if (
    engine === 'bing' &&
    (lower.includes('id="b_captcha"') ||
      lower.includes('/challenge/verify') ||
      lower.includes('captcha-container'))
  )
    return 'challenge';
  if (
    lower.includes('verify you are human') ||
    lower.includes('unusual traffic from your computer') ||
    lower.includes('pow-captcha')
  )
    return 'challenge';
  return null;
}

type HtmlEngine = {
  name: string;
  jar: string;
  url: (q: string) => string;
  parse?: (html: string) => ParseResult;
  customRun?: (q: string, deadline: number) => Promise<ParseResult>;
};

const ENGINES: HtmlEngine[] = [
  {
    name: 'duckduckgo',
    jar: 'ddg',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDuckDuckGoHtml,
  },
  {
    name: 'duckduckgo-lite',
    jar: 'ddg',
    url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
    parse: parseDuckDuckGoLite,
  },
  {
    name: 'brave',
    jar: 'brave',
    url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`,
    parse: parseBrave,
  },
  {
    name: 'yahoo',
    jar: 'yahoo',
    url: (q) => `https://in.search.yahoo.com/search?p=${encodeURIComponent(q)}&n=20`,
    parse: parseYahoo,
  },
  {
    name: 'bing',
    jar: 'bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`,
    parse: parseBing,
  },
  {
    name: 'wikipedia',
    jar: 'wikipedia',
    url: () => '',
    customRun: runWikipedia,
  },
];

function configuredEngines(): HtmlEngine[] {
  const raw = (process.env.WEB_ENGINE_ORDER || '').toLowerCase();
  if (!raw) {
    // By default matches Delphos: duckduckgo -> duckduckgo-lite -> brave -> yahoo -> wikipedia
    // (bing is available when explicitly pinned or added to WEB_ENGINE_ORDER)
    return ENGINES.filter((e) => e.name !== 'bing');
  }
  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const picked = wanted
    .map((name) => ENGINES.find((e) => e.name === name))
    .filter((e): e is HtmlEngine => !!e);
  return picked.length ? [...new Set(picked)] : ENGINES;
}

async function runEngine(engine: HtmlEngine, query: string, deadline: number): Promise<ParseResult> {
  const engineDeadline = Math.min(deadline, Date.now() + ENGINE_TIMEOUT_MS);
  if (engine.customRun) {
    return engine.customRun(query, engineDeadline);
  }
  let { status, text: html } = await fetchTextWithJar(
    engine.jar,
    engine.url(query),
    engineDeadline,
    BROWSER_HEADERS,
  );
  // Stale Yahoo YBV cookie retry
  if (
    status >= 500 &&
    !html &&
    hasCookies(engine.jar) &&
    engineDeadline - Date.now() > 1_000
  ) {
    clearCookieJar(engine.jar);
    ({ status, text: html } = await fetchTextWithJar(
      engine.jar,
      engine.url(query),
      engineDeadline,
      BROWSER_HEADERS,
    ));
  }
  const challenge = looksChallenged(engine.name, status, html);
  if (challenge) throw new EngineError(challenge, status);
  if (status >= 400) throw new EngineError('http_error', status, `HTTP ${status}`);
  if (!html) throw new EngineError('empty_body', status);
  const parsed = engine.parse!(html);
  if (!parsed.sources.length && !parsed.noResults) {
    throw new EngineError('empty_or_layout_changed', status);
  }
  return parsed;
}

async function searchSingle(
  query: string,
  n: number,
  only?: string,
  budgetMs = TOTAL_BUDGET_MS,
) {
  const started = Date.now();
  const deadline = started + budgetMs;
  const attempts: SearchAttempt[] = [];
  let merged: WebSource[] = [];
  const used: string[] = [];
  let sawNoResults = false;

  const terms = queryTerms(query);
  const subject = subjectTerms(query);
  const intent = classifyIntent(query);

  const pool = only ? ENGINES : configuredEngines();
  for (const engine of breaker.order(pool, only)) {
    if (Date.now() > deadline - 500) break;
    const t0 = Date.now();
    try {
      const parsed = await runEngine(engine, query, deadline);
      breaker.reportOk(engine.name);
      attempts.push({
        engine: engine.name,
        ok: true,
        status: 200,
        ms: Date.now() - t0,
        count: parsed.sources.length,
      });
      if (parsed.noResults) sawNoResults = true;
      if (parsed.sources.length) {
        const kept = parsed.sources.filter((s) => isWorthKeeping(s, terms, intent, subject));
        const verdict = engineRelevanceVerdict(kept, query);
        if (kept.length && verdict.ratio < MIN_ENGINE_RELEVANCE && engine.name !== 'wikipedia') {
          attempts[attempts.length - 1].reason = `off_topic ${verdict.strong}/${verdict.total}`;
          continue;
        }
        if (kept.length) {
          merged = dedupe(merged.concat(rankSources(kept, terms)));
          used.push(engine.name);
        }
      }
      if (merged.length >= Math.min(n, MIN_GOOD_RESULTS)) break;
      if (sawNoResults && !merged.length && engine.name !== 'wikipedia') break;
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

  const sources = merged.slice(0, n);
  const internet_data = sources
    .map((s) => s.description || s.title)
    .join(' ')
    .trim();

  return {
    sources,
    internet_data,
    engines: used,
    engine: used[0] || null,
    attempts,
    no_results: sawNoResults && !sources.length,
    ms: Date.now() - started,
    intent,
  };
}

export function mergeQueries(results: WebSource[][], n: number): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  const maxRanks = results.reduce((m, r) => Math.max(m, r.length), 0);
  outer: for (let rank = 0; rank < maxRanks; rank++) {
    for (const list of results) {
      const s = list[rank];
      if (s) {
        const key = s.url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          if (out.length >= n) break outer;
          out.push(s);
        }
      }
    }
  }
  return out;
}

export async function webSearch(options: WebSearchOptions): Promise<WebSearchResult> {
  const n = Math.max(1, Math.min(MAX_RESULTS, Math.floor(Number(options.n) || DEFAULT_RESULTS)));
  const only = clean(options.engine).toLowerCase().slice(0, 40) || undefined;
  const budgetMs = options.timeoutMs || TOTAL_BUDGET_MS;

  let queries: string[] = [];
  if (Array.isArray(options.queries) && options.queries.length) {
    queries = options.queries
      .map((q) => clean(q).slice(0, MAX_QUERY_CHARS))
      .filter(Boolean)
      .slice(0, MAX_QUERIES);
  }
  if (!queries.length && options.query) {
    const q = clean(options.query).slice(0, MAX_QUERY_CHARS);
    if (q) queries = [q];
  }
  if (!queries.length) {
    throw new Error('webSearch requires a non-empty "query" or "queries" array.');
  }

  const cacheKey = `${n}:${only || ''}:${queries.map((q) => q.toLowerCase()).join('|')}`;
  if (!options.noCache) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, cached: true };
  }

  if (queries.length === 1) {
    const res = await searchSingle(queries[0], n, only, budgetMs);
    const body = { ...res, queries_executed: queries };
    if (body.sources.length || body.no_results) {
      cache.set(cacheKey, body);
    }
    return { ...body, cached: false };
  }

  const started = Date.now();
  const settled = await Promise.allSettled(
    queries.map((q) => searchSingle(q, n, only, budgetMs)),
  );

  const attempts: SearchAttempt[] = [];
  const perQuery: WebSource[][] = [];
  const used: string[] = [];
  let anyNoResults = false;

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'rejected') {
      attempts.push({
        engine: queries[i],
        ok: false,
        status: 0,
        ms: 0,
        count: 0,
        reason: 'query_failed',
      });
      perQuery.push([]);
      continue;
    }
    attempts.push(...s.value.attempts);
    perQuery.push(s.value.sources);
    for (const e of s.value.engines) if (!used.includes(e)) used.push(e);
    if (s.value.no_results) anyNoResults = true;
  }

  const union = [...new Set(queries.flatMap((q) => queryTerms(q)))];
  const sources = rankSources(mergeQueries(perQuery, n * 2), union).slice(0, n);
  const internet_data = sources
    .map((s) => s.description || s.title)
    .join(' ')
    .trim();

  const body = {
    sources,
    internet_data,
    engines: used,
    engine: used[0] || null,
    attempts,
    no_results: anyNoResults && !sources.length && perQuery.every((p) => !p.length),
    ms: Date.now() - started,
    intent: classifyIntent(queries[0]),
    queries_executed: queries,
  };

  if (body.sources.length || body.no_results) {
    cache.set(cacheKey, body);
  }
  return { ...body, cached: false };
}
