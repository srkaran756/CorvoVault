/**
 * copy-pdfjs-worker.js
 * 
 * Copies the pdfjs-dist web worker file into the public directory
 * so it can be served by the Electron app without CDN dependency.
 * 
 * Run: node scripts/copy-pdfjs-worker.js
 * When: After npm install, and before electron:build
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
const dest = path.join(__dirname, '..', 'public', 'pdf.worker.mjs');

// Fallback: try .js extension if .mjs doesn't exist
const srcFallback = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.js');

let sourceFile = src;
if (!fs.existsSync(src)) {
  if (fs.existsSync(srcFallback)) {
    sourceFile = srcFallback;
  } else {
    console.error('[copy-pdfjs-worker] ERROR: Could not find pdf.worker file in node_modules.');
    console.error('  Tried:', src);
    console.error('  Tried:', srcFallback);
    process.exit(1);
  }
}

fs.copyFileSync(sourceFile, dest);
console.log(`[copy-pdfjs-worker] Copied ${path.basename(sourceFile)} → public/pdf.worker.mjs`);
