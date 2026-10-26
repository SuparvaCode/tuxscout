// src/tools/news-intel.ts
// Multi-Source Live News & Tech Intelligence Aggregator for AI Agents.
// Combines Google News RSS, Hacker News Algolia API (frontpage, search & comment trees),
// Reddit News subreddits, and direct Tech/Security/World RSS feeds (TechCrunch, ArsTechnica,
// The Verge, Lobsters, BleepingComputer, BBC World) with deduplication and time filtering.

import { BROWSER_HEADERS, clean, LruCache } from '../utils/http.js';
import { decodeEntities, textOnly } from '../utils/html.js';
import { fetchRedditSubreddit } from './social-intel.js';

export type NewsCategory =
  | 'top'
  | 'world'
  | 'tech'
  | 'ai'
  | 'security'
  | 'science'
  | 'business'
  | 'crypto'
  | 'linux'
  | 'opensource'
  | 'hn';

export type NewsTimeframe = '1h' | '24h' | '7d' | '30d' | 'any';
export type NewsRecency = NewsTimeframe;

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
  points?: number;
  commentsCount?: number;
  discussionUrl?: string;
  author?: string;
}

export interface NewsIntelOptions {
  /** Custom search topic or HackerNews item ID */
  query?: string;
  /** Predefined category ('top' | 'world' | 'tech' | 'ai' | 'security' | 'science' | 'business' | 'crypto' | 'linux' | 'opensource' | 'hn') */
  category?: NewsCategory;
  /** Timeframe filter for search ('1h' | '24h' | '7d' | '30d' | 'any', default '24h') */
  when?: NewsTimeframe;
  /** Max headlines to return (default 15) */
  limit?: number;
  /** Specific Hacker News story ID to inspect with comments */
  hnItemId?: string | number;
  /** Bypass cache */
  noCache?: boolean;
}

export interface NewsIntelResult {
  ok: boolean;
  category: NewsCategory;
  query?: string;
  when: NewsTimeframe;
  total: number;
  items: NewsItem[];
  hnDiscussion?: {
    id: number;
    title: string;
    url?: string;
    points: number;
    author: string;
    createdAt: string;
    text?: string;
    comments: Array<{
      id: number;
      author: string;
      createdAt: string;
      text: string;
      repliesCount: number;
    }>;
  };
  markdown: string;
  cached: boolean;
  ms: number;
}

const cache = new LruCache<Omit<NewsIntelResult, 'cached'>>(150, 5 * 60_000);

