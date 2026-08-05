import React from 'react';

/**
 * Converts a Rich-Text Editor HTML string back into clean Markdown.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';

  let md = html;

  // Convert rendered KaTeX math containers back to clean TeX syntax ($$ math $$ / $ math $)
  md = md.replace(/<div[^>]*class="[^"]*corvo-math-display[^"]*"[^>]*data-math="([^"]+)"[^>]*>[\s\S]*?<\/div>/gi, (_match, encodedTeX) => {
    return `\n$$\n${decodeURIComponent(encodedTeX)}\n$$\n`;
  });
  md = md.replace(/<span[^>]*class="[^"]*corvo-math-inline[^"]*"[^>]*data-math="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi, (_match, encodedTeX) => {
    return `$${decodeURIComponent(encodedTeX)}$`;
  });
  // Strip any leftover unencoded KaTeX inner markup tags
  md = md.replace(/<span[^>]*class="[^"]*katex[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');

  // Protect code blocks (```...``` and <pre>/<code> tags) from HTML conversions
  const codeBlocks: string[] = [];
  md = md.replace(/(```[\s\S]*?```|<pre[^>]*>[\s\S]*?<\/pre>|<code[^>]*>[\s\S]*?<\/code>)/gi, (match) => {
    codeBlocks.push(match);
    return `%%CORVOCODEBLOCK${codeBlocks.length - 1}%%`;
  });

  // Normalize Chrome/Safari line-breaking wrappers
  md = md.replace(/<div>/gi, '\n').replace(/<\/div>/gi, '');
  md = md.replace(/<p>/gi, '\n').replace(/<\/p>/gi, '');
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Convert Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n');

  // Convert Bold tags
  md = md.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**');

  // Convert Italic tags
  md = md.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '_$2_');

  // Underline has no markdown equivalent, strip tag but keep text
  md = md.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1');

  // Strikethrough
  md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~');

  // Highlight
  md = md.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==');

  // Convert List tags
  md = md.replace(/<li>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<ul>([\s\S]*?)<\/ul>/gi, '$1');
  md = md.replace(/<ol>([\s\S]*?)<\/ol>/gi, '$1');

  // Convert Links: <a href="url">text</a> -> [text](url)
  md = md.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert Images: <img src="url" alt="alt" /> -> ![alt](url)
  md = md.replace(/<img\s+[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img\s+[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  md = md.replace(/<img\s+[^>]*src="([^"]*)"[^>]*\/?>/gi, '![image]($1)');

  // Strip any remaining unrecognized HTML tags to clean up completely
  md = md.replace(/<[^>]+>/g, '');

  // Unescape HTML entities
  md = md
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

  // Restore protected code blocks
  codeBlocks.forEach((block, index) => {
    md = md.replace(`%%CORVOCODEBLOCK${index}%%`, block);
  });

  // Strip leading spaces from heading lines (a space before # prevents marked from recognising headings)
  md = md.replace(/^[ \t]+(#{1,6} )/gm, '$1');

  // Collapse 3+ consecutive blank lines into 2 (prevents marked's loose-list mode)
  md = md.replace(/(\n{3,})/g, '\n\n');

  // Clean trailing spaces and return
  return md.trim();
}

/**
 * Converts Markdown back to Rich HTML to populate the contentEditable visual editor.
 */
