const fs = require('fs');
const path = require('path');
const https = require('https');

const publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const files = [
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    dest: path.join(publicDir, 'pdf.min.js')
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    dest: path.join(publicDir, 'pdf.worker.min.js')
  }
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} to ${dest}...`);
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`Saved successfully: ${dest}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function run() {
  try {
    for (const f of files) {
      await downloadFile(f.url, f.dest);
    }
    console.log('All PDF.js scripts downloaded successfully!');
  } catch (err) {
    console.error('Download failed:', err);
    process.exit(1);
  }
}

run();