const CURATED_RSS_FEEDS: Record<string, Array<{ name: string; url: string }>> = {
  world: [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    {
      name: 'Google News World',
      url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en',
    },
  ],
  tech: [
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Lobsters', url: 'https://lobste.rs/rss' },
  ],
  ai: [
    {
      name: 'Google News AI',
      url: 'https://news.google.com/rss/search?q=%22artificial+intelligence%22+OR+LLM+OR+OpenAI+OR+DeepMind+OR+Anthropic+when:1d&hl=en-US&gl=US&ceid=US:en',
    },
    {
      name: 'MIT Tech Review AI',
      url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
    },
  ],
  security: [
    { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews' },
    { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
  ],
  linux: [
    { name: 'Phoronix', url: 'https://www.phoronix.com/rss.php' },
    { name: 'OMG! Ubuntu', url: 'https://www.omgubuntu.co.uk/feed' },
    { name: 'LWN.net', url: 'https://lwn.net/headlines/rss' },
  ],
  science: [
    { name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/all.xml' },
    {
      name: 'Google News Science',
      url: 'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en',
    },
  ],
  business: [
    {
      name: 'Google News Business',
      url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en',
    },
  ],
  crypto: [
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    {
      name: 'Google News Crypto',
      url: 'https://news.google.com/rss/search?q=bitcoin+OR+ethereum+OR+cryptocurrency+when:1d&hl=en-US&gl=US&ceid=US:en',
    },
  ],
  opensource: [
    { name: 'Lobsters', url: 'https://lobste.rs/rss' },
    {
      name: 'Google News Open Source',
      url: 'https://news.google.com/rss/search?q=%22open+source%22+OR+github+release+when:7d&hl=en-US&gl=US&ceid=US:en',
    },
  ],
};

function parseXmlFeed(xml: string, fallbackSource: string): NewsItem[] {
  const out: NewsItem[] = [];

  // RSS 2.0 <item>
  const rssItems = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  for (const item of rssItems) {
    const rawTitle = decodeEntities(
      clean(
        item
          .match(/<title>([\s\S]*?)<\/title>/i)?.[1]
          ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '',
      ),
    );
    const link = clean(
      item
        .match(/<link>([\s\S]*?)<\/link>/i)?.[1]
        ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '',
    );
    const pubDate = clean(
      item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ||
        item.match(/<dc:date>([\s\S]*?)<\/dc:date>/i)?.[1] ||
        '',
    );
    const sourceTag = decodeEntities(
      clean(item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || ''),
    );
    const descRaw = item
      .match(/<description>([\s\S]*?)<\/description>/i)?.[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    const summary = descRaw ? textOnly(decodeEntities(descRaw)).slice(0, 280) : undefined;

    // Google News titles often end with " - Source Name"
    let title = rawTitle;
    let source = sourceTag || fallbackSource;
    if (sourceTag && title.endsWith(` - ${sourceTag}`)) {
      title = title.slice(0, -` - ${sourceTag}`.length).trim();
    }

    if (title && link) {
      out.push({
        title,
        url: link,
        source,
        publishedAt: pubDate,
        summary: summary && summary !== title ? summary : undefined,
      });
    }
  }

  // Atom <entry>
  if (!out.length) {
    const atomEntries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(
      (m) => m[1],
    );
    for (const entry of atomEntries) {
      const title = decodeEntities(
        clean(
          entry
            .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
            ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '',
        ),
      );
      const link = clean(
        entry.match(/<link[^>]+href="([^"]+)"/i)?.[1] ||
          entry.match(/<id>([\s\S]*?)<\/id>/i)?.[1] ||
          '',
      );
      const pubDate = clean(
        entry.match(/<published>([\s\S]*?)<\/published>/i)?.[1] ||
          entry.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1] ||
          '',
      );
      const summaryRaw =
        entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ||
        entry.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ||
        '';
      const summary = summaryRaw ? textOnly(summaryRaw).slice(0, 280) : undefined;
      if (title && link) {
        out.push({
          title,
          url: link,
          source: fallbackSource,
          publishedAt: pubDate,
          summary,
        });
      }
    }
  }

  return out;
}

async function fetchRssSource(name: string, url: string, limit = 10): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(6_500),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseXmlFeed(xml, name).slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchGoogleNewsSearch(
  query: string,
  when: NewsTimeframe = '24h',
  limit = 12,
): Promise<NewsItem[]> {
  const whenSuffix = when && when !== 'any' ? ` when:${when}` : '';
  const q = encodeURIComponent(`${query.trim()}${whenSuffix}`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  return fetchRssSource('Google News', url, limit);
}

export async function fetchHackerNews(
  query?: string,
  limit = 12,
): Promise<NewsItem[]> {
  try {
    const endpoint = query
      ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${Math.min(30, limit)}`
      : `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${Math.min(30, limit)}`;
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': 'TuxScout/1.1' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.hits || []).slice(0, limit).map((h: any) => ({
      title: String(h.title || ''),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: 'Hacker News',
      publishedAt: String(h.created_at || ''),
      points: Number(h.points || 0),
      commentsCount: Number(h.num_comments || 0),
      discussionUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author,
    }));
  } catch {
    return [];
  }
}

export async function fetchHackerNewsItem(itemId: string | number, maxComments = 15) {
  const id = String(itemId).replace(/\D/g, '');
  if (!id) throw new Error(`Invalid HackerNews item ID: ${itemId}`);
  const res = await fetch(`https://hn.algolia.com/api/v1/items/${id}`, {
    headers: { 'User-Agent': 'TuxScout/1.1' },
    signal: AbortSignal.timeout(7_000),
  });
  if (!res.ok) throw new Error(`HackerNews item ${id} HTTP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = Array.isArray(d.children) ? d.children : [];

  return {
    id: Number(d.id || id),
    title: String(d.title || `HN Item #${id}`),
    url: d.url || `https://news.ycombinator.com/item?id=${id}`,
    points: Number(d.points || 0),
    author: String(d.author || ''),
    createdAt: String(d.created_at || ''),
    text: d.text ? textOnly(d.text) : undefined,
    comments: children
      .filter((c) => c.text && c.author)
      .slice(0, maxComments)
      .map((c) => ({
        id: Number(c.id),
        author: String(c.author),
        createdAt: String(c.created_at || ''),
        text: textOnly(c.text).slice(0, 1200),
        repliesCount: Array.isArray(c.children) ? c.children.length : 0,
      })),
  };
}

export async function newsIntel(options: NewsIntelOptions = {}): Promise<NewsIntelResult> {
  const started = Date.now();
  const limit = Math.max(1, Math.min(40, Number(options.limit || 15)));
  const when: NewsTimeframe = options.when || '24h';
  const query = options.query ? clean(options.query) : undefined;
  const category: NewsCategory = options.category || (query ? 'top' : 'tech');

  // Check if user passed a HackerNews item URL or ID
  const hnIdMatch =
    options.hnItemId ||
    (query && /news\.ycombinator\.com\/item\?id=(\d+)/i.exec(query)?.[1]);

  if (hnIdMatch) {
    const disc = await fetchHackerNewsItem(hnIdMatch, limit);
    const lines = [
      `# Hacker News Story: ${disc.title}`,
      `- **URL:** ${disc.url}`,
      `- **Discussion:** https://news.ycombinator.com/item?id=${disc.id}`,
      `- **Stats:** ⬆️ ${disc.points} points by @${disc.author} (${disc.createdAt})`,
    ];
    if (disc.text) lines.push('', disc.text);
    lines.push('', `## Top Comments (${disc.comments.length})`, '');
    disc.comments.forEach((c, i) => {
      lines.push(
        `### ${i + 1}. @${c.author} (${c.createdAt}) [${c.repliesCount} replies]`,
        c.text,
        '',
      );
    });
    return {
      ok: true,
      category: 'hn',
      query: String(hnIdMatch),
      when,
      total: disc.comments.length,
      items: [],
      hnDiscussion: disc,
      markdown: lines.join('\n'),
      cached: false,
      ms: Date.now() - started,
    };
  }

  const cacheKey = `news:${category}:${query || ''}:${when}:${limit}`;
  if (!options.noCache) {
    const hit = cache.get(cacheKey);
    if (hit) {
      return { ...hit, cached: true, ms: Date.now() - started };
    }
  }

  const tasks: Array<Promise<NewsItem[]>> = [];

  if (query) {
    tasks.push(fetchGoogleNewsSearch(query, when, limit));
    tasks.push(fetchHackerNews(query, Math.ceil(limit / 2)));
  } else if (category === 'hn') {
    tasks.push(fetchHackerNews(undefined, limit));
  } else if (category === 'top') {
    tasks.push(fetchHackerNews(undefined, Math.ceil(limit / 2)));
    tasks.push(
      fetchRssSource(
        'Google News Top',
        'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
        Math.ceil(limit / 2),
      ),
    );
    tasks.push(fetchRssSource('TechCrunch', 'https://techcrunch.com/feed/', 5));
  } else {
    const feeds = CURATED_RSS_FEEDS[category] || CURATED_RSS_FEEDS.tech;
    for (const f of feeds) {
      tasks.push(fetchRssSource(f.name, f.url, Math.ceil(limit / feeds.length) + 3));
    }
    if (category === 'tech' || category === 'ai' || category === 'opensource') {
      tasks.push(fetchHackerNews(category === 'ai' ? 'LLM OR AI' : undefined, 6));
    }
    if (category === 'linux') {
      tasks.push(
        fetchRedditSubreddit('linux', 'hot', 5)
          .then((posts) =>
            posts.map((p) => ({
              title: p.title,
              url: p.externalUrl || p.url,
              source: 'r/linux',
              publishedAt: p.publishedAt,
              discussionUrl: p.url,
              author: p.author,
            })),
          )
          .catch(() => []),
      );
    }
  }

  const batches = await Promise.all(tasks);
  const seenTitles = new Set<string>();
  const merged: NewsItem[] = [];

  // Interleave round-robin across sources for balanced diversity
  const maxLen = Math.max(0, ...batches.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const batch of batches) {
      const item = batch[i];
      if (!item) continue;
      const normKey = item.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .slice(0, 65);
      if (!normKey || seenTitles.has(normKey)) continue;
      seenTitles.add(normKey);
      merged.push(item);
      if (merged.length >= limit) break;
    }
    if (merged.length >= limit) break;
  }

  const headerTitle = query
    ? `Live News Search: "${query}" (window=${when})`
    : `Live News Digest: ${category.toUpperCase()}`;
  const mdLines = [`# ${headerTitle} (${merged.length} stories)\n`];

  merged.forEach((item, idx) => {
    const statsBadge =
      item.points !== undefined
        ? ` | ⬆️ ${item.points} pts, 💬 ${item.commentsCount || 0} comments`
        : '';
    mdLines.push(
      `${idx + 1}. **[${item.source}] ${item.title}**`,
      `   - URL: ${item.url}${item.discussionUrl && item.discussionUrl !== item.url ? ` ([Discussion](${item.discussionUrl}))` : ''}`,
      `   - Published: ${item.publishedAt || 'Recent'}${statsBadge}`,
    );
    if (item.summary) {
      mdLines.push(`   - Summary: ${item.summary}`);
    }
    mdLines.push('');
  });

  const result: Omit<NewsIntelResult, 'cached'> = {
    ok: merged.length > 0,
    category,
    query,
    when,
    total: merged.length,
    items: merged,
    markdown: mdLines.join('\n'),
    ms: Date.now() - started,
  };
  if (result.ok) {
    cache.set(cacheKey, result);
  }
  return { ...result, cached: false };
}