export function markdownToHtml(md: string): string {
  if (!md) return '';

  let html = md;

  // Escape HTML tags to prevent cross-site execution/injection
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert headings (do this before escaping or after? since we escaped < and >, we can safely insert HTML tags now)
  html = html.replace(/^####\s+(.*)/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.*)/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)/gm, '<h1>$1</h1>');

  // Bold: **text**
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

  // Italic: _text_
  html = html.replace(/_([\s\S]*?)_/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  html = html.replace(/~~([\s\S]*?)~~/g, '<s>$1</s>');

  // Highlight: ==text==
  html = html.replace(/==([\s\S]*?)==/g, '<mark>$1</mark>');

  // Convert lists
  html = html.replace(/^\s*-\s+(.*)/gm, '<li>$1</li>');
  html = html.replace(/^\s*\*\s+(.*)/gm, '<li>$1</li>');
  html = html.replace(/^\s*(\d+)\.\s+(.*)/gm, '<li>$2</li>');

  // Convert images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%; height:auto; border-radius: 8px; margin: 4px 0;" />');

  // Convert links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Convert remaining newlines to breaks — but skip newlines that are adjacent to
  // block-level elements (headings, list items) to prevent marked's loose-list wrapping
  html = html.replace(/\n(<\/?(?:h[1-6]|li|ul|ol)[^>]*>)/g, '$1');
  html = html.replace(/(<\/?(?:h[1-6]|li|ul|ol)[^>]*>)\n/g, '$1');
  html = html.replace(/\n/g, '<br>');

  return html;
}

interface ParseRichTextOptions {
  getFileSrc: (path: string | undefined | null) => string;
  onLinkClick?: (url: string) => void;
  openExternal?: (url: string) => void;
}

/**
 * Parses markdown note content into formatted React components.
 * Supports image previews and local/external links.
 */
export function parseRichText(rawText: string, options: ParseRichTextOptions) {
  const { getFileSrc, onLinkClick, openExternal } = options;

  let text = rawText || '';
  // Un-encode and strip legacy corvo-math HTML tags so class strings never leak into text nodes
  text = text.replace(/<div[^>]*class="[^"]*corvo-math-display[^"]*"[^>]*data-math="([^"]+)"[^>]*>[\s\S]*?<\/div>/gi, (_m, encoded) => decodeURIComponent(encoded));
  text = text.replace(/<span[^>]*class="[^"]*corvo-math-inline[^"]*"[^>]*data-math="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi, (_m, encoded) => decodeURIComponent(encoded));
  text = text.replace(/<span[^>]*class="[^"]*corvo-math-inline[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '$1');
  text = text.replace(/<div[^>]*class="[^"]*corvo-math-display[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, '$1');

  const tagRegex = /#([a-zA-Z0-9_-]+)/g;
  const tags: string[] = [];
  let tagMatch;
  while ((tagMatch = tagRegex.exec(text)) !== null) {
    tags.push(tagMatch[1]);
  }

  const lines = text.split('\n');
  const renderedElements: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];
  let isBulletList = false;
  let isNumberedList = false;

  const pushCurrentList = (key: number) => {
    if (currentList.length > 0) {
      if (isBulletList) {
        renderedElements.push(
          <ul key={`bullet-${key}`} className="list-disc pl-2 space-y-1 my-1.5 text-xs text-on-surface-variant leading-relaxed">
            {currentList}
          </ul>
        );
      } else if (isNumberedList) {
        renderedElements.push(
          <ol key={`numbered-${key}`} className="list-decimal pl-5 space-y-1 my-1.5 text-xs text-on-surface-variant leading-relaxed">
            {currentList}
          </ol>
        );
      }
      currentList = [];
      isBulletList = false;
      isNumberedList = false;
    }
  };

  const inlineParse = (str: string) => {
    let parts: { type: 'text' | 'bold' | 'italic' | 'link' | 'image'; content: string; url?: string }[] = [{ type: 'text', content: str }];

    // Parse Images & Links
    parts = parts.flatMap((p): any => {
      if (p.type !== 'text') return p;
      // Matches both ![alt](url) and [label](url)
      const regex = /(!)?\[([^\]]+)\]\(([^)]+)\)/g;
      const result = [];
      let lastIndex = 0;
      let m;
      while ((m = regex.exec(p.content)) !== null) {
        if (m.index > lastIndex) {
          result.push({ type: 'text' as const, content: p.content.substring(lastIndex, m.index) });
        }
        if (m[1]) {
          result.push({ type: 'image' as const, content: m[2], url: m[3] });
        } else {
          result.push({ type: 'link' as const, content: m[2], url: m[3] });
        }
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < p.content.length) {
        result.push({ type: 'text' as const, content: p.content.substring(lastIndex) });
      }
      return result.length > 0 ? result : p;
    });

    // Parse Bold: **bold**
    parts = parts.flatMap((p): any => {
      if (p.type !== 'text') return p;
      const subparts = p.content.split(/\*\*([\s\S]*?)\*\*/g);
      return subparts.map((content, idx) => ({
        type: idx % 2 === 1 ? 'bold' as const : 'text' as const,
        content
      }));
    });

    // Parse Italic: _italic_
    parts = parts.flatMap((p): any => {
      if (p.type !== 'text') return p;
      const subparts = p.content.split(/_([\s\S]*?)_/g);
      return subparts.map((content, idx) => ({
        type: idx % 2 === 1 ? 'italic' as const : 'text' as const,
        content
      }));
    });

    return parts.map((p, idx) => {
      if (p.type === 'bold') return <strong key={idx} className="font-extrabold text-on-surface">{p.content}</strong>;
      if (p.type === 'italic') return <em key={idx} className="italic text-on-surface-variant">{p.content}</em>;
      if (p.type === 'image') {
        const src = getFileSrc(p.url);
        return (
          <img 
            key={idx} 
            src={src} 
            alt={p.content} 
            className="max-w-full h-auto rounded-lg border border-outline-variant/10 my-1.5 object-contain block max-h-60" 
          />
        );
      }
      if (p.type === 'link') {
        const isLocalMaterial = p.url?.startsWith('corvovault-material://');
        
        const handleClick = (e: React.MouseEvent) => {
          e.preventDefault();
          if (isLocalMaterial && onLinkClick && p.url) {
            onLinkClick(p.url);
          } else if (openExternal && p.url) {
            openExternal(p.url);
          } else if (p.url) {
            window.open(p.url, '_blank');
          }
        };

        return (
          <a 
            key={idx} 
            href={p.url || '#'} 
            onClick={handleClick} 
            className="text-primary hover:underline font-semibold inline-flex items-center gap-0.5 break-all cursor-pointer"
          >
            {p.content}
          </a>
        );
      }
      return p.content;
    });
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      pushCurrentList(idx);
      return;
    }

    if (trimmed.split(/\s+/).every(word => word.startsWith('#'))) {
      return;
    }

    if (trimmed.startsWith('# ')) {
      pushCurrentList(idx);
      renderedElements.push(
        <h4 key={idx} className="text-sm font-extrabold text-on-surface mt-2 mb-1.5 tracking-tight font-headline">
          {inlineParse(trimmed.slice(2))}
        </h4>
      );
    } else if (trimmed.startsWith('## ')) {
      pushCurrentList(idx);
      renderedElements.push(
        <h5 key={idx} className="text-xs font-bold text-on-surface mt-2 mb-1 tracking-tight font-headline">
          {inlineParse(trimmed.slice(3))}
        </h5>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!isBulletList) {
        pushCurrentList(idx);
        isBulletList = true;
      }
      currentList.push(
        <li key={idx} className="text-xs text-on-surface-variant leading-relaxed list-none flex items-start gap-1.5 py-0.5">
          <span className="text-primary shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="flex-1 break-words">{inlineParse(trimmed.slice(2))}</span>
        </li>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (!isNumberedList) {
        pushCurrentList(idx);
        isNumberedList = true;
      }
      const match = trimmed.match(/^(\d+)\.\s(.*)/);
      currentList.push(
        <li key={idx} className="text-xs text-on-surface-variant leading-relaxed list-none flex items-start gap-2 py-0.5">
          <span className="text-primary font-bold text-[10px] shrink-0 mt-0.5 w-4">{match ? match[1] : '1'}.</span>
          <span className="flex-1 break-words">{inlineParse(match ? match[2] : trimmed)}</span>
        </li>
      );
    } else {
      pushCurrentList(idx);
      renderedElements.push(
        <p key={idx} className="text-xs text-on-surface-variant leading-relaxed mb-2 break-words">
          {inlineParse(line)}
        </p>
      );
    }
  });

  pushCurrentList(lines.length);

  return { renderedElements, tags };
}

