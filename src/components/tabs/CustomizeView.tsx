import React, { useState, useEffect, useCallback } from 'react';
import { Palette, Wand2, RefreshCw, X, Check, ChevronDown, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ipcService } from '../../services/ipcService';
import { applyThemeToDom, DEFAULT_THEME } from '../../lib/theme';
import { generateAutoTheme, hsl, ThemeStyle } from '../../lib/themeGenerator';

const PREBUILT_PALETTES = [
  { name: 'Mango', emoji: '🥭', hue: 38, style: 'warm' as ThemeStyle, colors: [hsl(38, 75, 42), hsl(38, 30, 97), hsl(218, 70, 48)] },
  { name: 'Lichi', emoji: '🍈', hue: 355, style: 'light' as ThemeStyle, colors: [hsl(355, 70, 40), hsl(355, 20, 97), hsl(175, 75, 50)] },
  { name: 'Blackberry', emoji: '🫐', hue: 270, style: 'dark' as ThemeStyle, colors: [hsl(270, 80, 65), hsl(270, 20, 8), hsl(90, 80, 60)] },
  { name: 'Coffee', emoji: '☕', hue: 25, style: 'dark' as ThemeStyle, colors: [hsl(25, 75, 42), hsl(25, 20, 8), hsl(205, 70, 60)] },
  { name: 'Orange', emoji: '🍊', hue: 22, style: 'bold' as ThemeStyle, colors: [hsl(22, 90, 58), hsl(22, 15, 6), hsl(202, 90, 58)] },
  { name: 'Banana', emoji: '🍌', hue: 52, style: 'warm' as ThemeStyle, colors: [hsl(52, 75, 42), hsl(52, 30, 97), hsl(232, 70, 48)] },
  { name: 'Crow', emoji: '🐦‍⬛', hue: 270, style: 'crow' as ThemeStyle, colors: ['#4F46E5', '#0F1115', '#FCD34D'] },
  { name: 'Night', emoji: '🌌', hue: 230, style: 'night' as ThemeStyle, colors: ['#2A4494', '#0F1115', '#FCD34D'] },
];

