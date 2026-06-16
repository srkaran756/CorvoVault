// HSL Color Utilities
export function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const hslToHex = (h: number, s: number, l: number) => {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  return hslToHex(h, s, l);
}

export type ThemeStyle = 'light' | 'dark' | 'warm' | 'cool' | 'bold' | 'crow' | 'night';

export function generateAutoTheme(hue: number, style: ThemeStyle): Record<string, string> {
  const h = ((hue % 360) + 360) % 360;
  const comp = (h + 180) % 360;
  const tri1 = (h + 120) % 360;

  switch (style) {
    case 'light':
      return {
        '--bg': hsl(h, 20, 97), '--bg-elev': hsl(h, 15, 94), '--card': '#ffffff',
        '--primary': hsl(h, 70, 40), '--primary-contrast': '#ffffff',
        '--text': hsl(h, 15, 12), '--muted': hsl(h, 10, 50), '--accent': hsl(comp, 75, 50),
        '--danger': hsl(0, 80, 45), '--success': hsl(145, 70, 38), '--border': hsl(h, 15, 85),
        '--chart-1': hsl(h, 60, 45), '--chart-2': hsl(comp, 60, 45), '--chart-3': hsl(tri1, 60, 45),
        '--radius': '12px', '--pad': '24px', '--sidebar': '280px', '--gap': '8px',
        '--size': '16px', '--scale': '1.6', '--weight': '400', '--tracking': '0px',
        '--shadow-alpha': '0.08', '--blur': '12px', '--font-family': 'Inter, sans-serif',
      };
    case 'dark':
      return {
        '--bg': hsl(h, 20, 8), '--bg-elev': hsl(h, 18, 12), '--card': hsl(h, 16, 14),
        '--primary': hsl(h, 80, 65), '--primary-contrast': hsl(h, 20, 8),
        '--text': hsl(h, 10, 92), '--muted': hsl(h, 10, 55), '--accent': hsl(comp, 80, 60),
        '--danger': hsl(0, 85, 62), '--success': hsl(145, 75, 55), '--border': hsl(h, 15, 22),
        '--chart-1': hsl(h, 70, 60), '--chart-2': hsl(comp, 70, 60), '--chart-3': hsl(tri1, 70, 60),
        '--radius': '12px', '--pad': '24px', '--sidebar': '280px', '--gap': '8px',
        '--size': '16px', '--scale': '1.6', '--weight': '400', '--tracking': '0px',
        '--shadow-alpha': '0.08', '--blur': '20px', '--font-family': 'Inter, sans-serif',
      };
    case 'warm':
      return {
        '--bg': hsl(30, 30, 97), '--bg-elev': hsl(28, 25, 93), '--card': hsl(28, 20, 98),
        '--primary': hsl(h, 75, 42), '--primary-contrast': '#ffffff',
        '--text': hsl(20, 25, 15), '--muted': hsl(20, 15, 52), '--accent': hsl(comp, 70, 48),
        '--danger': hsl(5, 78, 48), '--success': hsl(145, 65, 40), '--border': hsl(30, 20, 88),
        '--chart-1': hsl(h, 65, 48), '--chart-2': hsl(h + 30, 65, 48), '--chart-3': hsl(comp, 65, 48),
        '--radius': '12px', '--pad': '24px', '--sidebar': '280px', '--gap': '8px',
        '--size': '16px', '--scale': '1.6', '--weight': '400', '--tracking': '0.2px',
        '--shadow-alpha': '0.08', '--blur': '16px', '--font-family': 'Inter, sans-serif',
      };
    case 'cool':
      return {
        '--bg': hsl(220, 30, 98), '--bg-elev': hsl(220, 25, 95), '--card': '#ffffff',
        '--primary': hsl(h, 75, 48), '--primary-contrast': '#ffffff',
        '--text': hsl(220, 25, 10), '--muted': hsl(220, 15, 52), '--accent': hsl(comp, 72, 52),
        '--danger': hsl(0, 75, 48), '--success': hsl(160, 70, 40), '--border': hsl(220, 20, 88),
        '--chart-1': hsl(h, 65, 50), '--chart-2': hsl(comp, 65, 50), '--chart-3': hsl(tri1, 65, 50),
        '--radius': '12px', '--pad': '24px', '--sidebar': '280px', '--gap': '8px',
        '--size': '16px', '--scale': '1.6', '--weight': '400', '--tracking': '-0.1px',
        '--shadow-alpha': '0.08', '--blur': '12px', '--font-family': 'Inter, sans-serif',
      };
    case 'bold':
      return {
        '--bg': hsl(h, 15, 6), '--bg-elev': hsl(h, 12, 10), '--card': hsl(h, 10, 13),
        '--primary': hsl(h, 90, 58), '--primary-contrast': '#000000',
        '--text': '#ffffff', '--muted': hsl(h, 10, 60), '--accent': hsl(comp, 90, 58),
        '--danger': hsl(0, 90, 60), '--success': hsl(145, 80, 52), '--border': hsl(h, 15, 20),
        '--chart-1': hsl(h, 85, 60), '--chart-2': hsl(comp, 85, 60), '--chart-3': hsl(tri1, 85, 60),
        '--radius': '12px', '--pad': '24px', '--sidebar': '280px', '--gap': '8px',
        '--size': '16px', '--scale': '1.6', '--weight': '500', '--tracking': '0.3px',
        '--shadow-alpha': '0.08', '--blur': '24px', '--font-family': 'Inter, sans-serif',
      };
    case 'crow':
      return {
        '--bg': '#0F1115', '--bg-elev': '#1A1D24', '--card': '#252932',
        '--primary': '#4F46E5', '--primary-contrast': '#ffffff',
        '--text': '#F3F4F6', '--muted': '#9CA3AF', '--accent': '#FCD34D',
        '--danger': '#ef4444', '--success': '#22c55e', '--border': '#2d3139',
        '--chart-1': '#4F46E5', '--chart-2': '#FCD34D', '--chart-3': '#2A4494',
        '--radius': '12px', '--pad': '24px', '--sidebar': '280px', '--gap': '8px',
        '--size': '16px', '--scale': '1.6', '--weight': '400', '--tracking': '0px',
        '--shadow-alpha': '0.08', '--blur': '16px', '--font-family': 'Inter, sans-serif',
      };
    case 'night':
      return {
        '--bg': '#0F1115', '--bg-elev': '#1A1D24', '--card': '#252932',
        '--primary': '#2A4494', '--primary-contrast': '#ffffff',
        '--text': '#F3F4F6', '--muted': '#9CA3AF', '--accent': '#FCD34D',
        '--danger': '#ef4444', '--success': '#22c55e', '--border': '#2d3139',
        '--chart-1': '#2A4494', '--chart-2': '#FCD34D', '--chart-3': '#4F46E5',
        '--radius': '12px', '--pad': '24px', '--sidebar': '280px', '--gap': '8px',
        '--size': '16px', '--scale': '1.6', '--weight': '400', '--tracking': '0px',
        '--shadow-alpha': '0.08', '--blur': '20px', '--font-family': 'Inter, sans-serif',
      };
    default:
      return {};
  }
}
