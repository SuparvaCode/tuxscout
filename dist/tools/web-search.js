// src/tools/web-search.ts
// Multi-engine resilient Web Search with 4-layer relevance scoring,
// intent classification, landing-page rejection, engine-level hijack detection,
// per-engine circuit breaker, cookie jar, and concurrent multi-angle query merging.
import { API_UA, BROWSER_HEADERS, CircuitBreaker, clean, clearCookieJar, DEFAULT_UA, EngineError, fetchTextWithJar, hasCookies, isHttpUrl, LruCache, } from '../utils/http.js';
import { attr, decodeEntities, extractTagBlocks, firstTag, firstText, ownClassIncludes, textOnly, } from '../utils/html.js';
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
const cache = new LruCache(300, 10 * 60_000);
// ── Stopwords & Intent Classification ───────────────────────────────────────
const STOPWORDS = new Set(('a an the and or but if then than that this these those is are was were be been being am ' +
    'i me my mine you your yours he she it we they them his her its our their of to in on at for with from by as ' +
    'so not no do does did doing have has had having will would can could should about into over under again more ' +
    'most some such only own same too very just also what which who whom when where why how all any both each few ' +
    'other please thanks thank hello hi hey').split(/\s+/));
const GENERIC_QUERY_TERMS = new Set(('latest newest news today tonight yesterday recent recently current currently now upcoming soon breaking live trending ' +
    'update updates updated week month year daily weekly headlines headline roundup').split(/\s+/));