/**
 * Searches the web for relevant images (via Electron IPC web search scraper, with Openverse & Wikimedia fallback).
 */
export async function searchWebImages(query: string): Promise<string[]> {
  if (!query || !query.trim()) return [];
  
  // 1. Try Electron IPC web image scraper if running in Electron environment
  if (typeof window !== 'undefined' && (window as any).electronAPI?.invoke) {
    try {
      const result = await (window as any).electronAPI.invoke('web:searchImages', query);
      if (result && result.success && Array.isArray(result.images) && result.images.length > 0) {
        return result.images
          .map((item: any) => item.url)
          .filter((u: any): u is string => typeof u === 'string' && u.length > 0);
      }
    } catch (ipcErr) {
      console.warn('IPC web image search failed, falling back to browser search:', ipcErr);
    }
  }

  // 2. Browser fallback: Openverse & Wikimedia Commons
  const urls: string[] = [];
  try {
    // Openverse search
    const ovRes = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=20`);
    if (ovRes.ok) {
      const ovData = await ovRes.json();
      if (ovData?.results && Array.isArray(ovData.results)) {
        ovData.results.forEach((item: any) => {
          if (item?.url) urls.push(item.url);
        });
      }
    }
  } catch (err) {
    console.warn('Openverse fallback failed:', err);
  }

  try {
    // Wikimedia Commons search
    const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&prop=imageinfo&iiprop=url&format=json&origin=*`;
    const res = await fetch(wikiUrl);
    const data = await res.json();
    if (data?.query?.pages) {
      const wikiUrls = Object.values(data.query.pages)
        .map((p: any) => p.imageinfo?.[0]?.url)
        .filter((u): u is string => typeof u === 'string' && (u.endsWith('.jpg') || u.endsWith('.jpeg') || u.endsWith('.png') || u.endsWith('.gif') || u.endsWith('.webp') || u.includes('upload.wikimedia.org')));
      urls.push(...wikiUrls);
    }
  } catch (err) {
    console.warn('Wikimedia fallback failed:', err);
  }

  // Remove duplicates
  return Array.from(new Set(urls));
}
