import fs from 'node:fs';
import path from 'node:path';

function scanDir(dir: string, matches: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, matches);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      if (entry.name === 'verify_no_fake_webhooks.ts') continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (content.includes('/webhooks/razorpay')) {
        matches.push(fullPath);
      }
    }
  }
}

console.log('🔍 Running Tripwire: Checking scripts/ directory for forbidden POST /webhooks/razorpay references...');
const forbiddenMatches: string[] = [];
scanDir(path.resolve(process.cwd(), 'scripts'), forbiddenMatches);

if (forbiddenMatches.length > 0) {
  console.error('\n❌ VIOLATION DETECTED: The following test script(s) reference /webhooks/razorpay:');
  for (const file of forbiddenMatches) {
    console.error(`   - ${file}`);
  }
  console.error('Test scripts MUST use /internal/simulate-webhook to prevent data contamination.');
  process.exit(1);
}

console.log('✅ PASS: Zero scripts reference /webhooks/razorpay. Test simulation traffic is strictly isolated.');
