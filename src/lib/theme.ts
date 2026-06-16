export const DEFAULT_THEME: Record<string, string> = {
  '--bg': '#f8fafc',
  '--bg-elev': '#f1f5f9',
  '--card': '#ffffff',
  '--primary': '#1e293b',
  '--primary-contrast': '#ffffff',
  '--text': '#0f172a',
  '--muted': '#64748b',
  '--accent': '#3b82f6',
  '--danger': '#ef4444',
  '--success': '#22c55e',
  '--border': '#e2e8f0',
  '--radius': '12px',
  '--pad': '24px',
  '--sidebar': '280px',
  '--gap': '8px',
  '--size': '16px',
  '--scale': '1.6',
  '--weight': '400',
  '--tracking': '0px',
  '--shadow-alpha': '0.08',
  '--chart-1': '#1e4a80',
  '--chart-2': '#b30000',
  '--chart-3': '#000d1f',
  '--blur': '12px',
  '--font-family': 'Inter, sans-serif',
};

export function blendColors(c1: string, c2: string, weight: number): string {
  const parse = (c: string) => {
    let clean = c.replace('#', '').trim();
    if (clean.length === 3) {
      clean = clean.split('').map(x => x + x).join('');
    }
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    return [r, g, b];
  };
  
  try {
    const [r1, g1, b1] = parse(c1);
    const [r2, g2, b2] = parse(c2);
    const r = Math.round(r1 + (r2 - r1) * weight);
    const g = Math.round(g1 + (g2 - g1) * weight);
    const b = Math.round(b1 + (b2 - b1) * weight);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } catch (e) {
    return c1;
  }
}

export function isDarkColor(hex: string): boolean {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(x => x + x).join('');
  }
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma < 128;
}

export function applyThemeToDom(theme: Record<string, string>) {
  const root = document.documentElement;

  // Step 1 — set all raw design tokens (--bg, --primary, etc.)
  Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k.startsWith('--') ? k : `--${k}`, v));

  // Step 2 — derive values
  const bg       = theme['--bg']               || '#f8fafc';
  const bgElev   = theme['--bg-elev']          || '#f1f5f9';
  const card     = theme['--card']             || '#ffffff';
  const primary  = theme['--primary']          || '#1e293b';
  const priCont  = theme['--primary-contrast'] || '#ffffff';
  const text     = theme['--text']             || '#0f172a';
  const muted    = theme['--muted']            || '#64748b';
  const accent   = theme['--accent']           || '#3b82f6';
  const border   = theme['--border']           || '#e2e8f0';
  const radius   = theme['--radius']           || '12px';
  const fontFamily = theme['--font-family']    || 'Inter, sans-serif';
  const fontSize   = theme['--size']           || '16px';
  const fontWeight = theme['--weight']         || '400';
  const tracking   = theme['--tracking']       || '0px';
  const lineHeight = theme['--scale']          || '1.6';

  // Obsidian Neutral Foundation Scale (dynamic blending between bg and text)
  let base00, base05, base10, base20, base30, base40, base50, base60, base100;
  if (isDarkColor(bg)) {
    // Dark mode independent path: blend with pure white to keep base hue clean and avoid muddying with custom text colors
    base00  = bg;
    base05  = blendColors(bg, '#ffffff', 0.04);
    base10  = blendColors(bg, '#ffffff', 0.08);
    base20  = blendColors(bg, '#ffffff', 0.16);
    base30  = blendColors(bg, '#ffffff', 0.28);
    base40  = blendColors(bg, '#ffffff', 0.42);
    base50  = blendColors(bg, '#ffffff', 0.58);
    base60  = blendColors(bg, '#ffffff', 0.72);
    base100 = text;
  } else {
    // Light mode path: blend bg with text (dark text blends into light bg)
    base00  = bg;
    base05  = blendColors(bg, text, 0.05);
    base10  = blendColors(bg, text, 0.10);
    base20  = blendColors(bg, text, 0.20);
    base30  = blendColors(bg, text, 0.30);
    base40  = blendColors(bg, text, 0.40);
    base50  = blendColors(bg, text, 0.50);
    base60  = blendColors(bg, text, 0.60);
    base100 = text;
  }

  root.style.setProperty('--color-base-00', base00);
  root.style.setProperty('--color-base-05', base05);
  root.style.setProperty('--color-base-10', base10);
  root.style.setProperty('--color-base-20', base20);
  root.style.setProperty('--color-base-30', base30);
  root.style.setProperty('--color-base-40', base40);
  root.style.setProperty('--color-base-50', base50);
  root.style.setProperty('--color-base-60', base60);
  root.style.setProperty('--color-base-100', base100);

  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--color-accent-hover', blendColors(accent, text, 0.15));

  // Sync semantic colors
  root.style.setProperty('--color-purple', '#8b5cf6');
  root.style.setProperty('--color-cyan', '#06b6d4');
  root.style.setProperty('--color-green', theme['--success'] || theme['success'] || '#16a34a');
  root.style.setProperty('--color-red', theme['--danger'] || theme['danger'] || '#ef4444');
  root.style.setProperty('--color-orange', '#f97316');

  // Step 3 — sync every Tailwind --color-* token (override compiled @theme static values)
  root.style.setProperty('--color-primary',                   accent);
  root.style.setProperty('--color-primary-container',         base10);
  root.style.setProperty('--color-on-primary',                priCont);
  root.style.setProperty('--color-on-primary-container',      base100);
  root.style.setProperty('--color-secondary',                 accent);
  root.style.setProperty('--color-secondary-container',       base05);
  root.style.setProperty('--color-on-secondary',              priCont);
  root.style.setProperty('--color-on-secondary-container',    base100);
  root.style.setProperty('--color-accent',                    accent);
  root.style.setProperty('--color-on-accent',                 priCont);
  root.style.setProperty('--color-surface',                   base00);
  root.style.setProperty('--color-surface-dim',               base05);
  root.style.setProperty('--color-surface-bright',            base00);
  root.style.setProperty('--color-surface-container-lowest',  base00);
  root.style.setProperty('--color-surface-container-low',     base05);
  root.style.setProperty('--color-surface-container',         base05);
  root.style.setProperty('--color-surface-container-high',    base10);
  root.style.setProperty('--color-surface-container-highest', base20);
  root.style.setProperty('--color-surface-variant',           base05);
  root.style.setProperty('--color-on-surface',                base100);
  root.style.setProperty('--color-on-surface-variant',        base50);
  root.style.setProperty('--color-outline',                   base20);
  root.style.setProperty('--color-outline-variant',           base10);
  root.style.setProperty('--radius-xl',                       radius);

  // Step 4 — update body directly (typography, bg) so font/color changes are frame-perfect
  document.body.style.fontFamily      = fontFamily;
  document.body.style.fontSize        = fontSize;
  document.body.style.fontWeight      = fontWeight;
  document.body.style.letterSpacing   = tracking;
  document.body.style.lineHeight      = lineHeight;
  document.body.style.color           = text;
  document.body.style.backgroundColor = bg;
}