export function stripSearchOperators(query) {
    return String(query || '')
        .replace(/\b(?:site|filetype|ext):[^\s]+/gi, ' ')
        .replace(/-\b(?:site|filetype|ext):[^\s]+/gi, ' ')
        .replace(/\b(?:intitle|inurl):("([^"]+)"|([^\s]+))/gi, ' $2 $3 ')
        .replace(/(?:^|\s)-[a-zA-Z0-9_.-]+/g, ' ')
        .replace(/\b(?:AND|OR|NOT)\b/g, ' ')
        .replace(/["()]/g, ' ');
}
export function isPdfUrl(u) {
    try {
        const parsed = new URL(u);
        const path = parsed.pathname.toLowerCase();
        return (path.endsWith('.pdf') ||
            /\/pdf\//i.test(path) ||
            parsed.searchParams.get('format')?.toLowerCase() === 'pdf' ||
            parsed.searchParams.get('type')?.toLowerCase() === 'pdf');
    }
    catch {
        return /\.pdf($|[?#])/i.test(u);
    }
}
export function detectFileType(u) {
    if (isPdfUrl(u))
        return 'pdf';
    try {
        const m = new URL(u).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
        if (m && ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'json', 'xml', 'txt', 'md', 'epub'].includes(m[1])) {
            return m[1];
        }
    }
    catch { /* ignore */ }
    return undefined;
}
export function buildAdvancedQuery(baseQuery, options) {
    let q = clean(baseQuery);
    if (!options)
        return q;
    const parts = [q];
    if (options.exactPhrase) {
        const phrase = clean(options.exactPhrase).replace(/"/g, '');
        if (phrase && !q.toLowerCase().includes(`"${phrase.toLowerCase()}"`)) {
            parts.push(`"${phrase}"`);
        }
    }
    if (options.intitle) {
        const t = clean(options.intitle);
        if (t && !/\bintitle:/i.test(q)) {
            parts.push(t.includes(' ') ? `intitle:"${t}"` : `intitle:${t}`);
        }
    }
    if (options.inurl) {
        const u = clean(options.inurl);
        if (u && !/\binurl:/i.test(q)) {
            parts.push(`inurl:${u}`);
        }
    }
    if (options.site) {
        const sites = (Array.isArray(options.site) ? options.site : [options.site])
            .map((s) => clean(s).replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
            .filter(Boolean);
        if (sites.length && !/\bsite:/i.test(q)) {
            parts.push(sites.length === 1
                ? `site:${sites[0]}`
                : `(${sites.map((s) => `site:${s}`).join(' OR ')})`);
        }
    }
    if (options.excludeSite) {
        const exSites = (Array.isArray(options.excludeSite) ? options.excludeSite : [options.excludeSite])
            .map((s) => clean(s).replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
            .filter(Boolean);
        for (const s of exSites) {
            parts.push(`-site:${s}`);
        }
    }
    const wantedFiletype = options.pdfOnly
        ? 'pdf'
        : options.searchType === 'pdf'
            ? 'pdf'
            : options.filetype
                ? clean(options.filetype).replace(/^\./, '').toLowerCase()
                : '';
    if (wantedFiletype && !/\b(?:filetype|ext):/i.test(q)) {
        parts.push(`filetype:${wantedFiletype}`);
    }
    if (options.searchType === 'imdb' && !options.site && !/\bsite:imdb\.com/i.test(q)) {
        parts.push('site:imdb.com');
    }
    else if (options.searchType === 'code' && !options.site && !/\bsite:/i.test(q)) {
        parts.push('(site:github.com OR site:stackoverflow.com OR site:gitlab.com)');
    }
    else if (options.searchType === 'docs' && !options.intitle && !options.inurl) {
        parts.push('(inurl:docs OR intitle:documentation)');
    }
    if (options.excludeTerms) {
        const exTerms = Array.isArray(options.excludeTerms)
            ? options.excludeTerms
            : [options.excludeTerms];
        for (const ex of exTerms) {
            const term = clean(ex).replace(/^-+/, '');
            if (term)
                parts.push(term.includes(' ') ? `-"${term}"` : `-${term}`);
        }
    }
    return parts.filter(Boolean).join(' ').slice(0, MAX_QUERY_CHARS);
}
export function queryTerms(query) {
    return stripSearchOperators(query)
        .toLowerCase()
        .replace(/[^a-z0-9\s+]/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}
export function subjectTerms(query) {
    return queryTerms(query).filter((t) => !GENERIC_QUERY_TERMS.has(t));
}
const NEWS_INTENT_RE = /\b(news|latest|recent|release|releases|released|launch|launched|announce|announced|announcement|update|updates|updated|changelog|release notes|version|versions|breaking|deprecat\w*|this week|this month|today|yesterday|20\d\d|patch|patched|fix|fixed|bug|just out|out now)\b/i;
const NAVIGATIONAL_RE = /^[\w\s-]{0,40}(pricing|plans|login|sign in|sign up|download|install|docs|documentation|official|website|homepage|contact|support|faq|status|legal|terms|privacy|careers|jobs|about|blog|github)\b/i;
export function classifyIntent(query) {
    if (NEWS_INTENT_RE.test(query))
        return 'news';
    if (NAVIGATIONAL_RE.test(String(query).trim()))
        return 'navigational';
    return 'evergreen';
}
export function looksLikeLandingPage(url) {
    if (isPdfUrl(url))
        return false;
    try {
        const u = new URL(url);
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.length === 0)
            return true;
        if (segs.length > 2)
            return false;
        const path_ = segs.join('/').toLowerCase();
        if (/\b(blog|news|release|releases|changelog|update|updates|post|posts|article|articles|docs?|guides?|announcement|wiki|title|name|pdf|abs)\b/.test(path_)) {
            return false;
        }
        const last = segs[segs.length - 1].toLowerCase();
        if (/\d{4}/.test(last))
            return false;
        if (/\d/.test(last))
            return false;
        if (segs.length >= 2)
            return false;
        return true;
    }
    catch {
        return false;
    }
}
const NAV_CHROME_RE = new RegExp('^(?:https?://(?:[a-z0-9-]+\\.)*(?:google\\.[a-z.]{2,}|bing\\.com|duckduckgo\\.com|search\\.yahoo\\.com|baidu\\.com|yandex\\.[a-z.]{2,}|ecosia\\.org|search\\.brave\\.com)/(?:search|webhp|imghp|images|video)(?:/|\\?|$))' +
    '|(?:[?&](?:q|p|query|wd)=)', 'i');
const AD_URL_RE = /\/aclick\?|\/cbclk|duckduckgo\.com\/y\.js|[?&]ad_domain=|[?&]ad_provider=/i;
function isSearchEngineRoot(url) {
    try {
        const u = new URL(url);
        return /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave)\.[a-z.]+$/.test(u.hostname);
    }
    catch {
        return false;
    }
}
export function relevance(source, terms) {
    if (!terms.length)
        return 1;
    const title = source.title.toLowerCase();
    const desc = (source.description || '').toLowerCase();
    const url = source.url.toLowerCase();
    let score = 0;
    for (const t of terms) {
        if (title.includes(t))
            score += 2;
        else if (desc.includes(t) || url.includes(t))
            score += 1;
    }
    return score / (terms.length * 2);
}
export function isWorthKeeping(source, terms, intent, subject) {
    if (NAV_CHROME_RE.test(source.url) ||
        /^(google|bing|duckduckgo|yahoo|brave)\s+search$/i.test(source.title.trim())) {
        return false;
    }
    const subjectTermsList = subject && subject.length ? subject : terms;
    if (relevance(source, subjectTermsList) <= 0) {
        if (intent === 'navigational' && isSearchEngineRoot(source.url))
            return true;
        return false;
    }
    if (intent === 'news' && looksLikeLandingPage(source.url))
        return false;
    return true;
}
export function engineRelevanceVerdict(sources, query) {
    const subject = subjectTerms(query);
    const total = sources.length;
    if (!total)
        return { total: 0, strong: 0, ratio: 0 };
    if (!subject.length)
        return { total, strong: total, ratio: 1 };
    let strong = 0;
    const need = Math.min(2, subject.length);
    for (const s of sources) {
        const text = `${s.title} ${s.description || ''} ${s.url}`.toLowerCase();
        let n = 0;
        for (const t of subject)
            if (text.includes(t))
                n += 1;
        if (n >= need)
            strong += 1;
    }
    return { total, strong, ratio: strong / total };
}
export function rankSources(sources, terms, preferPdf = false) {
    return sources
        .map((s, i) => {
        let r = relevance(s, terms);
        if (preferPdf && (s.isPdf || isPdfUrl(s.url)))
            r += 0.5;
        return { s, i, r };
    })
        .sort((a, b) => b.r - a.r || a.i - b.i)
        .map((x) => x.s);
}
function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const s of list) {
        const key = s.url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}
// ── URL Unwrapping ──────────────────────────────────────────────────────────
function unwrapYahoo(href) {
    const marker = href.indexOf('/RU=');
    if (marker === -1)
        return href;
    const encoded = href.slice(marker + 4).split('/')[0];
    try {
        const decoded = decodeURIComponent(encoded);
        return isHttpUrl(decoded) ? decoded : href;
    }
    catch {
        return href;
    }
}
function unwrapBing(href) {
    try {
        const parsed = new URL(href, 'https://www.bing.com');
        if (!/(^|\.)bing\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith('/ck/'))
            return parsed.href;
        const u = parsed.searchParams.get('u') || '';
        if (!u.startsWith('a1'))
            return parsed.href;
        let b64 = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4)
            b64 += '=';
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        return isHttpUrl(decoded) ? decoded : parsed.href;
    }
    catch {
        return href;
    }
}
function unwrapDuckDuckGo(href) {
    let raw = String(href || '').trim();
    if (raw.startsWith('//'))
        raw = `https:${raw}`;
    try {
        const parsed = new URL(raw, 'https://duckduckgo.com');
        const uddg = parsed.searchParams.get('uddg');
        return uddg ? decodeURIComponent(uddg) : parsed.href;
    }
    catch {
        return raw;
    }
}
function accept(out, title, url, description, engine, extraMeta) {
    if (!title || !isHttpUrl(url) || AD_URL_RE.test(url))
        return;
    const pdf = extraMeta?.isPdf ?? isPdfUrl(url);
    const fileType = extraMeta?.fileType ?? detectFileType(url);
    out.push({
        title: title.slice(0, 300),
        url,
        description: description.slice(0, 600),
        engine,
        ...(pdf ? { isPdf: true } : {}),
        ...(fileType ? { fileType } : {}),
        ...extraMeta,
    });
}
// ── Engine Parsers ──────────────────────────────────────────────────────────
function parseYahoo(html) {
    const out = [];
    const wrappers = extractTagBlocks(html, 'ol', 'searchCenterMiddle');
    const scope = wrappers.length ? wrappers.join('') : html;
    let nodes = extractTagBlocks(scope, 'div', 'algo');
    if (!nodes.length)
        nodes = extractTagBlocks(html, 'div', 'algo');
    for (const node of nodes) {
        const link = firstTag(node, 'h3')?.inner ?? node;
        const a = firstTag(link, 'a') ?? firstTag(node, 'a');
        if (!a)
            continue;
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
function parseBing(html) {
    const out = [];
    for (const node of extractTagBlocks(html, 'li', 'b_algo')) {
        const heading = firstTag(node, 'h2')?.inner;
        const a = (heading ? firstTag(heading, 'a') : null) ?? firstTag(node, 'a');
        if (!a)
            continue;
        const url = unwrapBing(attr(a.openTag, 'href'));
        const title = clean(textOnly(a.inner));
        const captionScope = firstTag(node, 'div', 'b_caption')?.inner ?? '';
        const caption = firstText(captionScope, 'p') || firstText(node, 'p') || firstText(node, 'p', 'b_lineclamp2');
        accept(out, title, url, clean(caption), 'bing');
    }
    const text = textOnly(html).toLowerCase();
    return { sources: out, noResults: !out.length && /there are no results for/.test(text) };
}
function parseDuckDuckGoHtml(html) {
    const out = [];
    for (const node of extractTagBlocks(html, 'div', 'result')) {
        if (ownClassIncludes(node, 'result--ad'))
            continue;
        const a = firstTag(node, 'a', 'result__a');
        if (!a)
            continue;
        const url = unwrapDuckDuckGo(attr(a.openTag, 'href'));
        accept(out, clean(textOnly(a.inner)), url, clean(firstText(node, 'a', 'result__snippet') || firstText(node, 'div', 'result__snippet')), 'duckduckgo');
    }
    const text = textOnly(html).toLowerCase();
    return {
        sources: out,
        noResults: !out.length && /no results\.|no more results/.test(text),
    };
}
function parseDuckDuckGoLite(html) {
    const out = [];
    let last = null;
    for (const row of extractTagBlocks(html, 'tr')) {
        if (ownClassIncludes(row, 'result-sponsored')) {
            last = null;
            continue;
        }
        const link = firstTag(row, 'a', 'result-link');
        if (link) {
            const before = out.length;
            accept(out, clean(textOnly(link.inner)), unwrapDuckDuckGo(attr(link.openTag, 'href')), '', 'duckduckgo-lite');
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
function parseBrave(html) {
    const out = [];
    const blocks = extractTagBlocks(html, 'div', 'snippet');
    for (const block of blocks) {
        const a = firstTag(block, 'a');
        if (!a)
            continue;
        const url = attr(a.openTag, 'href');
        if (!isHttpUrl(url) || url.includes('brave.com'))
            continue;
        const title = firstText(block, 'div', 'title') ||
            firstText(block, 'span', 'snippet-title') ||
            clean(textOnly(a.inner));
        const desc = firstText(block, 'div', 'snippet-description') ||
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
async function runWikipedia(query, deadline, proxy) {
    const cleanQ = clean(stripSearchOperators(query)) || query;
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQ)}&utf8=&format=json&srlimit=10`;
    const { status, text } = await fetchTextWithJar('wikipedia', url, deadline, {
        'User-Agent': API_UA,
        Accept: 'application/json',
    }, proxy);
    if (status >= 400)
        throw new EngineError('http_error', status, `HTTP ${status}`);
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        throw new EngineError('bad_json', status);
    }
    const items = Array.isArray(data?.query?.search) ? data.query.search : [];
    const out = [];
    for (const item of items) {
        const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`;
        accept(out, clean(item.title), pageUrl, textOnly(item.snippet || ''), 'wikipedia');
    }
    return { sources: out, noResults: items.length === 0 };
}
async function runImdbSearch(query, deadline, proxy) {
    const cleanQ = clean(stripSearchOperators(query).replace(/\bimdb\b/gi, '')) || clean(query);
    const alnum = cleanQ.toLowerCase().replace(/[^a-z0-9]/g, '');
    const firstChar = alnum[0] || 'x';
    const slug = cleanQ.toLowerCase().replace(/\s+/g, '_').slice(0, 60);
    const url = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(slug)}.json`;
    const { status, text } = await fetchTextWithJar('imdb', url, deadline, {
        'User-Agent': DEFAULT_UA,
        Accept: 'application/json',
        Referer: 'https://www.imdb.com/',
    }, proxy);
    if (status >= 400)
        throw new EngineError('http_error', status, `HTTP ${status}`);
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        throw new EngineError('bad_json', status);
    }
    const items = Array.isArray(data?.d) ? data.d : [];
    const out = [];
    for (const item of items) {
        if (!item.id || !item.l)
            continue;
        const isTitle = item.id.startsWith('tt');
        const isName = item.id.startsWith('nm');
        const itemUrl = isTitle
            ? `https://www.imdb.com/title/${item.id}/`
            : isName
                ? `https://www.imdb.com/name/${item.id}/`
                : `https://www.imdb.com/find/?q=${encodeURIComponent(item.l)}`;
        const yearStr = item.y ? ` (${item.y})` : item.yr ? ` (${item.yr})` : '';
        const typeLabel = item.q || item.qid || (isName ? 'Person' : 'Title');
        const title = `${clean(item.l)}${yearStr} [${typeLabel}] — IMDb`;
        const descParts = [
            `IMDb ID: ${item.id}`,
            typeLabel ? `Type: ${typeLabel}` : '',
            item.y ? `Release Year: ${item.y}` : item.yr ? `Years: ${item.yr}` : '',
            item.s ? `Stars / Known For: ${item.s}` : '',
            item.rank ? `IMDb Popularity Rank: #${item.rank}` : '',
        ].filter(Boolean);
        accept(out, title, itemUrl, descParts.join(' · '), 'imdb', {
            year: item.y,
            extra: {
                imdbId: item.id,
                type: typeLabel,
                stars: item.s,
                rank: item.rank,
                poster: item.i?.imageUrl,
            },
        });
    }
    return { sources: out, noResults: items.length === 0 };
}
async function runArxivSearch(query, deadline, proxy) {
    const cleanQ = clean(stripSearchOperators(query)) || clean(query);
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(cleanQ)}&start=0&max_results=12`;
    const { status, text } = await fetchTextWithJar('arxiv', url, deadline, {
        'User-Agent': API_UA,
        Accept: 'application/atom+xml,text/xml,*/*',
    }, proxy);
    if (status >= 400)
        throw new EngineError('http_error', status, `HTTP ${status}`);
    const entries = text.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
    const out = [];
    for (const entry of entries) {
        const rawId = clean(entry.match(/<id>([\s\S]*?)<\/id>/i)?.[1] || '');
        const title = clean(decodeEntities(entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ''));
        const summary = clean(decodeEntities(entry.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || ''));
        const published = clean(entry.match(/<published>([\s\S]*?)<\/published>/i)?.[1] || '').slice(0, 10);
        const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/gi)].map((m) => clean(m[1])).slice(0, 4);
        if (!rawId || !title)
            continue;
        const arxivId = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').replace(/v\d+$/, '');
        const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
        const yearNum = published ? Number(published.slice(0, 4)) : undefined;
        const desc = `${published ? `[${published}] ` : ''}${authors.length ? `Authors: ${authors.join(', ')}. ` : ''}${summary}`;
        accept(out, `[PDF] ${title}`, pdfUrl, desc, 'arxiv', {
            isPdf: true,
            fileType: 'pdf',
            year: Number.isFinite(yearNum) ? yearNum : undefined,
            extra: { arxivId, absUrl: rawId, authors },
        });
    }
    return { sources: out, noResults: entries.length === 0 };
}
async function runOpenAlexSearch(query, deadline, proxy) {
    const cleanQ = clean(stripSearchOperators(query)) || clean(query);
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(cleanQ)}&per-page=12`;
    const { status, text } = await fetchTextWithJar('openalex', url, deadline, {
        'User-Agent': API_UA,
        Accept: 'application/json',
    }, proxy);
    if (status >= 400)
        throw new EngineError('http_error', status, `HTTP ${status}`);
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        throw new EngineError('bad_json', status);
    }
    const results = Array.isArray(data?.results) ? data.results : [];
    const out = [];
    for (const w of results) {
        const title = clean(w.title || w.display_name || '');
        const pdfUrl = w.best_oa_location?.pdf_url ||
            w.primary_location?.pdf_url ||
            (typeof w.open_access?.oa_url === 'string' && isPdfUrl(w.open_access.oa_url) ? w.open_access.oa_url : '');
        const landingUrl = pdfUrl || w.open_access?.oa_url || w.primary_location?.landing_page_url || w.doi || w.id;
        if (!title || !landingUrl || !isHttpUrl(landingUrl))
            continue;
        const year = Number(w.publication_year) || undefined;
        const citedBy = Number(w.cited_by_count) || 0;
        const venue = clean(w.primary_location?.source?.display_name || '');
        const authors = Array.isArray(w.authorships)
            ? w.authorships.map((a) => clean(a?.author?.display_name)).filter(Boolean).slice(0, 4)
            : [];
        const desc = [
            year ? `Year: ${year}` : '',
            venue ? `Venue: ${venue}` : '',
            authors.length ? `Authors: ${authors.join(', ')}` : '',
            citedBy ? `Citations: ${citedBy}` : '',
            pdfUrl ? `Direct PDF available` : '',
        ]
            .filter(Boolean)
            .join(' · ');
        const isPdf = Boolean(pdfUrl) || isPdfUrl(landingUrl);
        accept(out, isPdf ? `[PDF] ${title}` : title, landingUrl, desc, 'openalex', {
            isPdf,
            fileType: isPdf ? 'pdf' : undefined,
            year,
        });
    }
    return { sources: out, noResults: results.length === 0 };
}
function looksChallenged(engine, status, html) {
    if (status === 429)
        return 'rate_limited';
    if (status === 403 || status === 999)
        return 'blocked';
    if (engine === 'yahoo' && status >= 500 && !html)
        return 'rate_limited';
    const lower = html.slice(0, 200_000).toLowerCase();
    if (engine.startsWith('duckduckgo') &&
        (lower.includes('anomaly-modal') || lower.includes('bots use duckduckgo too')))
        return 'challenge';
    if (engine === 'bing' &&
        (lower.includes('id="b_captcha"') ||
            lower.includes('/challenge/verify') ||
            lower.includes('captcha-container')))
        return 'challenge';
    if (lower.includes('verify you are human') ||
        lower.includes('unusual traffic from your computer') ||
        lower.includes('pow-captcha'))
        return 'challenge';
    return null;
}
function ddgTimeParam(tr) {
    if (tr === 'day')
        return '&df=d';
    if (tr === 'week')
        return '&df=w';
    if (tr === 'month')
        return '&df=m';
    if (tr === 'year')
        return '&df=y';
    return '';
}
function braveTimeParam(tr) {
    if (tr === 'day')
        return '&tf=pd';
    if (tr === 'week')
        return '&tf=pw';
    if (tr === 'month')
        return '&tf=pm';
    if (tr === 'year')
        return '&tf=py';
    return '';
}
function yahooTimeParam(tr) {
    if (tr === 'day')
        return '&btf=d';
    if (tr === 'week')
        return '&btf=w';
    if (tr === 'month')
        return '&btf=m';
    if (tr === 'year')
        return '&btf=y';
    return '';
}
const ENGINES = [
    {
        name: 'duckduckgo',
        jar: 'ddg',
        url: (q, opts) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}${ddgTimeParam(opts?.timeRange)}${opts?.region ? `&kl=${encodeURIComponent(opts.region)}` : ''}`,
        parse: parseDuckDuckGoHtml,
    },
    {
        name: 'duckduckgo-lite',
        jar: 'ddg',
        url: (q, opts) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}${ddgTimeParam(opts?.timeRange)}`,
        parse: parseDuckDuckGoLite,
    },
    {
        name: 'brave',
        jar: 'brave',
        url: (q, opts) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web${braveTimeParam(opts?.timeRange)}`,
        parse: parseBrave,
    },
    {
        name: 'yahoo',
        jar: 'yahoo',
        url: (q, opts) => `https://in.search.yahoo.com/search?p=${encodeURIComponent(q)}&n=20${yahooTimeParam(opts?.timeRange)}`,
        parse: parseYahoo,
    },
    {
        name: 'bing',
        jar: 'bing',
        url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`,
        parse: parseBing,
    },
    {
        name: 'imdb',
        jar: 'imdb',
        url: () => '',
        customRun: runImdbSearch,
    },
    {
        name: 'arxiv',
        jar: 'arxiv',
        url: () => '',
        customRun: runArxivSearch,
    },
    {
        name: 'openalex',
        jar: 'openalex',
        url: () => '',
        customRun: runOpenAlexSearch,
    },
    {
        name: 'wikipedia',
        jar: 'wikipedia',
        url: () => '',
        customRun: runWikipedia,
    },
];
function configuredEngines(options) {
    const searchType = options?.searchType;
    const isPdfSearch = Boolean(options?.pdfOnly || options?.filetype?.toLowerCase() === 'pdf' || searchType === 'pdf');
    if (searchType === 'imdb') {
        return ENGINES.filter((e) => ['imdb', 'duckduckgo', 'brave', 'yahoo'].includes(e.name));
    }
    if (searchType === 'academic') {
        return ENGINES.filter((e) => ['arxiv', 'openalex', 'duckduckgo', 'brave', 'yahoo'].includes(e.name));
    }
    if (isPdfSearch) {
        return ENGINES.filter((e) => ['duckduckgo', 'brave', 'yahoo', 'arxiv', 'openalex', 'duckduckgo-lite'].includes(e.name));
    }
    const raw = (process.env.WEB_ENGINE_ORDER || '').toLowerCase();
    if (!raw) {
        // By default matches Delphos: duckduckgo -> duckduckgo-lite -> brave -> yahoo -> wikipedia
        return ENGINES.filter((e) => !['bing', 'imdb', 'arxiv', 'openalex'].includes(e.name));
    }
    const wanted = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const picked = wanted
        .map((name) => ENGINES.find((e) => e.name === name))
        .filter((e) => !!e);
    return picked.length ? [...new Set(picked)] : ENGINES;
}
async function runEngine(engine, query, deadline, options) {
    const engineDeadline = Math.min(deadline, Date.now() + ENGINE_TIMEOUT_MS);
    const proxy = options?.proxy;
    if (engine.customRun) {
        return engine.customRun(query, engineDeadline, proxy);
    }
    const compiledQuery = buildAdvancedQuery(query, options);
    const targetUrl = engine.url(compiledQuery, options);
    let { status, text: html } = await fetchTextWithJar(engine.jar, targetUrl, engineDeadline, BROWSER_HEADERS, proxy);
    // Stale Yahoo YBV cookie retry
    if (status >= 500 &&
        !html &&
        hasCookies(engine.jar) &&
        engineDeadline - Date.now() > 1_000) {
        clearCookieJar(engine.jar);
        ({ status, text: html } = await fetchTextWithJar(engine.jar, targetUrl, engineDeadline, BROWSER_HEADERS, proxy));
    }
    const challenge = looksChallenged(engine.name, status, html);
    if (challenge)
        throw new EngineError(challenge, status);
    if (status >= 400)
        throw new EngineError('http_error', status, `HTTP ${status}`);
    if (!html)
        throw new EngineError('empty_body', status);
    const parsed = engine.parse(html);
    if (!parsed.sources.length && !parsed.noResults) {
        throw new EngineError('empty_or_layout_changed', status);
    }
    return parsed;
}
const API_VERTICAL_ENGINES = new Set(['wikipedia', 'imdb', 'arxiv', 'openalex']);
async function searchSingle(query, n, only, budgetMs = TOTAL_BUDGET_MS, options) {
    const started = Date.now();
    const deadline = started + budgetMs;
    const attempts = [];
    let merged = [];
    const used = [];
    let sawNoResults = false;
    const terms = queryTerms(query);
    const subject = subjectTerms(query);
    const intent = classifyIntent(query);
    const preferPdf = Boolean(options?.pdfOnly ||
        options?.filetype?.toLowerCase() === 'pdf' ||
        options?.searchType === 'pdf' ||
        /\bfiletype:pdf\b/i.test(query));
    const pool = only ? ENGINES : configuredEngines(options);
    for (const engine of breaker.order(pool, only)) {
        if (Date.now() > deadline - 500)
            break;
        const t0 = Date.now();
        try {
            const parsed = await runEngine(engine, query, deadline, options);
            breaker.reportOk(engine.name);
            attempts.push({
                engine: engine.name,
                ok: true,
                status: 200,
                ms: Date.now() - t0,
                count: parsed.sources.length,
            });
            if (parsed.noResults)
                sawNoResults = true;
            if (parsed.sources.length) {
                let kept = API_VERTICAL_ENGINES.has(engine.name)
                    ? parsed.sources
                    : parsed.sources.filter((s) => isWorthKeeping(s, terms, intent, subject));
                if (options?.pdfOnly) {
                    const pdfs = kept.filter((s) => s.isPdf || isPdfUrl(s.url));
                    if (pdfs.length > 0)
                        kept = pdfs;
                }
                const verdict = engineRelevanceVerdict(kept, query);
                if (kept.length && verdict.ratio < MIN_ENGINE_RELEVANCE && !API_VERTICAL_ENGINES.has(engine.name)) {
                    attempts[attempts.length - 1].reason = `off_topic ${verdict.strong}/${verdict.total}`;
                    continue;
                }
                if (kept.length) {
                    merged = dedupe(merged.concat(rankSources(kept, terms, preferPdf)));
                    used.push(engine.name);
                }
            }
            if (merged.length >= Math.min(n, MIN_GOOD_RESULTS))
                break;
            if (sawNoResults && !merged.length && !API_VERTICAL_ENGINES.has(engine.name))
                break;
        }
        catch (err) {
            const e = err;
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
export function mergeQueries(results, n) {
    const seen = new Set();
    const out = [];
    const maxRanks = results.reduce((m, r) => Math.max(m, r.length), 0);
    outer: for (let rank = 0; rank < maxRanks; rank++) {
        for (const list of results) {
            const s = list[rank];
            if (s) {
                const key = s.url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    if (out.length >= n)
                        break outer;
                    out.push(s);
                }
            }
        }
    }
    return out;
}
export async function webSearch(options) {
    const n = Math.max(1, Math.min(MAX_RESULTS, Math.floor(Number(options.n) || DEFAULT_RESULTS)));
    const only = clean(options.engine).toLowerCase().slice(0, 40) || undefined;
    const budgetMs = options.timeoutMs || TOTAL_BUDGET_MS;
    let queries = [];
    if (Array.isArray(options.queries) && options.queries.length) {
        queries = options.queries
            .map((q) => clean(q).slice(0, MAX_QUERY_CHARS))
            .filter(Boolean)
            .slice(0, MAX_QUERIES);
    }
    if (!queries.length && options.query) {
        const q = clean(options.query).slice(0, MAX_QUERY_CHARS);
        if (q)
            queries = [q];
    }
    if (!queries.length) {
        throw new Error('webSearch requires a non-empty "query" or "queries" array.');
    }
    const filterKey = JSON.stringify({
        searchType: options.searchType,
        site: options.site,
        excludeSite: options.excludeSite,
        filetype: options.filetype,
        pdfOnly: options.pdfOnly,
        intitle: options.intitle,
        inurl: options.inurl,
        exactPhrase: options.exactPhrase,
        excludeTerms: options.excludeTerms,
        timeRange: options.timeRange,
        region: options.region,
    });
    const cacheKey = `${n}:${only || ''}:${filterKey}:${queries.map((q) => q.toLowerCase()).join('|')}`;
    if (!options.noCache) {
        const hit = cache.get(cacheKey);
        if (hit)
            return { ...hit, cached: true };
    }
    const compiledQueries = queries.map((q) => buildAdvancedQuery(q, options));
    if (queries.length === 1) {
        const res = await searchSingle(queries[0], n, only, budgetMs, options);
        const body = {
            ...res,
            queries_executed: compiledQueries,
            ...(options.searchType
                ? { search_type: options.searchType, searchType: options.searchType }
                : {}),
        };
        if (body.sources.length || body.no_results) {
            cache.set(cacheKey, body);
        }
        return { ...body, cached: false };
    }
    const started = Date.now();
    const settled = await Promise.allSettled(queries.map((q) => searchSingle(q, n, only, budgetMs, options)));
    const attempts = [];
    const perQuery = [];
    const used = [];
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
        for (const e of s.value.engines)
            if (!used.includes(e))
                used.push(e);
        if (s.value.no_results)
            anyNoResults = true;
    }
    const preferPdf = Boolean(options.pdfOnly || options.filetype?.toLowerCase() === 'pdf' || options.searchType === 'pdf');
    const union = [...new Set(queries.flatMap((q) => queryTerms(q)))];
    const sources = rankSources(mergeQueries(perQuery, n * 2), union, preferPdf).slice(0, n);
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
        queries_executed: compiledQueries,
        ...(options.searchType
            ? { search_type: options.searchType, searchType: options.searchType }
            : {}),
    };
    if (body.sources.length || body.no_results) {
        cache.set(cacheKey, body);
    }
    return { ...body, cached: false };
}
/**
 * Dedicated IMDb search helper (movies, TV series, actors, directors).
 */
export async function searchImdb(query, nOrOptions = {}, proxy) {
    const opts = typeof nOrOptions === 'number' ? { n: nOrOptions, proxy } : { ...nOrOptions, ...(proxy ? { proxy } : {}) };
    return webSearch({
        ...opts,
        query,
        searchType: 'imdb',
    });
}
/**
 * Dedicated PDF search helper across web search engines + ArXiv + OpenAlex.
 */
export async function searchPdf(query, nOrOptions = {}, proxy) {
    const opts = typeof nOrOptions === 'number' ? { n: nOrOptions, proxy } : { ...nOrOptions, ...(proxy ? { proxy } : {}) };
    return webSearch({
        ...opts,
        query,
        searchType: 'pdf',
        pdfOnly: true,
        filetype: 'pdf',
    });
}
//# sourceMappingURL=web-search.js.map