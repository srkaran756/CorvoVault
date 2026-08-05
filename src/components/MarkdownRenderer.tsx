import React, { useEffect, useRef, useState } from 'react';
import { htmlToMarkdown } from '../lib/editorUtils';
import { marked as namedMarked } from 'marked';
import * as markedNamespace from 'marked';
import mermaid from 'mermaid';
import * as mermaidNamespace from 'mermaid';
import katex from 'katex';
import * as katexNamespace from 'katex';

// Robust helper to resolve the 'marked' parser across different bundler environments
const getMarked = () => {
  if (namedMarked && typeof namedMarked.parse === 'function') {
    return namedMarked;
  }
  const ns = markedNamespace as any;
  if (ns.marked && typeof ns.marked.parse === 'function') {
    return ns.marked;
  }
  if (ns.default && typeof ns.default.parse === 'function') {
    return ns.default;
  }
  if (typeof ns.parse === 'function') {
    return ns;
  }
  return null;
};

// Robust helper to resolve 'mermaid' across different bundler environments
const getMermaid = () => {
  if (mermaid && typeof mermaid.initialize === 'function') {
    return mermaid;
  }
  const ns = mermaidNamespace as any;
  if (ns.default && typeof ns.default.initialize === 'function') {
    return ns.default;
  }
  if (typeof ns.initialize === 'function') {
    return ns;
  }
  return null;
};

// Robust helper to resolve 'katex' across different bundler environments
const getKatex = () => {
  if (katex && typeof katex.renderToString === 'function') {
    return katex;
  }
  const ns = katexNamespace as any;
  if (ns.default && typeof ns.default.renderToString === 'function') {
    return ns.default;
  }
  if (typeof ns.renderToString === 'function') {
    return ns;
  }
  return null;
};

