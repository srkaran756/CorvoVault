import React, { useState, useEffect } from 'react';
import { X, Sigma, Check, Copy, Sparkles } from 'lucide-react';
import { renderKaTeXBlock } from '../MarkdownRenderer';

interface MathInsertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (formattedMath: string) => void;
}

interface FormulaPreset {
  label: string;
  tex: string;
  category: 'basic' | 'calculus' | 'greek' | 'matrices' | 'symbols' | 'physics';
}

const PRESETS: FormulaPreset[] = [
  // Basic
  { label: 'Fraction', tex: '\\frac{a}{b}', category: 'basic' },
  { label: 'Exponent', tex: 'x^{n}', category: 'basic' },
  { label: 'Subscript', tex: 'x_{i}', category: 'basic' },
  { label: 'Square Root', tex: '\\sqrt{x}', category: 'basic' },
  { label: 'N-th Root', tex: '\\sqrt[n]{x}', category: 'basic' },
  { label: 'Binomial', tex: '\\binom{n}{k}', category: 'basic' },
  { label: 'Plus-Minus', tex: '\\pm', category: 'basic' },
  { label: 'Absolute Value', tex: '|x|', category: 'basic' },
  
  // Calculus
  { label: 'Definite Integral', tex: '\\int_{a}^{b} f(x) \\, dx', category: 'calculus' },
  { label: 'Indefinite Integral', tex: '\\int f(x) \\, dx', category: 'calculus' },
  { label: 'Double Integral', tex: '\\iint_{R} f(x,y) \\, dA', category: 'calculus' },
  { label: 'Derivative', tex: '\\frac{d}{dx}\\left( f(x) \\right)', category: 'calculus' },
  { label: 'Partial Derivative', tex: '\\frac{\\partial f}{\\partial x}', category: 'calculus' },
  { label: 'Summation', tex: '\\sum_{i=1}^{n} x_i', category: 'calculus' },
  { label: 'Product', tex: '\\prod_{i=1}^{n} a_i', category: 'calculus' },
  { label: 'Limit', tex: '\\lim_{x \\to \\infty} f(x)', category: 'calculus' },
  { label: 'Infinity', tex: '\\infty', category: 'calculus' },

  // Greek
  { label: 'Alpha (α)', tex: '\\alpha', category: 'greek' },
  { label: 'Beta (β)', tex: '\\beta', category: 'greek' },
  { label: 'Gamma (γ)', tex: '\\gamma', category: 'greek' },
  { label: 'Delta (δ)', tex: '\\delta', category: 'greek' },
  { label: 'Epsilon (ε)', tex: '\\epsilon', category: 'greek' },
  { label: 'Theta (θ)', tex: '\\theta', category: 'greek' },
  { label: 'Lambda (λ)', tex: '\\lambda', category: 'greek' },
  { label: 'Mu (μ)', tex: '\\mu', category: 'greek' },
  { label: 'Pi (π)', tex: '\\pi', category: 'greek' },
  { label: 'Sigma (σ)', tex: '\\sigma', category: 'greek' },
  { label: 'Omega (ω)', tex: '\\omega', category: 'greek' },
  { label: 'Delta (Δ)', tex: '\\Delta', category: 'greek' },
  { label: 'Sigma (Σ)', tex: '\\Sigma', category: 'greek' },
  { label: 'Omega (Ω)', tex: '\\Omega', category: 'greek' },

  // Matrices
  { label: '2x2 Matrix', tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', category: 'matrices' },
  { label: '3x3 Matrix', tex: '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}', category: 'matrices' },
  { label: 'System of Equations', tex: '\\begin{cases} x + y = 1 \\\\ x - y = 0 \\end{cases}', category: 'matrices' },
  { label: 'Bracket Vector', tex: '\\begin{bmatrix} x \\\\ y \\end{bmatrix}', category: 'matrices' },

  // Symbols
  { label: 'Less/Equal', tex: '\\le', category: 'symbols' },
  { label: 'Greater/Equal', tex: '\\ge', category: 'symbols' },
  { label: 'Not Equal', tex: '\\neq', category: 'symbols' },
  { label: 'Approx', tex: '\\approx', category: 'symbols' },
  { label: 'Element Of', tex: '\\in', category: 'symbols' },
  { label: 'Not Element Of', tex: '\\notin', category: 'symbols' },
  { label: 'Subset', tex: '\\subset', category: 'symbols' },
  { label: 'Union', tex: '\\cup', category: 'symbols' },
  { label: 'Intersection', tex: '\\cap', category: 'symbols' },
  { label: 'For All', tex: '\\forall', category: 'symbols' },
  { label: 'Exists', tex: '\\exists', category: 'symbols' },
  { label: 'Implies', tex: '\\Rightarrow', category: 'symbols' },
  { label: 'If and Only If', tex: '\\iff', category: 'symbols' },

  // Physics & Chem
  { label: 'Mass-Energy', tex: 'E = m c^2', category: 'physics' },
  { label: 'Newton Second Law', tex: '\\vec{F} = m \\vec{a}', category: 'physics' },
  { label: 'Vector Arrow', tex: '\\vec{v}', category: 'physics' },
  { label: 'Unit Hat', tex: '\\hat{u}', category: 'physics' },
  { label: 'Mean / Bar', tex: '\\overline{x}', category: 'physics' },
  { label: 'Schrödinger', tex: 'i\\hbar \\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi', category: 'physics' },
];

export default function MathInsertModal({ isOpen, onClose, onInsert }: MathInsertModalProps) {
  const [formula, setFormula] = useState<string>('\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
  const [displayMode, setDisplayMode] = useState<'inline' | 'block'>('block');
  const [activeCategory, setActiveCategory] = useState<'basic' | 'calculus' | 'greek' | 'matrices' | 'symbols' | 'physics'>('basic');
  const [previewHtml, setPreviewHtml] = useState<string>('');

  // Update KaTeX preview HTML when formula or mode changes
  useEffect(() => {
    if (!formula.trim()) {
      setPreviewHtml('<span class="text-outline/50 italic text-xs">Enter LaTeX formula above to see live preview...</span>');
      return;
    }
    const html = renderKaTeXBlock(formula, displayMode === 'block');
    setPreviewHtml(html);
  }, [formula, displayMode]);

  if (!isOpen) return null;

  const handleAppendPreset = (tex: string) => {
    if (!formula.trim()) {
      setFormula(tex);
    } else {
      setFormula(prev => `${prev} ${tex}`);
    }
  };

  const handleConfirmInsert = () => {
    const trimmed = formula.trim();
    if (!trimmed) return;

    let formatted = '';
    if (displayMode === 'block') {
      formatted = `\n$$\n${trimmed}\n$$\n`;
    } else {
      formatted = `$${trimmed}$`;
    }
    onInsert(formatted);
    onClose();
  };

  const categories = [
    { id: 'basic', label: 'Basic' },
    { id: 'calculus', label: 'Calculus' },
    { id: 'greek', label: 'Greek' },
    { id: 'matrices', label: 'Matrices' },
    { id: 'symbols', label: 'Symbols' },
    { id: 'physics', label: 'Physics' },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-fadeIn">
      <div className="bg-surface border border-outline-variant/20 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden text-on-surface">
        
        {/* Header */}
        <div className="p-4 border-b border-outline-variant/15 flex items-center justify-between bg-surface-container-low">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Sigma className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-headline">Math Formula Builder</h3>
              <p className="text-[10px] text-outline">Insert formatted LaTeX equations into your note</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-container-high text-outline hover:text-on-surface transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[75vh]">
          
          {/* Preset Category Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-extrabold uppercase text-outline tracking-wider flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              Formula Presets & Snippets
            </label>
            
            <div className="flex gap-1.5 border-b border-outline-variant/10 pb-2 overflow-x-auto no-scrollbar">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                    activeCategory === cat.id
                      ? 'bg-primary text-on-primary shadow-xs'
                      : 'bg-surface-container-low text-outline hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {PRESETS.filter(p => p.category === activeCategory).map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => handleAppendPreset(preset.tex)}
                  className="px-2.5 py-1.5 rounded-lg bg-surface-container-low hover:bg-primary/10 border border-outline-variant/15 hover:border-primary/30 text-xs text-on-surface font-medium text-left truncate transition-all cursor-pointer flex items-center justify-between group"
                  title={`Insert ${preset.tex}`}
                >
                  <span className="truncate">{preset.label}</span>
                  <span className="text-[10px] font-mono text-outline group-hover:text-primary shrink-0 ml-1">+</span>
                </button>
              ))}
            </div>
          </div>

          {/* Formula TeX Editor */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-extrabold uppercase text-outline tracking-wider">
                LaTeX Formula Source Code
              </label>
              
              {/* Display Mode Toggle */}
              <div className="flex bg-surface-container-low p-0.5 rounded-lg border border-outline-variant/20">
                <button
                  onClick={() => setDisplayMode('inline')}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    displayMode === 'inline' ? 'bg-primary text-on-primary' : 'text-outline hover:text-on-surface'
                  }`}
                  title="Inline math inside text paragraph ($...$)"
                >
                  Inline ($)
                </button>
                <button
                  onClick={() => setDisplayMode('block')}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    displayMode === 'block' ? 'bg-primary text-on-primary' : 'text-outline hover:text-on-surface'
                  }`}
                  title="Centered display block ($$...$$)"
                >
                  Block ($$)
                </button>
              </div>
            </div>

            <textarea
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="Type LaTeX math (e.g. \frac{a}{b}, \int_0^1 x^2 dx)..."
              rows={3}
              className="w-full font-mono text-xs p-3 rounded-xl bg-surface-container-low border border-outline-variant/20 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-on-surface outline-none resize-none transition-all"
            />
          </div>

          {/* Live KaTeX Rendered Preview */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-extrabold uppercase text-outline tracking-wider">
              Live KaTeX Rendered Preview
            </label>
            <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/20 flex items-center justify-center min-h-[90px] overflow-x-auto select-text">
              <div 
                className="w-full flex justify-center overflow-x-auto select-text"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-outline-variant/15 bg-surface-container-low flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmInsert}
            disabled={!formula.trim()}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            Insert Formula
          </button>
        </div>

      </div>
    </div>
  );
}
