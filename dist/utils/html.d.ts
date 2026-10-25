export declare function decodeEntities(s: string): string;
/** Read one attribute's value off an HTML opening-tag string. */
export declare function attr(openTag: string, name: string): string;
/** Does this opening tag carry `className` as one of its space-separated classes? */
export declare function hasClass(openTag: string, className: string): boolean;
/** Strip tags/scripts/styles from an HTML fragment and return its visible text. */
export declare function textOnly(html: string): string;
/** Index just past the `</tag>` that balances the tag opened right before `from`. */
export declare function findMatchingClose(html: string, tag: string, from: number): number;
/**
 * Every top-level fragment of `<tag ...>...</tag>` inside `html`,
 * optionally requiring `className` on the opening tag.
 */
export declare function extractTagBlocks(html: string, tag: string, className?: string): string[];
/**
 * The first `<tag ...>...</tag>` fragment inside `html` (optionally requiring a class).
 */
export declare function firstTag(html: string, tag: string, className?: string): {
    openTag: string;
    inner: string;
} | null;
export declare function firstText(html: string, tag: string, className?: string): string;
export declare function ownClassIncludes(fragment: string, className: string): boolean;
export interface PageMetadata {
    title: string;
    description: string;
    author: string;
    publishedTime: string;
    siteName: string;
    canonicalUrl: string;
    language: string;
}
export declare function extractPageMetadata(html: string, fallbackUrl?: string): PageMetadata;
export declare function detectJsRequirement(status: number, html: string): {
    needsJs: boolean;
    reason?: string;
};
export interface HtmlToMarkdownOptions {
    baseUrl?: string;
    includeLinks?: boolean;
    includeImages?: boolean;
    maxChars?: number;
    onlyMainContent?: boolean;
}
export declare function htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions): {
    markdown: string;
    links: Array<{
        text: string;
        url: string;
    }>;
    images: Array<{
        alt: string;
        url: string;
    }>;
};
//# sourceMappingURL=html.d.ts.map