// Render TeX code into KaTeX HTML output
export const renderKaTeXBlock = (code: string, displayMode: boolean): string => {
  const activeKatex = getKatex();
  const trimmed = (code || '').trim();
  if (!trimmed) return '';
  
  if (!activeKatex) {
    const safe = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return displayMode 
      ? `<pre class="text-xs font-mono p-3 bg-surface-container-low border border-outline-variant/10 rounded-lg overflow-x-auto my-2 text-on-surface">${safe}</pre>`
      : `<code class="font-mono text-xs px-1.5 py-0.5 bg-surface-container-low rounded border border-outline-variant/10 text-on-surface">${safe}</code>`;
  }

  try {
    const renderedHtml = activeKatex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: false,
    });

    const encodedTeX = encodeURIComponent(trimmed);
    if (displayMode) {
      return `<div class="corvo-math-display my-4 p-4 rounded-xl border border-outline-variant/15 flex flex-col items-center justify-center overflow-x-auto select-text relative group shadow-xs transition-all" data-math="${encodedTeX}">
        <button type="button" class="copy-math-btn opacity-0 group-hover:opacity-100 absolute top-2.5 right-2.5 px-2.5 py-1 rounded-md bg-surface-container-high border border-outline-variant/20 text-outline hover:text-primary text-[10px] font-bold transition-all cursor-pointer shadow-xs flex items-center gap-1.5 z-10" data-math="${encodedTeX}" title="Copy LaTeX code">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          Copy TeX
        </button>
        <div class="katex-math-wrapper py-1 w-full flex justify-center overflow-x-auto">${renderedHtml}</div>
      </div>`;
    } else {
      return `<span class="corvo-math-inline inline-block align-baseline select-text font-sans text-on-surface" data-math="${encodedTeX}">${renderedHtml}</span>`;
    }
  } catch (err) {
    console.error('KaTeX render error:', err);
    const safe = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<span class="text-red-500 font-mono text-xs p-1 bg-red-500/10 rounded border border-red-500/20 inline-block">Math Error: ${safe}</span>`;
  }
};

// Helper to detect if current theme is dark based on computed --bg CSS variable
const isDarkTheme = (): boolean => {
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (!bg) return false;
    
    if (bg.startsWith('#')) {
      let hex = bg.slice(1);
      if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
      }
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const yiq = (r * 299 + g * 587 + b * 114) / 1000;
      return yiq < 128;
    }
    
    if (bg.includes('rgb')) {
      const match = bg.match(/\d+/g);
      if (match && match.length >= 3) {
        const r = parseInt(match[0], 10);
        const g = parseInt(match[1], 10);
        const b = parseInt(match[2], 10);
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq < 128;
      }
    }
  } catch (e) {
    console.error('Failed to parse theme background:', e);
  }
  return false;
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// ── One-time marked setup ──────────────────────────────────────────────────
let markedSetupDone = false;
function ensureMarkedSetup() {
  if (markedSetupDone) return;
  const activeMarked = getMarked();
  if (!activeMarked) return;

  const renderer = new activeMarked.Renderer();

  // Custom code block renderer: handles mermaid diagrams, math codeblocks + styled code blocks
  renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
    const code = text || '';
    const language = (lang || '').trim().toLowerCase();

    if (language === 'math' || language === 'latex' || language === 'katex') {
      return renderKaTeXBlock(code, true);
    }

    const safeCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    if (language === 'mermaid') {
      const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2, 9);
      return `<div class="mermaid-diagram-raw mermaid mb-6 p-4 bg-surface-container rounded-xl flex justify-center overflow-x-auto border border-outline-variant/10 shadow-xs transition-all" data-uuid="${uuid}" style="min-height: 50px;">${safeCode}</div>`;
    }

    return `<pre class="bg-surface-container-high/65 p-3 rounded-lg border border-outline-variant/10 text-xs font-mono my-2.5 overflow-x-auto text-on-surface select-text"><code class="language-${lang || 'text'}">${safeCode}</code></pre>`;
  };

  activeMarked.use({ renderer });
  markedSetupDone = true;
}

// Pre-process markdown to isolate TeX math before marked parses markdown elements
function processMarkdownWithMath(markdown: string, parseMarked: (md: string) => string | Promise<string>): string | Promise<string> {
  if (!markdown) return '';

  const mathEntries: { placeholder: string; code: string; displayMode: boolean }[] = [];
  let counter = 0;
  let text = markdown;

  // 1. Protect display math $$ ... $$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, code) => {
    const placeholder = `%%CORVOMATHBLOCK${counter++}%%`;
    mathEntries.push({ placeholder, code, displayMode: true });
    return placeholder;
  });

  // 2. Protect display math \[ ... \]
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_match, code) => {
    const placeholder = `%%CORVOMATHBLOCK${counter++}%%`;
    mathEntries.push({ placeholder, code, displayMode: true });
    return placeholder;
  });

  // 3. Protect inline math \( ... \)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_match, code) => {
    const placeholder = `%%CORVOMATHINLINE${counter++}%%`;
    mathEntries.push({ placeholder, code, displayMode: false });
    return placeholder;
  });

  // 4. Protect inline math $ ... $ (ignoring prices in plain text sentences like "$50 to $100")
  text = text.replace(/(?<!\\)\$([^\$\n]+?)(?<!\\)\$/g, (match, code) => {
    // Skip if looks like prices in sentence: "$50 ... $100" (contains words with spaces and no TeX commands/symbols)
    if (/^[a-zA-Z0-9\s,.]+$/.test(code) && /\s[a-zA-Z]{2,}\s/.test(code) && !/[=\+\-\*\/\^\_<>\\~]/.test(code)) {
      return match;
    }
    const placeholder = `%%CORVOMATHINLINE${counter++}%%`;
    mathEntries.push({ placeholder, code, displayMode: false });
    return placeholder;
  });

  const substituteMathPlaceholders = (compiledHtml: string): string => {
    let result = compiledHtml;
    for (const entry of mathEntries) {
      const renderedHtml = renderKaTeXBlock(entry.code, entry.displayMode);
      if (entry.displayMode) {
        const pPattern = new RegExp(`<p>\\s*${entry.placeholder}\\s*</p>`, 'g');
        if (pPattern.test(result)) {
          result = result.replace(pPattern, renderedHtml);
        } else {
          result = result.replace(entry.placeholder, renderedHtml);
        }
      } else {
        result = result.replace(entry.placeholder, renderedHtml);
      }
    }
    return result;
  };

  const compiled = parseMarked(text);
  if (compiled instanceof Promise) {
    return compiled.then(substituteMathPlaceholders);
  }
  return substituteMathPlaceholders(compiled);
}

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1. Compile Markdown/HTML when content changes
  useEffect(() => {
    try {
      const activeMarked = getMarked();
      if (!activeMarked) {
        throw new Error('Markdown parser (marked) could not be resolved from imports.');
      }

      ensureMarkedSetup();

      const options = {
        gfm: true,
        breaks: true,
      };

      let markdown = content || '';

      // Un-encode any previously saved corvo-math HTML containers back to raw TeX ($...$ / $$...$$)
      markdown = markdown.replace(/<div[^>]*class="[^"]*corvo-math-display[^"]*"[^>]*data-math="([^"]+)"[^>]*>[\s\S]*?<\/div>/gi, (_match, encodedTeX) => {
        return `\n$$\n${decodeURIComponent(encodedTeX)}\n$$\n`;
      });
      markdown = markdown.replace(/<span[^>]*class="[^"]*corvo-math-inline[^"]*"[^>]*data-math="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi, (_match, encodedTeX) => {
        return `$${decodeURIComponent(encodedTeX)}$`;
      });
      // Strip any stray un-encoded corvo-math-inline or corvo-math-display wrapper tags
      markdown = markdown.replace(/<span[^>]*class="[^"]*corvo-math-inline[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '$1');
      markdown = markdown.replace(/<div[^>]*class="[^"]*corvo-math-display[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, '$1');
      // Clean up any legacy leaked placeholder text from prior saves
      markdown = markdown.replace(/<strong[^>]*>CORVO_MATH_(INLINE|BLOCK)_\d+<\/strong>/gi, '');
      markdown = markdown.replace(/\bCORVO_MATH_(INLINE|BLOCK)_\d+\b/gi, '');

      // Only convert HTML tags to Markdown if content contains rich-text editor wrapper tags
      if (/<(p|br|li|h[1-6]|ul|ol|strong|b|em|i|u|s|mark)|<div(?!\s+class="[^"]*corvo-math)/i.test(markdown)) {
        markdown = htmlToMarkdown(markdown);
      }

      // Pre-process markdown links to URL-encode spaces in target URLs
      markdown = markdown.replace(/(!)?\[([^\]]+)\]\(([^)]+)\)/g, (match, isImg, label, url) => {
        const encodedUrl = url.trim().replace(/ /g, '%20');
        return `${isImg || ''}[${label}](${encodedUrl})`;
      });

      const compiled = processMarkdownWithMath(markdown, (md) => activeMarked.parse(md, options));
      if (compiled instanceof Promise) {
        compiled.then(res => {
          setHtml(res);
          setErrorMsg(null);
        }).catch(err => {
          throw err;
        });
      } else {
        setHtml(compiled);
        setErrorMsg(null);
      }
    } catch (err: any) {
      console.error('Failed to parse markdown:', err);
      setErrorMsg(err.message || String(err));
    }
  }, [content]);

  const dark = isDarkTheme();

  // Initialize Mermaid only when the theme background changes
  useEffect(() => {
    const activeMermaid = getMermaid();
    if (activeMermaid) {
      try {
        activeMermaid.initialize({
          startOnLoad: false,
          theme: dark ? 'dark' : 'default',
          securityLevel: 'loose',
          suppressError: true,
          errorRendering: 'none',
          themeVariables: {
            background: dark ? '#1e1e2e' : '#ffffff',
            primaryColor: '#4f46e5',
          }
        });
      } catch (e) {
        console.warn('Mermaid initialization warning:', e);
      }
    }
  }, [dark]);

  // Copy TeX button click handler
  useEffect(() => {
    if (!containerRef.current || !html) return;

    const handleCopyBtnClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const copyBtn = target.closest('.copy-math-btn') as HTMLButtonElement | null;
      if (!copyBtn) return;

      const encodedTeX = copyBtn.getAttribute('data-math');
      if (encodedTeX) {
        const decodedTeX = decodeURIComponent(encodedTeX);
        navigator.clipboard.writeText(decodedTeX);
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = `✓ Copied!`;
        copyBtn.classList.add('text-success');
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
          copyBtn.classList.remove('text-success');
        }, 1800);
      }
    };

    const container = containerRef.current;
    container.addEventListener('click', handleCopyBtnClick);
    return () => {
      container.removeEventListener('click', handleCopyBtnClick);
    };
  }, [html]);

  // 2. Render Mermaid diagrams safely inside the compiled HTML
  useEffect(() => {
    if (!containerRef.current || !html) return;

    const activeMermaid = getMermaid();
    if (!activeMermaid) return;

    const rawBlocks = containerRef.current.querySelectorAll('.mermaid-diagram-raw');
    if (rawBlocks.length === 0) return;

    let isMounted = true;

    const cleanupStrayErrors = () => {
      try {
        document.querySelectorAll('[id^="dmermaid"], .error-icon').forEach(el => {
          if (el.parentNode && el !== containerRef.current && !containerRef.current?.contains(el)) {
            el.remove();
          }
        });
      } catch (e) {}
    };

    const timer = setTimeout(async () => {
      for (let i = 0; i < rawBlocks.length; i++) {
        if (!isMounted) break;
        const block = rawBlocks[i] as HTMLElement;
        let code = block.textContent || '';
        if (!code.trim()) continue;

        const uuid = block.getAttribute('data-uuid') || `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const id = `mermaid-svg-${uuid}`;
        
        block.classList.remove('mermaid-diagram-raw');

        try {
          let isValid = await activeMermaid.parse(code, { suppressErrors: true }).catch(() => false);
          
          if (!isValid) {
            const fixedCode = code.replace(/^(\s*subgraph\s+)([^"\n\r\[\]]+)$/gm, (match, prefix, title) => {
              const trimmed = title.trim();
              if (!trimmed || trimmed.startsWith('"') || trimmed.includes('[')) return match;
              return `${prefix}"${trimmed}"`;
            });
            if (fixedCode !== code) {
              const isFixedValid = await activeMermaid.parse(fixedCode, { suppressErrors: true }).catch(() => false);
              if (isFixedValid) {
                code = fixedCode;
                isValid = true;
              }
            }
          }

          if (!isValid) {
            if (isMounted) {
              const safeCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
              block.innerHTML = `
                <div class="text-outline/70 text-[11px] font-mono bg-surface-container-low p-3 rounded-lg border border-outline-variant/15 whitespace-pre-wrap select-text w-full">
                  <div class="text-[9px] font-extrabold uppercase text-amber-500 mb-1 tracking-wider">⚡ Diagram syntax in progress</div>
                  <code>${safeCode}</code>
                </div>
              `;
            }
            continue;
          }

          const { svg } = await activeMermaid.render(id, code);
          if (isMounted) {
            block.innerHTML = svg;
          }
        } catch (err: any) {
          cleanupStrayErrors();
          if (isMounted) {
            const safeCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            block.innerHTML = `
              <div class="text-outline/70 text-[11px] font-mono bg-surface-container-low p-3 rounded-lg border border-outline-variant/15 whitespace-pre-wrap select-text w-full">
                <div class="text-[9px] font-extrabold uppercase text-amber-500 mb-1 tracking-wider">⚡ Diagram syntax in progress</div>
                <code>${safeCode}</code>
              </div>
            `;
          }
        }
      }
      cleanupStrayErrors();
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [html]);

  if (errorMsg) {
    return (
      <div className="p-4 bg-red-500/15 border border-red-500/30 rounded-xl text-red-500 text-xs font-mono">
        <strong>Markdown Parsing Error:</strong><br/>
        {errorMsg}
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      className={`markdown-body select-text text-sm text-on-surface leading-relaxed font-sans space-y-4 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
