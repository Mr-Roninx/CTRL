const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const destDir = 'C:\\Users\\ripra\\AppData\\Local\\ms-playwright-go\\1.57.0';

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// 1. Copy node.exe
const nodeSource = process.execPath;
const nodeDest = path.join(destDir, 'node.exe');
fs.copyFileSync(nodeSource, nodeDest);
console.log('✅ Copied node.exe to:', nodeDest);

// 2. Download playwright-core 1.57.0 tgz
const tgzUrl = 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.57.0.tgz';
const tgzPath = path.join(destDir, 'playwright-core.tgz');

console.log('⬇️ Downloading playwright-core 1.57.0 from npm registry...');
const file = fs.createWriteStream(tgzPath);
https.get(tgzUrl, (response) => {
  response.pipe(file);
  file.on('finish', () => {
    file.close(() => {
      console.log('✅ Downloaded playwright-core.tgz');
      
      // 3. Extract tarball using tar
      console.log('📦 Extracting package into:', destDir);
      try {
        execSync(`tar -xzf "${tgzPath}" -C "${destDir}"`, { stdio: 'inherit' });
        console.log('✅ Extracted successfully');
      } catch (err) {
        console.error('❌ Extraction failed:', err.message);
        process.exit(1);
      }

      // 4. Verify version
      const cliPath = path.join(destDir, 'package', 'cli.js');
      if (fs.existsSync(cliPath)) {
        const verOutput = execSync(`"${nodeDest}" "${cliPath}" --version`).toString();
        console.log('🎉 Playwright driver version verified:', verOutput.trim());
      } else {
        console.error('❌ package/cli.js not found!');
      }
    });
  });
}).on('error', (err) => {
  console.error('❌ Download failed:', err.message);
});
