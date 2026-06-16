

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, ChevronDown, ChevronRight, Palette, SquareArrowUpRight, Plus, Trash2, Upload, Wand2, RefreshCw, Copy, Sparkles, Image as ImageIcon, LayoutTemplate, Sliders } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ipcService } from '../services/ipcService';
import { applyThemeToDom, DEFAULT_THEME, blendColors } from '../lib/theme';
import { generateAutoTheme, hsl, ThemeStyle } from '../lib/themeGenerator';

// ─── CSS Selector Util ────────────────────────────────────────
function generateSelector(el: Element): string {
  if (el.tagName.toLowerCase() === 'html') return 'html';
  if (el.id) return `#${el.id}`;
  let str = el.tagName.toLowerCase();
  const parent = el.parentNode as Element;
  if (!parent || parent.nodeType !== 1) return str;
  let childIndex = 1;
  let sibling = el.previousElementSibling;
  while (sibling) { childIndex++; sibling = sibling.previousElementSibling; }
  str += `:nth-child(${childIndex})`;
  return `${generateSelector(parent)} > ${str}`;
}

const toCSSString = (styles: Record<string, string>) =>
  Object.entries(styles)
    .filter(([_, v]) => v && v.trim() !== '')
    .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${v} !important;`)
    .join('\n    ');

const parseShadow = (s: string) => {
  if (!s || s === 'none') return { x: 0, y: 0, blur: 0, spread: 0, color: 'rgba(0,0,0,0.1)' };
  const parts = s.split(' ').filter(Boolean);
  return { x: parseInt(parts[0]) || 0, y: parseInt(parts[1]) || 0, blur: parseInt(parts[2]) || 0, spread: parseInt(parts[3]) || 0, color: parts.slice(4).join(' ') || 'rgba(0,0,0,0.1)' };
};
const assembleShadow = (s: any) => `${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}`;

const parseTransform = (t: string) => {
  if (!t) return { x: 0, y: 0, z: 0 };
  const match = t.match(/translate3d\(([^p]+)px,\s*([^p]+)px,\s*([^p]+)px\)/);
  if (match) return { x: parseFloat(match[1]), y: parseFloat(match[2]), z: parseFloat(match[3]) };
  return { x: 0, y: 0, z: 0 };
};
const assembleTransform = (t: any) => `translate3d(${t.x}px, ${t.y}px, ${t.z}px)`;

// ─── Pre-built Palettes ───────────────────────────────────────
const PREBUILT_PALETTES: { name: string; emoji: string; hue: number; style: ThemeStyle; preview: string[] }[] = [
  {
    name: 'Mango',
    emoji: '🥭',
    hue: 38,
    style: 'warm',
    preview: [hsl(38, 75, 42), hsl(38, 30, 97), hsl(218, 70, 48)],
  },
  {
    name: 'Lichi',
    emoji: '🍈',
    hue: 355,
    style: 'light',
    preview: [hsl(355, 70, 40), hsl(355, 20, 97), hsl(175, 75, 50)],
  },
  {
    name: 'Blackberry',
    emoji: '🫐',
    hue: 270,
    style: 'dark',
    preview: [hsl(270, 80, 65), hsl(270, 20, 8), hsl(90, 80, 60)],
  },
  {
    name: 'Coffee',
    emoji: '☕',
    hue: 25,
    style: 'dark',
    preview: [hsl(25, 75, 42), hsl(25, 20, 8), hsl(205, 70, 60)],
  },
  {
    name: 'Orange',
    emoji: '🍊',
    hue: 22,
    style: 'bold',
    preview: [hsl(22, 90, 58), hsl(22, 15, 6), hsl(202, 90, 58)],
  },
  {
    name: 'Banana',
    emoji: '🍌',
    hue: 52,
    style: 'warm',
    preview: [hsl(52, 75, 42), hsl(52, 30, 97), hsl(232, 70, 48)],
  },
  {
    name: 'Crow',
    emoji: '🐦‍⬛',
    hue: 270,
    style: 'crow',
    preview: ['#4F46E5', '#0F1115', '#FCD34D'],
  },
  {
    name: 'Night',
    emoji: '🌌',
    hue: 230,
    style: 'night',
    preview: ['#2A4494', '#0F1115', '#FCD34D'],
  },
];

// ─── Main Component ───────────────────────────────────────────
export default function DesignPlayground({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [panelOpen, setPanelOpen] = useState(false);
  const [theme, setTheme] = useState<Record<string, string>>(DEFAULT_THEME);
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  const [activeTab, setActiveTab] = useState<'global' | 'palettes' | 'auto'>('palettes');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [hoverTarget, setHoverTarget] = useState<Element | null>(null);
  const [editTarget, setEditTarget] = useState<{ element: Element; selector: string } | null>(null);
  const [targetStyles, setTargetStyles] = useState<Record<string, string>>({});

  const styleTagRef = useRef<HTMLStyleElement | null>(null);

  // Custom Events
  useEffect(() => {
    const onToggle = () => setPanelOpen(p => !p);
    const onClose = () => setPanelOpen(false);
    window.addEventListener('toggle-theme-lab', onToggle);
    window.addEventListener('close-theme-lab', onClose);
    return () => {
      window.removeEventListener('toggle-theme-lab', onToggle);
      window.removeEventListener('close-theme-lab', onClose);
    };
  }, []);

  // Initialize from SQLite (theme and overrides)
  useEffect(() => {
    if (!user?.id) return;
    ipcService.theme.get(user.id).then(savedTheme => {
      const merged = savedTheme && Object.keys(savedTheme).length > 0
        ? { ...DEFAULT_THEME, ...savedTheme }
        : DEFAULT_THEME;
      setTheme(merged);
      window.dispatchEvent(new CustomEvent('corvovault:theme-updated', { detail: merged }));
    });
    ipcService.theme.getOverrides(user.id).then(savedOverrides => {
      if (savedOverrides) setOverrides(savedOverrides);
    });
  }, [user?.id]);

  // Listen to external theme updates (e.g. from TitleBar toggle or CustomizeView)
  useEffect(() => {
    const handleThemeUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<Record<string, string>>;
      if (customEvent.detail) {
        setTheme(customEvent.detail);
      }
    };
    window.addEventListener('corvovault:theme-updated', handleThemeUpdated);
    return () => {
      window.removeEventListener('corvovault:theme-updated', handleThemeUpdated);
    };
  }, []);

  // Apply Global Theme — now just calls the shared applyThemeToDom function.
  // This still runs on hydration/init (when theme loads from storage).
  useEffect(() => { applyThemeToDom(theme); }, [theme]);

  // Inject Element Overrides via <style> tag
  useEffect(() => {
    if (!styleTagRef.current) {
      const style = document.createElement('style');
      style.id = 'corvovault-design-playground-inject';
      document.head.appendChild(style);
      styleTagRef.current = style;
    }
    let cssContent = '';
    Object.keys(overrides).forEach(selector => {
      const ruleBody = toCSSString(overrides[selector]);
      if (ruleBody) {
        cssContent += `${selector} {\n    ${ruleBody}\n}\n`;
      }
    });
    styleTagRef.current.innerHTML = cssContent;
  }, [overrides]);

  // Hover & Ctrl+E binding
  useEffect(() => {
    if (editTarget) return;

    const handleMouseMove = (e: MouseEvent) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      if (t && !t.closest('#corvovault-editor-panel')) {
        setHoverTarget(t);
      } else {
        setHoverTarget(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'e' && hoverTarget) {
        e.preventDefault();
        e.stopPropagation();
        let selector = '';
        try { selector = generateSelector(hoverTarget); } catch { }
        if (selector) {
          const existingStyles = overrides[selector] || {};
          setTargetStyles(existingStyles);
          setEditTarget({ element: hoverTarget, selector });
          setPanelOpen(true);
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hoverTarget, editTarget, overrides]);

  // Handlers
  const handleThemeChange = useCallback((key: string, value: string) => {
    const newTheme = { ...theme, [key]: value };
    applyThemeToDom(newTheme);
    setTheme(newTheme);
    if (user?.id) {
      ipcService.theme.save(user.id, newTheme);
      window.dispatchEvent(new CustomEvent('corvovault:theme-updated', { detail: newTheme }));
    }
  }, [theme, user?.id]);

  const handleApplyFullTheme = useCallback((newTheme: Record<string, string>, skipOverrideClear = false) => {
    const merged = { ...DEFAULT_THEME, ...newTheme };
    const clearedCount = skipOverrideClear ? 0 : Object.keys(overrides).length;
    applyThemeToDom(merged);
    setTheme(merged);
    if (user?.id) {
      ipcService.theme.save(user.id, merged);
      window.dispatchEvent(new CustomEvent('corvovault:theme-updated', { detail: merged }));
      if (!skipOverrideClear) {
        setOverrides({});
        ipcService.theme.saveOverrides(user.id, {});
        if (styleTagRef.current) styleTagRef.current.innerHTML = '';
      }
    }
    const msg = clearedCount > 0
      ? `✓ Theme applied to entire app — ${clearedCount} override${clearedCount !== 1 ? 's' : ''} cleared`
      : '✓ Theme applied to entire app';
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }, [user?.id, overrides]);


  // Nuclear reset — wipes everything back to app factory defaults
  const handleNuclearReset = () => {
    const clearedCount = Object.keys(overrides).length;
    // 1. Wipe style tag immediately
    if (styleTagRef.current) styleTagRef.current.innerHTML = '';
    // 2. Wipe state & storage
    setOverrides({});
    setTheme(DEFAULT_THEME);
    applyThemeToDom(DEFAULT_THEME);
    if (user?.id) {
      ipcService.theme.save(user.id, DEFAULT_THEME);
      ipcService.theme.saveOverrides(user.id, {});
      window.dispatchEvent(new CustomEvent('corvovault:theme-updated', { detail: DEFAULT_THEME }));
    }
    // 3. Re-apply all --color-* tokens to defaults immediately
    const root = document.documentElement;
    root.style.setProperty('--color-primary',                  DEFAULT_THEME['--primary']);
    root.style.setProperty('--color-on-primary',               DEFAULT_THEME['--primary-contrast']);
    root.style.setProperty('--color-surface',                  DEFAULT_THEME['--bg']);
    root.style.setProperty('--color-surface-container-lowest', DEFAULT_THEME['--bg']);
    root.style.setProperty('--color-surface-container-low',    DEFAULT_THEME['--bg-elev']);
    root.style.setProperty('--color-surface-container',        DEFAULT_THEME['--card']);
    root.style.setProperty('--color-surface-container-high',   DEFAULT_THEME['--card']);
    root.style.setProperty('--color-on-surface',               DEFAULT_THEME['--text']);
    root.style.setProperty('--color-on-surface-variant',       DEFAULT_THEME['--muted']);
    root.style.setProperty('--color-accent',                   DEFAULT_THEME['--accent']);
    root.style.setProperty('--color-outline',                  DEFAULT_THEME['--border']);
    root.style.setProperty('--color-outline-variant',          DEFAULT_THEME['--border']);
    root.style.setProperty('--radius-xl',                      DEFAULT_THEME['--radius']);
    document.body.style.backgroundColor = DEFAULT_THEME['--bg'];
    document.body.style.color           = DEFAULT_THEME['--text'];
    document.body.style.fontFamily      = DEFAULT_THEME['--font-family'];
    document.body.style.fontSize        = DEFAULT_THEME['--size'];
    document.body.style.fontWeight      = DEFAULT_THEME['--weight'];
    document.body.style.letterSpacing   = DEFAULT_THEME['--tracking'];
    document.body.style.lineHeight      = DEFAULT_THEME['--scale'];
    // 4. Restore default body background pattern (no grid dot)
    document.body.style.backgroundImage = "none";
    document.body.style.backgroundSize  = '';
    document.body.style.backgroundAttachment = '';
    const msg = clearedCount > 0
      ? `⟳ App renewed — ${clearedCount} element override${clearedCount !== 1 ? 's' : ''} cleared`
      : '⟳ App renewed to original theme';
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };


  const handleElementStyleChange = (prop: string, val: string) => {
    setTargetStyles(prev => ({ ...prev, [prop]: val }));
    if (editTarget) {
      const newOverrides = { ...overrides, [editTarget.selector]: { ...overrides[editTarget.selector], [prop]: val } };
      setOverrides(newOverrides);
      // Also persist immediately so changes are visible
      if (user?.id) ipcService.theme.saveOverrides(user.id, newOverrides);
    }
  };

  const handleCommitElement = () => {
    if (!user?.id || !editTarget) return;
    const cleanedStyles = Object.fromEntries(Object.entries(targetStyles).filter(([_, v]) => v.trim() !== ''));
    const newOverrides = { ...overrides };
    if (Object.keys(cleanedStyles).length > 0) newOverrides[editTarget.selector] = cleanedStyles;
    else delete newOverrides[editTarget.selector];
    setOverrides(newOverrides);
    ipcService.theme.saveOverrides(user.id, newOverrides);
    setEditTarget(null);
  };

  const handleDiscardElement = () => {
    if (user?.id) {
      ipcService.theme.getOverrides(user.id).then(saved => {
        if (saved) setOverrides(saved);
      });
    }
    setEditTarget(null);
  };

  const handleClearElement = () => {
    if (!user?.id || !editTarget) return;
    const newOverrides = { ...overrides };
    delete newOverrides[editTarget.selector];
    setOverrides(newOverrides);
    ipcService.theme.saveOverrides(user.id, newOverrides);
    setEditTarget(null);
  };

  return (
    <>
      <div className={`min-h-screen relative transition-all duration-300 ${panelOpen ? 'mr-[360px]' : ''}`}>
        {children}
      </div>

      {/* ── Editor Panel ── */}
      {panelOpen && (
        <div
          id="corvovault-editor-panel"
          style={{
            position: 'fixed', top: 0, right: 0, width: 360, height: '100vh',
            background: 'linear-gradient(160deg, var(--bg-elev) 0%, var(--bg) 100%)',
            borderLeft: '1px solid var(--border)',
            boxShadow: '-8px 0 48px rgba(0,0,0,0.15)',
            zIndex: 9999, display: 'flex', flexDirection: 'column',
            fontFamily: 'Inter, sans-serif', color: 'var(--text)',
            animation: 'slideInPanel 0.25s cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <style>{`
            @keyframes slideInPanel { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes fadeInUp { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .tl-tab { padding: 6px 14px; border-radius: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; transition: all 0.15s; border: none; }
            .tl-tab.active { background: var(--primary); color: var(--primary-contrast); }
            .tl-tab:not(.active) { background: transparent; color: var(--muted); }
            .tl-tab:hover:not(.active) { background: var(--bg-elev); color: var(--text); }
            .tl-section { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
            .tl-section-header { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background 0.15s; }
            .tl-section-header:hover { background: var(--border); }
            .tl-section-title { font-size: 10px; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); }
            .tl-color-btn { width: 32px; height: 32px; border-radius: 8px; border: 2px solid var(--border); cursor: pointer; transition: all 0.15s; position: relative; overflow: hidden; flex-shrink: 0; }
            .tl-color-btn:hover { transform: scale(1.1); border-color: var(--primary); }
            .tl-color-btn input[type=color] { position: absolute; inset: -6px; width: calc(100% + 12px); height: calc(100% + 12px); opacity: 0; cursor: pointer; }
            .tl-hex-badge { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; font-size: 10px; font-family: 'JetBrains Mono', monospace; color: var(--muted); min-width: 68px; text-align: center; cursor: pointer; transition: all 0.15s; }
            .tl-hex-badge:hover { background: var(--bg-elev); border-color: var(--primary); color: var(--text); }
            .tl-slider { -webkit-appearance: none; width: 100%; height: 4px; background: var(--border); border-radius: 2px; outline: none; cursor: pointer; }
            .tl-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; background: var(--primary); border-radius: 50%; border: 2px solid var(--card); box-shadow: 0 0 8px var(--primary); cursor: pointer; }
            .tl-slider:hover::-webkit-slider-thumb { background: var(--primary); opacity: 0.9; }
            .tl-input { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; color: var(--text); font-size: 12px; outline: none; width: 100%; transition: all 0.15s; }
            .tl-input:focus { border-color: var(--primary); background: var(--card); }
            .tl-select { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 8px 32px 8px 12px; color: var(--text); font-size: 12px; outline: none; width: 100%; appearance: none; cursor: pointer; transition: all 0.15s; }
            .tl-select:focus { border-color: var(--primary); }
            .tl-btn-primary { background: var(--primary); color: var(--primary-contrast); border: none; border-radius: 10px; padding: 10px 16px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 6px; justify-content: center; }
            .tl-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 24px var(--primary); }
            .tl-btn-secondary { background: var(--bg-elev); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 10px 16px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
            .tl-btn-secondary:hover { background: var(--border); }
            .tl-palette-card { background: var(--bg); border: 1px solid var(--border); border-radius: 14px; padding: 14px; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden; }
            .tl-palette-card:hover { border-color: var(--primary); transform: translateY(-2px); box-shadow: 0 8px 30px var(--border); }
            .tl-palette-card.applied { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary), 0 8px 30px var(--border); }
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          `}</style>

          {/* Header */}
          <div style={{ padding: '16px 16px 0', background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, background: 'var(--primary)', borderRadius: '50%', boxShadow: '0 0 10px var(--primary)', animation: 'pulse 2s infinite' }} />
                <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', letterSpacing: '-0.02em' }}>Theme Lab</span>
                {editTarget && (
                  <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.2)', color: 'var(--danger)', padding: '2px 8px', borderRadius: 6, fontWeight: 700, letterSpacing: '0.05em' }}>
                    ELEMENT MODE
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!editTarget && (
                  <button onClick={handleNuclearReset} className="tl-btn-secondary" style={{ padding: '6px 10px', fontSize: 10 }} title="Renew to Original Theme">
                    <RefreshCw style={{ width: 12, height: 12 }} />
                  </button>
                )}
                <button onClick={() => setPanelOpen(false)} className="tl-btn-secondary" style={{ padding: '6px 12px', fontSize: 10 }}>
                  Hide
                </button>
              </div>
            </div>

            {/* Tabs — only show in global mode */}
            {!editTarget && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className={`tl-tab ${activeTab === 'palettes' ? 'active' : ''}`} onClick={() => setActiveTab('palettes')}>
                  Palettes
                </button>
                <button className={`tl-tab ${activeTab === 'auto' ? 'active' : ''}`} onClick={() => setActiveTab('auto')}>
                  <Sparkles style={{ width: 10, height: 10, display: 'inline', marginRight: 4 }} />
                  Auto
                </button>
                <button className={`tl-tab ${activeTab === 'global' ? 'active' : ''}`} onClick={() => setActiveTab('global')}>
                  Global
                </button>
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto no-scrollbar p-4" style={{ paddingBottom: editTarget ? 100 : 24 }}>
            {editTarget ? (
              <ElementEditorPanel
                editTarget={editTarget}
                targetStyles={targetStyles}
                onChange={handleElementStyleChange}
                onSave={handleCommitElement}
                onCancel={handleDiscardElement}
                onClear={handleClearElement}
              />
            ) : activeTab === 'palettes' ? (
              <PaletteGallery theme={theme} onApply={handleApplyFullTheme} overrideCount={Object.keys(overrides).length} />
            ) : activeTab === 'auto' ? (
              <AutoThemeGenerator onApply={handleApplyFullTheme} overrideCount={Object.keys(overrides).length} />
            ) : (
              <GlobalThemePanel theme={theme} onChange={handleThemeChange} onImport={handleApplyFullTheme} />
            )}
          </div>

          {/* Ctrl+E Hint when no element selected */}
          {!editTarget && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-elev)' }}>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 14 }}>✨</div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', marginBottom: 1 }}>Click & Edit Any Element</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>Hover any element → press <span style={{ color: 'var(--primary)', fontWeight: 700 }}>Ctrl+E</span></div>
                </div>
              </div>
            </div>
          )}

          {/* ── Renew to Original Button — always visible ── */}
          <div style={{ padding: '10px 16px 14px', background: 'var(--bg-elev)', borderTop: '1px solid var(--border)' }}>
            <button
              onClick={handleNuclearReset}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: 'transparent',
                border: '1px solid var(--danger)',
                borderRadius: 12, padding: '10px 16px',
                fontSize: 11, fontWeight: 700, color: 'var(--danger)',
                cursor: 'pointer', transition: 'all 0.2s',
                letterSpacing: '0.03em',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--danger)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--primary-contrast)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)'; }}
            >
              <RefreshCw style={{ width: 13, height: 13 }} />
              ⟳ Renew to Original App Theme
            </button>
          </div>

          {/* Toast notification */}
          {toastMsg && (
            <div style={{
              position: 'absolute', bottom: 90, left: 12, right: 12,
              background: 'var(--card)',
              border: '1px solid var(--primary)',
              borderRadius: 12, padding: '10px 14px',
              fontSize: 11, fontWeight: 600, color: 'var(--primary)',
              animation: 'fadeInUp 0.2s ease',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
              zIndex: 200,
            }}>
              {toastMsg}
            </div>
          )}
        </div>
      )}


      {/* Hover Crosshair */}
      {!editTarget && hoverTarget && panelOpen && (() => {
        const r = hoverTarget.getBoundingClientRect();
        return (
          <div
            style={{
              position: 'fixed', top: r.top, left: r.left, width: r.width, height: r.height,
              pointerEvents: 'none', zIndex: 9998,
              border: '2px dashed rgba(99,102,241,0.8)',
              borderRadius: 4,
              background: 'rgba(99,102,241,0.05)',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.04)',
              transition: 'all 0.07s',
            }}
          />
        );
      })()}
    </>
  );
}

// ─── Palette Gallery ──────────────────────────────────────────
function PaletteGallery({ theme, onApply, overrideCount }: { theme: Record<string, string>; onApply: (t: Record<string, string>) => void; overrideCount: number }) {
  const [applied, setApplied] = useState<string | null>(null);

  const handleApply = (p: typeof PREBUILT_PALETTES[0]) => {
    const t = generateAutoTheme(p.hue, p.style);
    onApply(t);
    setApplied(p.name);
    setTimeout(() => setApplied(null), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'fadeInUp 0.25s ease' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>
        Pre-built Palettes
      </div>

      {/* Override warning */}
      {overrideCount > 0 && (
        <div style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <div style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.6 }}>
            You have <strong>{overrideCount}</strong> element override{overrideCount !== 1 ? 's' : ''} (Ctrl+E edits). Applying a palette will clear them so the new theme reaches <strong>every</strong> element in the app.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {PREBUILT_PALETTES.map(p => (
          <button
            key={p.name}
            className={`tl-palette-card ${applied === p.name ? 'applied' : ''}`}
            onClick={() => handleApply(p)}
            style={{ textAlign: 'left', width: '100%' }}
          >
            <div style={{ fontSize: 22, marginBottom: 8 }}>{p.emoji}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>{p.name}</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {p.preview.map((c, i) => (
                <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: c }} />
              ))}
            </div>
            {applied === p.name && (
              <div style={{ position: 'absolute', top: 8, right: 8, background: '#6366f1', borderRadius: 6, padding: '2px 6px', fontSize: 9, fontWeight: 800, color: 'white' }}>
                ✓ Applied
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Custom Reset */}
      <button
        onClick={() => onApply({})}
        className="tl-btn-secondary"
        style={{ marginTop: 4, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11 }}
      >
        <RefreshCw style={{ width: 12, height: 12 }} />
        Reset to Default
      </button>

      <div style={{ marginTop: 8, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10, padding: '10px 14px' }}>
        <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
          💡 After applying a palette, fine-tune any color in the <span style={{ color: '#a5b4fc', fontWeight: 700 }}>Global</span> tab
        </div>
      </div>
    </div>
  );
}

// ─── Auto Theme Generator ─────────────────────────────────────
function AutoThemeGenerator({ onApply, overrideCount }: { onApply: (t: Record<string, string>) => void; overrideCount: number }) {
  const [hue, setHue] = useState(220);
  const [style, setStyle] = useState<ThemeStyle>('light');
  const [preview, setPreview] = useState<Record<string, string> | null>(null);
  const [applied, setApplied] = useState(false);

  const styles: { value: ThemeStyle; label: string; icon: string }[] = [
    { value: 'light', label: 'Clean Light', icon: '☀️' },
    { value: 'dark', label: 'Deep Dark', icon: '🌙' },
    { value: 'warm', label: 'Warm Cozy', icon: '🔥' },
    { value: 'cool', label: 'Cool Crisp', icon: '❄️' },
    { value: 'bold', label: 'Bold Neon', icon: '⚡' },
  ];

  const handleGenerate = () => {
    const t = generateAutoTheme(hue, style);
    setPreview(t);
  };

  const handleApply = () => {
    if (!preview) return;
    onApply(preview);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  const hueColors = [0, 30, 60, 120, 180, 220, 270, 330];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fadeInUp 0.25s ease' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        Auto Theme Generator
      </div>

      {/* Override warning */}
      {overrideCount > 0 && (
        <div style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <div style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.6 }}>
            <strong>{overrideCount}</strong> element override{overrideCount !== 1 ? 's' : ''} will be cleared when applied — this lets the theme reach <strong>every</strong> element, including your custom-edited ones.
          </div>
        </div>
      )}

      {/* Hue Picker */}
      <div className="tl-section">
        <div style={{ padding: '12px 16px 8px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Base Color</div>

          {/* Hue Quick-Pick */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {hueColors.map(h => (
              <button
                key={h}
                onClick={() => setHue(h)}
                style={{
                  width: 28, height: 28, borderRadius: 8, border: hue === h ? '2px solid white' : '2px solid transparent',
                  background: hsl(h, 70, 55), cursor: 'pointer', transition: 'all 0.15s',
                  boxShadow: hue === h ? `0 0 12px ${hsl(h, 70, 55)}88` : 'none',
                }}
              />
            ))}
          </div>

          {/* Hue Slider */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>Hue</span>
              <span style={{ fontSize: 10, color: '#a5b4fc', fontWeight: 700 }}>{hue}°</span>
            </div>
            <div style={{ position: 'relative' }}>
              <div style={{
                height: 8, borderRadius: 4, marginBottom: 8,
                background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
              }} />
              <input
                type="range" min={0} max={359} step={1} value={hue}
                onChange={e => setHue(parseInt(e.target.value))}
                className="tl-slider"
                style={{ marginTop: 0 }}
              />
            </div>
            {/* Color preview */}
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              {[hsl(hue, 70, 45), hsl(hue, 50, 95), hsl((hue+180)%360, 75, 52), hsl(hue, 20, 8)].map((c, i) => (
                <div key={i} style={{ flex: 1, height: 20, borderRadius: 6, background: c }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Style Picker */}
      <div className="tl-section">
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Style Vibe</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {styles.map(s => (
              <button
                key={s.value}
                onClick={() => setStyle(s.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left', width: '100%',
                  background: style === s.value ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
                  border: style === s.value ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                  color: style === s.value ? '#a5b4fc' : '#64748b',
                }}
              >
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span style={{ fontSize: 11, fontWeight: style === s.value ? 700 : 500 }}>{s.label}</span>
                {style === s.value && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6366f1' }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <button onClick={handleGenerate} className="tl-btn-primary" style={{ width: '100%' }}>
        <Wand2 style={{ width: 14, height: 14 }} />
        Generate Theme
      </button>

      {/* Preview */}
      {preview && (
        <div style={{ animation: 'fadeInUp 0.2s ease' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Preview</div>
          <div style={{
            borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.15)',
            background: preview['--bg'] || '#fff',
          }}>
            {/* Mini UI preview */}
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: preview['--primary'] }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: preview['--text'], marginBottom: 2 }}>Sample Title</div>
                  <div style={{ fontSize: 9, color: preview['--muted'] }}>Sample muted text</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['--primary', '--accent', '--success', '--danger', '--border'].map(k => (
                  <div key={k} style={{ flex: 1, height: 6, borderRadius: 3, background: preview[k] || '#ccc' }} />
                ))}
              </div>
              <div style={{ background: preview['--card'], border: `1px solid ${preview['--border']}`  , borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 9, color: preview['--text'], marginBottom: 4 }}>Card element</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <div style={{ fontSize: 9, background: preview['--primary'], color: preview['--primary-contrast'], borderRadius: 4, padding: '3px 8px' }}>Button</div>
                  <div style={{ fontSize: 9, background: preview['--accent'], color: '#fff', borderRadius: 4, padding: '3px 8px' }}>Accent</div>
                </div>
              </div>
            </div>
          </div>
          <button onClick={handleApply} className="tl-btn-primary" style={{ width: '100%', marginTop: 8 }}>
            {applied ? '✓ Applied!' : 'Apply This Theme'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Global Theme Panel ───────────────────────────────────────────
function GlobalThemePanel({ theme, onChange, onImport }: {
  theme: Record<string, string>;
  onChange: (k: string, v: string) => void;
  onImport: (t: Record<string, string>) => void;
}) {
  const [globalBgImage, setGlobalBgImage] = useState(theme['--bg-image'] || '');
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const colorDefs = [
    { key: '--bg', label: 'Page Background' },
    { key: '--bg-elev', label: 'Elevated BG' },
    { key: '--card', label: 'Card Surface' },
    { key: '--primary', label: 'Primary Brand' },
    { key: '--primary-contrast', label: 'Primary Text' },
    { key: '--text', label: 'Main Text' },
    { key: '--muted', label: 'Muted / Subtle' },
    { key: '--accent', label: 'Accent Color' },
    { key: '--danger', label: 'Danger / Error' },
    { key: '--success', label: 'Success' },
    { key: '--border', label: 'Border Color' },
  ];

  const fonts = [
    'Inter, sans-serif', 'Roboto, sans-serif', 'Outfit, sans-serif',
    'system-ui, sans-serif', 'Georgia, serif', 'JetBrains Mono, monospace'
  ];

  // ── Reference feature: Copy CSS Variables ──
  const copyCSSVars = () => {
    let css = ':root {\n';
    Object.entries(theme).forEach(([k, v]) => { css += `  ${k}: ${v};\n`; });
    css += '}';
    navigator.clipboard.writeText(css).then(() => {
      setCopyMsg('✓ CSS copied!');
      setTimeout(() => setCopyMsg(null), 2000);
    });
  };

  // ── Reference feature: Export JSON ──
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'corvovault-theme.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setCopyMsg('✓ Theme JSON exported');
    setTimeout(() => setCopyMsg(null), 2500);
  };

  // ── Reference feature: Import JSON ──
  const importJSON = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed['--bg']) {
          onImport(parsed);
          setCopyMsg('✓ Theme imported!');
          setTimeout(() => setCopyMsg(null), 2500);
        }
      } catch { /* ignore bad JSON */ }
    };
    input.click();
  };

  const handleBgImageUpload = async () => {
    if (!window.electronAPI) return;
    try {
      const { canceled, filePaths } = await window.electronAPI.openFileDialog({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }]
      });
      if (!canceled && filePaths.length > 0) {
        const { localPath } = await window.electronAPI.copyFileToLocal(filePaths[0]);
        const cssPath = localPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:');
        const url = `url('file:///${cssPath}')`;
        setGlobalBgImage(url);
        onChange('--bg-image', url);
        document.body.style.backgroundImage = url;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';
      }
    } catch (err) {
      console.error('[ThemeLab] BG upload failed:', err);
    }
  };

  const handleClearBgImage = () => {
    setGlobalBgImage('');
    onChange('--bg-image', '');
    document.body.style.backgroundImage = "none";
    document.body.style.backgroundSize = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'fadeInUp 0.25s ease' }}>
      {/* Colors */}
      <TLSection title="Colors" defaultOpen>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {colorDefs.map(c => (
            <TLColorRow key={c.key} label={c.label} value={theme[c.key] || '#ffffff'} onChange={v => onChange(c.key, v)} />
          ))}
        </div>
      </TLSection>

      {/* Typography */}
      <TLSection title="Typography" defaultOpen>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>Font Family</div>
          <div style={{ position: 'relative' }}>
            <select className="tl-select" value={theme['--font-family'] || 'Inter, sans-serif'} onChange={e => onChange('--font-family', e.target.value)}>
              {fonts.map(f => <option key={f} value={f}>{f.split(',')[0]}</option>)}
            </select>
            <ChevronDown style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#475569', pointerEvents: 'none' }} />
          </div>
        </div>
        <TLSliderRow label="Base Font Size" value={theme['--size']} onChange={v => onChange('--size', v)} min={10} max={22} step={1} unit="px" />
        <TLSliderRow label="Line Height Scale" value={theme['--scale']} onChange={v => onChange('--scale', v)} min={1} max={2.2} step={0.05} />
        <TLSliderRow label="Font Weight" value={theme['--weight']} onChange={v => onChange('--weight', v)} min={100} max={900} step={100} />
        <TLSliderRow label="Letter Spacing" value={theme['--tracking']} onChange={v => onChange('--tracking', v)} min={-2} max={8} step={0.5} unit="px" />
      </TLSection>

      {/* Layout */}
      <TLSection title="Layout & Spacing">
        <TLSliderRow label="Border Radius" value={theme['--radius']} onChange={v => onChange('--radius', v)} min={0} max={40} step={2} unit="px" />
        <TLSliderRow label="Padding" value={theme['--pad']} onChange={v => onChange('--pad', v)} min={0} max={60} step={4} unit="px" />
        <TLSliderRow label="Gap" value={theme['--gap']} onChange={v => onChange('--gap', v)} min={0} max={40} step={4} unit="px" />
        <TLSliderRow label="Blur Amount" value={theme['--blur']} onChange={v => onChange('--blur', v)} min={0} max={40} step={2} unit="px" />
      </TLSection>

      {/* Background Image */}
      <TLSection title="Background Image">
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleBgImageUpload}
            className="tl-btn-secondary"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11 }}
          >
            <Upload style={{ width: 12, height: 12 }} />
            Upload Global BG
          </button>
          {globalBgImage && (
            <button onClick={handleClearBgImage} style={{ width: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, color: '#f87171', cursor: 'pointer' }}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>
        {globalBgImage && (
          <div style={{ fontSize: 9, color: '#475569', marginTop: 6, background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '6px 8px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {globalBgImage.slice(0, 40)}…
          </div>
        )}
      </TLSection>

      {/* ── Reference features: Copy CSS / Export / Import ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 4 }}>
        <button
          onClick={copyCSSVars}
          className="tl-btn-secondary"
          style={{ fontSize: 10, padding: '8px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
        >
          <span style={{ fontSize: 14 }}>📋</span>
          {copyMsg && copyMsg.startsWith('✓ CSS') ? copyMsg : 'Copy CSS'}
        </button>
        <button
          onClick={exportJSON}
          className="tl-btn-secondary"
          style={{ fontSize: 10, padding: '8px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
        >
          <span style={{ fontSize: 14 }}>📤</span>
          Export JSON
        </button>
        <button
          onClick={importJSON}
          className="tl-btn-secondary"
          style={{ fontSize: 10, padding: '8px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
        >
          <span style={{ fontSize: 14 }}>📥</span>
          Import JSON
        </button>
      </div>
      {copyMsg && (
        <div style={{ textAlign: 'center', fontSize: 10, color: '#6ee7b7', fontWeight: 600 }}>{copyMsg}</div>
      )}
    </div>
  );
}

// ─── TL Shared Sub-components ─────────────────────────────────


function TLSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="tl-section">
      <div className="tl-section-header" onClick={() => setOpen(!open)}>
        <span className="tl-section-title">{title}</span>
        {open
          ? <ChevronDown style={{ width: 14, height: 14, color: '#475569' }} />
          : <ChevronRight style={{ width: 14, height: 14, color: '#475569' }} />
        }
      </div>
      {open && <div style={{ padding: '0 16px 14px' }}>{children}</div>}
    </div>
  );
}

function TLColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const safeHex = value && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : '#ffffff';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(safeHex).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', gap: 10 }}>
      <span style={{ fontSize: 11, color: '#94a3b8', flex: 1, minWidth: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div className="tl-color-btn" style={{ background: value || '#fff' }}>
          <input
            type="color"
            value={safeHex}
            onChange={e => onChange(e.target.value)}
          />
        </div>
        <button className="tl-hex-badge" onClick={handleCopy} title="Copy hex">
          {copied ? '✓ Copied' : safeHex.toUpperCase()}
        </button>
      </div>
    </div>
  );
}

function TLSliderRow({ label, value, onChange, min, max, step, unit = '' }: {
  label: string; value: string | number; onChange: (v: string) => void;
  min: number; max: number; step: number; unit?: string;
}) {
  const numericValue = typeof value === 'string' ? parseFloat(value) || 0 : (value || 0);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700, fontFamily: 'monospace' }}>{numericValue}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={numericValue}
        onChange={e => onChange(e.target.value + unit)}
        className="tl-slider"
      />
    </div>
  );
}

// ─── Element Editor Panel ─────────────────────────────────────
function ElementEditorPanel({ editTarget, targetStyles, onChange, onSave, onCancel, onClear }: any) {
  const tag = editTarget.element.tagName.toLowerCase();
  const isText = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'label', 'button'].includes(tag);
  const isLayout = ['div', 'main', 'section', 'header', 'aside', 'nav', 'article'].includes(tag);

  const shadow = parseShadow(targetStyles['boxShadow'] || '');
  const transform = parseTransform(targetStyles['transform'] || '');

  const handleBgUpload = async () => {
    if (!window.electronAPI) {
      alert('Background image upload requires the Electron desktop app.');
      return;
    }
    try {
      const { canceled, filePaths } = await window.electronAPI.openFileDialog({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg'] }]
      });
      if (!canceled && filePaths.length > 0) {
        const { localPath } = await window.electronAPI.copyFileToLocal(filePaths[0]);
        // Properly format the file:// URL for Windows paths
        const normalized = localPath.replace(/\\/g, '/');
        const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
        onChange('backgroundImage', `url("${fileUrl}")`);
        onChange('backgroundSize', 'cover');
        onChange('backgroundPosition', 'center');
        onChange('backgroundRepeat', 'no-repeat');
      }
    } catch (err) {
      console.error('[ThemeLab] Element BG upload error:', err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 80, animation: 'fadeInUp 0.2s ease' }}>
      {/* Element badge */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))',
        border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SquareArrowUpRight style={{ width: 14, height: 14, color: '#818cf8' }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#a5b4fc', fontFamily: 'monospace' }}>&lt;{tag}&gt;</span>
        </div>
        <span style={{ fontSize: 9, color: '#4b5563', fontFamily: 'monospace', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {editTarget.selector.slice(-30)}
        </span>
      </div>

      {/* Fill & Surface */}
      <TLSection title="Fill & Surface" defaultOpen={!isText}>
        <TLColorRow label="Background Color" value={targetStyles['backgroundColor'] || '#ffffff'} onChange={v => onChange('backgroundColor', v)} />
        <TLColorRow label="Text Color" value={targetStyles['color'] || '#000000'} onChange={v => onChange('color', v)} />
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Background Image</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleBgUpload} className="tl-btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11 }}>
              <Upload style={{ width: 12, height: 12 }} />
              Upload Image
            </button>
            {targetStyles['backgroundImage'] && (
              <button
                onClick={() => { onChange('backgroundImage', ''); onChange('backgroundSize', ''); onChange('backgroundPosition', ''); onChange('backgroundRepeat', ''); }}
                style={{ width: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, color: '#f87171', cursor: 'pointer' }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            )}
          </div>
          {targetStyles['backgroundImage'] && (
            <div style={{ fontSize: 9, color: '#475569', marginTop: 6, background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '6px 8px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {targetStyles['backgroundImage'].slice(0, 40)}…
            </div>
          )}
        </div>
      </TLSection>

      {/* Typography */}
      <TLSection title="Typography" defaultOpen={isText}>
        <TLSliderRow label="Font Size" value={targetStyles['fontSize'] || '16px'} onChange={v => onChange('fontSize', v)} min={8} max={120} step={1} unit="px" />
        <TLSliderRow label="Font Weight" value={targetStyles['fontWeight'] || '400'} onChange={v => onChange('fontWeight', v)} min={100} max={900} step={100} />
        <TLSliderRow label="Line Height" value={targetStyles['lineHeight'] || '1.5'} onChange={v => onChange('lineHeight', v)} min={0.5} max={4} step={0.1} />
        <TLSliderRow label="Letter Spacing" value={targetStyles['letterSpacing'] || '0px'} onChange={v => onChange('letterSpacing', v)} min={-5} max={20} step={0.5} unit="px" />
      </TLSection>

      {/* Dimensions */}
      <TLSection title="Dimensions & Layout" defaultOpen={isLayout}>
        <TLSliderRow label="Padding" value={targetStyles['padding'] || '0px'} onChange={v => onChange('padding', v)} min={0} max={160} step={1} unit="px" />
        <TLSliderRow label="Margin" value={targetStyles['margin'] || '0px'} onChange={v => onChange('margin', v)} min={0} max={160} step={1} unit="px" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>Width</div>
            <input className="tl-input" value={targetStyles['width'] || ''} onChange={e => onChange('width', e.target.value)} placeholder="auto" />
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>Height</div>
            <input className="tl-input" value={targetStyles['height'] || ''} onChange={e => onChange('height', e.target.value)} placeholder="auto" />
          </div>
        </div>
        <TLSliderRow label="Opacity" value={targetStyles['opacity'] || '1'} onChange={v => onChange('opacity', v)} min={0} max={1} step={0.05} />
      </TLSection>

      {/* Borders */}
      <TLSection title="Borders & Corners">
        {!targetStyles['border'] && !targetStyles['borderWidth'] ? (
          <button
            onClick={() => onChange('borderWidth', '1px')}
            className="tl-btn-secondary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11 }}
          >
            <Plus style={{ width: 12, height: 12 }} /> Add Border
          </button>
        ) : (
          <>
            <TLSliderRow label="Border Width" value={targetStyles['borderWidth'] || '1px'} onChange={v => onChange('borderWidth', v)} min={0} max={20} step={1} unit="px" />
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>Border Style</div>
              <div style={{ position: 'relative' }}>
                <select className="tl-select" value={targetStyles['borderStyle'] || 'solid'} onChange={e => onChange('borderStyle', e.target.value)}>
                  {['solid', 'dashed', 'dotted', 'double', 'none'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <ChevronDown style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#475569', pointerEvents: 'none' }} />
              </div>
            </div>
            <TLColorRow label="Border Color" value={targetStyles['borderColor'] || '#e2e8f0'} onChange={v => onChange('borderColor', v)} />
            <TLSliderRow label="Corner Radius" value={targetStyles['borderRadius'] || '0px'} onChange={v => onChange('borderRadius', v)} min={0} max={100} step={1} unit="px" />
          </>
        )}
      </TLSection>

      {/* Shadows */}
      <TLSection title="Shadow & Effects">
        {!targetStyles['boxShadow'] ? (
          <button
            onClick={() => onChange('boxShadow', '0px 8px 24px rgba(0,0,0,0.12)')}
            className="tl-btn-secondary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11 }}
          >
            <Plus style={{ width: 12, height: 12 }} /> Add Shadow
          </button>
        ) : (
          <>
            <TLSliderRow label="Shadow X" value={shadow.x} onChange={v => onChange('boxShadow', assembleShadow({ ...shadow, x: parseInt(v) }))} min={-50} max={50} step={1} unit="px" />
            <TLSliderRow label="Shadow Y" value={shadow.y} onChange={v => onChange('boxShadow', assembleShadow({ ...shadow, y: parseInt(v) }))} min={-50} max={50} step={1} unit="px" />
            <TLSliderRow label="Blur Radius" value={shadow.blur} onChange={v => onChange('boxShadow', assembleShadow({ ...shadow, blur: parseInt(v) }))} min={0} max={100} step={1} unit="px" />
            <TLSliderRow label="Spread" value={shadow.spread} onChange={v => onChange('boxShadow', assembleShadow({ ...shadow, spread: parseInt(v) }))} min={-20} max={50} step={1} unit="px" />
            <TLColorRow label="Shadow Color" value={shadow.color.startsWith('#') ? shadow.color : '#000000'} onChange={v => onChange('boxShadow', assembleShadow({ ...shadow, color: v }))} />
            <button onClick={() => onChange('boxShadow', '')} className="tl-btn-secondary" style={{ width: '100%', marginTop: 4, fontSize: 10 }}>Remove Shadow</button>
          </>
        )}
      </TLSection>

      {/* 3D Transform */}
      <TLSection title="3D Transform">
        <TLSliderRow label="Move X" value={transform.x} onChange={v => onChange('transform', assembleTransform({ ...transform, x: parseFloat(v) }))} min={-200} max={200} step={1} unit="px" />
        <TLSliderRow label="Move Y" value={transform.y} onChange={v => onChange('transform', assembleTransform({ ...transform, y: parseFloat(v) }))} min={-200} max={200} step={1} unit="px" />
        <TLSliderRow label="Depth (Z)" value={transform.z} onChange={v => onChange('transform', assembleTransform({ ...transform, z: parseFloat(v) }))} min={-500} max={500} step={5} unit="px" />
      </TLSection>

      {/* Sticky Bottom Bar */}
      <div style={{
        position: 'fixed', bottom: 0, right: 0, width: 360,
        background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(148,163,184,0.1)',
        padding: '12px 16px', display: 'flex', gap: 8, zIndex: 100,
      }}>
        <button onClick={onClear} style={{
          width: 44, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 10, color: '#f87171', cursor: 'pointer', transition: 'all 0.15s',
        }} title="Clear All Styles">
          <Trash2 style={{ width: 15, height: 15 }} />
        </button>
        <button onClick={onCancel} className="tl-btn-secondary" style={{ flex: 1, fontSize: 11 }}>
          ✕ Cancel
        </button>
        <button onClick={onSave} className="tl-btn-primary" style={{ flex: 1, fontSize: 11 }}>
          <Check style={{ width: 13, height: 13 }} />
          Commit
        </button>
      </div>
    </div>
  );
}