export default function CustomizeView() {
  const { user } = useAuth();
  const [theme, setTheme] = useState<Record<string, string>>(DEFAULT_THEME);
  const [activeTab, setActiveTab] = useState<'palettes' | 'auto' | 'sliders'>('palettes');
  const [hue, setHue] = useState(220);
  const [style, setStyle] = useState<ThemeStyle>('light');
  const [autoPreview, setAutoPreview] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    ipcService.theme.get(user.id).then(savedTheme => {
      if (savedTheme && Object.keys(savedTheme).length > 0) {
        const merged = { ...DEFAULT_THEME, ...savedTheme };
        setTheme(merged);
        applyThemeToDom(merged);
      } else {
        applyThemeToDom(DEFAULT_THEME);
      }
    });

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
  }, [user?.id]);

  const updateVal = useCallback((key: string, val: string) => {
    const next = { ...theme, [key]: val };
    setTheme(next);
    applyThemeToDom(next);
    if (user?.id) {
      ipcService.theme.save(user.id, next);
      window.dispatchEvent(new CustomEvent('corvovault:theme-updated', { detail: next }));
    }
  }, [theme, user?.id]);

  const handleApplyTheme = useCallback((themeData: Record<string, string>) => {
    const merged = { ...DEFAULT_THEME, ...themeData };
    setTheme(merged);
    applyThemeToDom(merged);
    if (user?.id) {
      ipcService.theme.save(user.id, merged);
      window.dispatchEvent(new CustomEvent('corvovault:theme-updated', { detail: merged }));
    }
  }, [user?.id]);

  const handleReset = () => {
    handleApplyTheme(DEFAULT_THEME);
  };

  const handleGenerate = () => {
    const generated = generateAutoTheme(hue, style);
    setAutoPreview(generated);
  };

  const fonts = [
    'Inter, sans-serif', 'Roboto, sans-serif', 'Outfit, sans-serif',
    'system-ui, sans-serif', 'Georgia, serif', 'JetBrains Mono, monospace'
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 select-none">
      <section className="space-y-1">
        <h2 className="text-2xl font-black font-headline tracking-tight text-primary">Customize Space</h2>
        <p className="text-xs text-on-surface-variant">Design the aesthetics of your Study Sanctuary.</p>
      </section>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-outline-variant/10 pb-2">
        {['palettes', 'auto', 'sliders'].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t as any)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all uppercase tracking-wider ${
              activeTab === t
                ? 'bg-primary text-on-primary shadow'
                : 'text-outline hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            {t}
          </button>
        ))}
        <button
          onClick={handleReset}
          className="ml-auto px-4 py-1.5 rounded-full text-xs font-bold text-red-500 hover:bg-red-50 transition-colors uppercase tracking-wider flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reset Default
        </button>
      </div>

      {/* Content */}
      <div className="pt-2">
        {activeTab === 'palettes' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PREBUILT_PALETTES.map((p) => (
              <div
                key={p.name}
                onClick={() => handleApplyTheme(generateAutoTheme(p.hue, p.style))}
                className="bg-surface-container-low/60 hover:bg-surface-container-low border border-outline-variant/10 rounded-2xl p-5 cursor-pointer hover:shadow-md transition-all space-y-4 group relative"
              >
                <div className="flex items-center justify-between">
                  <span className="text-3xl">{p.emoji}</span>
                  <span className="text-xs font-bold text-outline opacity-0 group-hover:opacity-100 transition-opacity">Apply</span>
                </div>
                <div>
                  <h3 className="font-black text-sm text-on-surface">{p.name}</h3>
                  <p className="text-[10px] text-outline font-semibold uppercase">{p.style} vibe</p>
                </div>
                <div className="flex gap-1.5">
                  {p.colors.map((c, i) => (
                    <div key={i} className="h-2 flex-1 rounded-full" style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'auto' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-5 space-y-5 bg-surface-container-low/40 p-6 rounded-2xl border border-outline-variant/10">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-outline block">Base Hue</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={hue}
                    onChange={(e) => setHue(parseInt(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-xs font-bold text-primary w-8 text-right">{hue}°</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-outline block">Style Vibe</label>
                <div className="flex flex-col gap-1.5">
                  {(['light', 'dark', 'warm', 'cool', 'bold'] as ThemeStyle[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStyle(s)}
                      className={`w-full text-left py-2 px-3 rounded-xl text-xs font-bold transition-all uppercase tracking-wider ${
                        style === s
                          ? 'bg-primary/10 text-primary border border-primary/20'
                          : 'bg-transparent text-outline hover:bg-surface-container-high'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                className="w-full bg-primary text-on-primary font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 hover:scale-[1.01] transition-transform shadow-md"
              >
                <Wand2 className="w-4 h-4" />
                Generate Vibe
              </button>
            </div>

            <div className="md:col-span-7 flex flex-col justify-center items-center">
              {autoPreview ? (
                <div className="w-full bg-surface-container-low/20 rounded-2xl p-6 border border-outline-variant/10 space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold" style={{ backgroundColor: autoPreview['--primary'] }}>
                      Aa
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-on-surface">Vibe Preview</h4>
                      <p className="text-[9px] text-outline font-semibold uppercase">Derived aesthetic theme</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {['--bg', '--card', '--primary', '--accent', '--danger', '--success'].map((k) => (
                      <div key={k} className="h-6 flex-1 rounded-lg border border-outline-variant/15" style={{ backgroundColor: autoPreview[k] }} title={k} />
                    ))}
                  </div>
                  <button
                    onClick={() => handleApplyTheme(autoPreview)}
                    className="w-full bg-primary text-on-primary py-2.5 rounded-xl font-bold hover:scale-[1.01] transition-transform shadow-md flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    Apply Theme
                  </button>
                </div>
              ) : (
                <div className="text-center text-outline py-12 flex flex-col items-center justify-center gap-2">
                  <Sparkles className="w-8 h-8 opacity-20" />
                  <p className="text-xs font-bold">Select Hue and Style vibe, then click Generate.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'sliders' && (
          <div className="bg-surface-container-low/40 p-6 rounded-2xl border border-outline-variant/10 space-y-6">
            {/* Color Rows */}
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-primary font-headline">Colors</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { key: '--bg', label: 'Background' },
                  { key: '--bg-elev', label: 'Elevated BG' },
                  { key: '--card', label: 'Card Surface' },
                  { key: '--primary', label: 'Primary Brand' },
                  { key: '--primary-contrast', label: 'Primary Text' },
                  { key: '--text', label: 'Main Text' },
                  { key: '--muted', label: 'Muted Text' },
                  { key: '--accent', label: 'Accent' },
                  { key: '--danger', label: 'Danger / Error' },
                  { key: '--success', label: 'Success' },
                  { key: '--border', label: 'Border' },
                ].map((c) => (
                  <div key={c.key} className="flex items-center justify-between bg-surface p-3 rounded-xl border border-outline-variant/5">
                    <span className="text-xs font-bold text-on-surface-variant">{c.label}</span>
                    <input
                      type="color"
                      value={theme[c.key] || '#ffffff'}
                      onChange={(e) => updateVal(c.key, e.target.value)}
                      className="w-8 h-8 rounded-lg overflow-hidden border-none outline-none cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Layout Slider Settings */}
            <div className="space-y-4 pt-4 border-t border-outline-variant/5">
              <h3 className="text-xs font-black uppercase tracking-wider text-primary font-headline">Layout &amp; Spacing</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Border Radius ({theme['--radius'] || '0px'})</span>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={parseInt(theme['--radius'] || '0')}
                    onChange={(e) => updateVal('--radius', `${e.target.value}px`)}
                    className="w-48 accent-primary"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Inner Padding ({theme['--pad'] || '0px'})</span>
                  <input
                    type="range"
                    min={12}
                    max={48}
                    value={parseInt(theme['--pad'] || '12')}
                    onChange={(e) => updateVal('--pad', `${e.target.value}px`)}
                    className="w-48 accent-primary"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Gap Spacing ({theme['--gap'] || '0px'})</span>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={parseInt(theme['--gap'] || '0')}
                    onChange={(e) => updateVal('--gap', `${e.target.value}px`)}
                    className="w-48 accent-primary"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Layout Blur ({theme['--blur'] || '0px'})</span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={parseInt(theme['--blur'] || '0')}
                    onChange={(e) => updateVal('--blur', `${e.target.value}px`)}
                    className="w-48 accent-primary"
                  />
                </div>
              </div>
            </div>

            {/* Typography Slider Settings */}
            <div className="space-y-4 pt-4 border-t border-outline-variant/5">
              <h3 className="text-xs font-black uppercase tracking-wider text-primary font-headline">Typography</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Font Family</span>
                  <div className="relative">
                    <select
                      value={theme['--font-family'] || 'Inter, sans-serif'}
                      onChange={(e) => updateVal('--font-family', e.target.value)}
                      className="bg-surface border border-outline-variant/10 rounded-xl px-3 py-1.5 text-xs text-on-surface outline-none appearance-none pr-8 cursor-pointer w-48"
                    >
                      {fonts.map((f) => (
                        <option key={f} value={f}>
                          {f.split(',')[0]}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-outline absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Font Size ({theme['--size'] || '16px'})</span>
                  <input
                    type="range"
                    min={10}
                    max={22}
                    value={parseInt(theme['--size'] || '16')}
                    onChange={(e) => updateVal('--size', `${e.target.value}px`)}
                    className="w-48 accent-primary"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Line Height ({theme['--scale'] || '1.6'})</span>
                  <input
                    type="range"
                    min={1.0}
                    max={2.2}
                    step={0.05}
                    value={parseFloat(theme['--scale'] || '1.6')}
                    onChange={(e) => updateVal('--scale', `${e.target.value}`)}
                    className="w-48 accent-primary"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Font Weight ({theme['--weight'] || '400'})</span>
                  <input
                    type="range"
                    min={100}
                    max={900}
                    step={100}
                    value={parseInt(theme['--weight'] || '400')}
                    onChange={(e) => updateVal('--weight', `${e.target.value}`)}
                    className="w-48 accent-primary"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface-variant">Letter Spacing ({theme['--tracking'] || '0px'})</span>
                  <input
                    type="range"
                    min={-2}
                    max={8}
                    step={0.5}
                    value={parseFloat(theme['--tracking'] || '0')}
                    onChange={(e) => updateVal('--tracking', `${e.target.value}px`)}
                    className="w-48 accent-primary"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
