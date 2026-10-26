import { type ProxyInput } from '../utils/http.js';
export type SocialPlatform = 'twitter' | 'instagram' | 'reddit' | 'github' | 'tiktok' | 'auto';
export type SocialAction = 'auto' | 'profile' | 'post' | 'search' | 'feed' | 'trending' | 'repo' | 'issue';
export interface SocialIntelOptions {
    /** URL, @handle, r/subreddit, owner/repo, or search query */
    target: string;
    /** Platform override ('twitter' | 'instagram' | 'reddit' | 'github' | 'tiktok' | 'auto') */
    platform?: SocialPlatform;
    /** Action override ('auto' | 'profile' | 'post' | 'search' | 'feed' | 'trending' | 'repo' | 'issue') */
    action?: SocialAction;
    /** Max items/posts/comments to return (default 8) */
    limit?: number;
    /** Sort order for Reddit/GitHub ('hot' | 'new' | 'top' | 'daily' | 'weekly' | 'monthly') */
    sort?: string;
    /** Language filter for GitHub trending */
    language?: string;
    /** Bypass cache */
    noCache?: boolean;
    /** Optional HTTP/HTTPS/SOCKS5 proxy URL or proxy list for rotation */
    proxy?: ProxyInput;
}
export interface TwitterTweet {
    id: string;
    url: string;
    text: string;
    createdAt: string;
    lang?: string;
    author: {
        name: string;
        username: string;
        url: string;
        avatarUrl?: string;
        followers?: number;
        following?: number;
        verified?: boolean;
    };
    stats: {
        views: number | null;
        likes: number;
        retweets: number;
        replies: number;
        bookmarks?: number;
    };
    media: Array<{
        type: 'photo' | 'video' | 'gif' | string;
        url: string;
        thumbnailUrl?: string;
        width?: number;
        height?: number;
        durationSec?: number;
    }>;
    quotedTweet?: {
        id: string;
        authorUsername: string;
        text: string;
        url: string;
    };
    poll?: {
        totalVotes: number;
        choices: Array<{
            label: string;
            count: number;
            percentage: number;
        }>;
    };
}
export interface TwitterProfile {
    username: string;
    name: string;
    url: string;
    bio: string;
    location?: string;
    website?: string;
    joinedAt?: string;
    followers: number;
    following: number;
    tweetsCount: number;
    likesCount?: number;
    mediaCount?: number;
    avatarUrl?: string;
    bannerUrl?: string;
    recentTweets: TwitterTweet[];
}
export interface InstagramPost {
    shortcode: string;
    url: string;
    type: 'post' | 'reel';
    authorUsername: string;
    authorFullName?: string;
    caption: string;
    likesRaw?: string;
    likesCount?: number;
    commentsRaw?: string;
    commentsCount?: number;
    publishedAt?: string;
    imageUrl?: string;
    videoUrl?: string;
}
export interface InstagramProfile {
    username: string;
    fullName: string;
    url: string;
    biography: string;
    followersRaw: string;
    followersCount: number;
    followingRaw: string;
    followingCount: number;
    postsRaw: string;
    postsCount: number;
    avatarUrl?: string;
    recentPosts: InstagramPost[];
}
export interface RedditPostItem {
    id: string;
    title: string;
    author: string;
    subreddit: string;
    url: string;
    externalUrl?: string;
    publishedAt: string;
    bodyText: string;
}
export interface RedditCommentItem {
    author: string;
    publishedAt: string;
    bodyText: string;
    permalink?: string;
}
export interface SocialIntelResult {
    ok: boolean;
    platform: SocialPlatform;
    action: SocialAction;
    target: string;
    data: unknown;
    markdown: string;
    cached: boolean;
    ms: number;
    error?: string;
}
export declare function fetchTwitterTweet(tweetIdOrUrl: string, userHint?: string, proxy?: ProxyInput): Promise<TwitterTweet | null>;
export declare function fetchTwitterProfile(usernameOrUrl: string, limit?: number, proxy?: ProxyInput): Promise<TwitterProfile | null>;
export declare function searchTwitterTweets(query: string, limit?: number, proxy?: ProxyInput): Promise<TwitterTweet[]>;
export declare function fetchInstagramPost(urlOrShortcode: string, proxy?: ProxyInput): Promise<InstagramPost | null>;
export declare function fetchInstagramProfile(usernameOrUrl: string, limit?: number, proxy?: ProxyInput): Promise<InstagramProfile | null>;
export declare function searchInstagramPosts(query: string, limit?: number, proxy?: ProxyInput): Promise<InstagramPost[]>;
export declare function fetchRedditSubreddit(subredditInput: string, sort?: string, limit?: number, proxy?: ProxyInput): Promise<RedditPostItem[]>;
export declare function fetchRedditPostWithComments(postUrl: string, limit?: number, proxy?: ProxyInput): Promise<{
    post: RedditPostItem | null;
    comments: RedditCommentItem[];
}>;
export declare function searchReddit(query: string, limit?: number, proxy?: ProxyInput): Promise<RedditPostItem[]>;
export declare function fetchGithubRepo(repoOrUrl: string, proxy?: ProxyInput): Promise<{
    fullName: any;
    url: any;
    description: any;
    homepage: any;
    stars: number;
    forks: number;
    watchers: number;
    openIssues: number;
    language: any;
    license: any;
    topics: any;
    defaultBranch: any;
    createdAt: any;
    updatedAt: any;
    pushedAt: any;
    latestReleases: {
        tag: any;
        name: any;
        publishedAt: any;
        url: any;
    }[];
    readmeExcerpt: string;
}>;
export declare function fetchGithubIssueOrPr(issueUrlOrPath: string, limit?: number, proxy?: ProxyInput): Promise<{
    repo: string;
    number: number;
    type: string;
    title: any;
    state: any;
    author: any;
    createdAt: any;
    updatedAt: any;
    labels: any;
    url: any;
    body: string;
    commentsCount: number;
    comments: {
        author: any;
        createdAt: any;
        body: string;
    }[];
}>;
export declare function fetchGithubTrending(language?: string, since?: string, limit?: number, proxy?: ProxyInput): Promise<{
    fullName: string;
    url: string;
    description: string;
    language: string;
    stars: number;
    starsInPeriod: string;
    period: string;
}[]>;
export declare function fetchTiktokInfo(url: string, proxy?: ProxyInput): Promise<{
    url: string;
    title: any;
    authorName: any;
    authorUsername: any;
    authorUrl: any;
    thumbnailUrl: any;
    provider: string;
    description?: undefined;
} | {
    url: string;
    title: string;
    description: string;
    authorName: string;
    provider: string;
    authorUsername?: undefined;
    authorUrl?: undefined;
    thumbnailUrl?: undefined;
}>;
export declare function detectSocialPlatformAndAction(target: string, platformHint?: SocialPlatform, actionHint?: SocialAction): {
    platform: SocialPlatform;
    action: SocialAction;
};
export declare function socialIntel(options: SocialIntelOptions): Promise<SocialIntelResult>;
//# sourceMappingURL=social-intel.d.ts.map