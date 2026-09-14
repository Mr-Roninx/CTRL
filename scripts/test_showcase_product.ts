import { chromium } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

async function waitForServer(url: string, maxRetries = 20): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // Waiting
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function testShowcaseProduct() {
  console.log('🚀 Starting Next.js server on port 3007 for Showcase E2E test...');
  const nextProcess: ChildProcess = spawn('npx', ['next', 'start', '-p', '3007'], {
    cwd: path.resolve(process.cwd(), 'frontend'),
    shell: true,
    stdio: 'inherit',
  });

  const isUp = await waitForServer('http://localhost:3007/showcase');
  if (!isUp) {
    if (nextProcess.pid) spawn('taskkill', ['/PID', nextProcess.pid.toString(), '/T', '/F'], { shell: true });
    throw new Error('Next.js server failed to respond on http://localhost:3007/showcase');
  }
  console.log('✓ Next.js server is UP on http://localhost:3007');

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    console.log('🌐 Navigating to http://localhost:3007/showcase ...');
    await page.goto('http://localhost:3007/showcase', { waitUntil: 'domcontentloaded' });

    // 1. Verify Title & Header
    const title = await page.title();
    console.log(`✓ Showcase Title: "${title}"`);

    // 2. Test Mode Switcher: Click Legacy Gateway Retries
    const legacyBtn = page.locator('button:has-text("Legacy Gateway Retries")');
    await legacyBtn.click();
    await page.waitForTimeout(300);
    const legacyText = await page.textContent('text=Naive Sequential Loop');
    console.log(`✓ Switched to Legacy Mode: "${legacyText}"`);
    if (!legacyText) throw new Error('Legacy mode switch failed');

    // Switch back to CTRL mode
    const ctrlBtn = page.locator('button:has-text("CTRL Autonomous Mode")');
    await ctrlBtn.click();
    await page.waitForTimeout(300);
    const ctrlText = await page.textContent('text=Microeconomic Knapsack');
    console.log(`✓ Switched back to CTRL Mode: "${ctrlText}"`);

    // Capture Hero screenshot
    const snapHero = path.resolve(process.cwd(), 'Pitch', 'showcase_hero_mode.png');
    await page.screenshot({ path: snapHero, clip: { x: 0, y: 0, width: 1440, height: 850 } });
    console.log(`📸 Saved Hero Screenshot: ${snapHero}`);

    // 3. Test Failure Lab Scenarios
    console.log('🧪 Testing Failure Lab Scenarios...');
    // Click Stolen Card
    const stolenBtn = page.locator('button:has-text("Stolen Card")');
    await stolenBtn.click();
    await page.waitForTimeout(2000); // Wait for simulation animation
    const stolenBadge = await page.textContent('text=ABSTAIN / BLOCKED');
    console.log(`✓ Stolen Card Scenario Verdict: "${stolenBadge}"`);
    if (!stolenBadge) throw new Error('Stolen card did not resolve to ABSTAIN / BLOCKED');

    // Click Insufficient Funds Attempt #3
    const fundsAtt3Btn = page.locator('button:has-text("Insufficient Funds Attempt #3")');
    await fundsAtt3Btn.click();
    await page.waitForTimeout(2000);
    const waitBadge = await page.textContent('text=WAIT / DEFERRED');
    console.log(`✓ Funds Att #3 Scenario Verdict: "${waitBadge}"`);
    if (!waitBadge) throw new Error('Funds Att #3 did not resolve to WAIT / DEFERRED');

    // Click Corp Software License
    const licenseBtn = page.locator('button:has-text("Annual Corporate Software License")');
    await licenseBtn.click();
    await page.waitForTimeout(2000);
    const actBadge = await page.textContent('text=ACT / ALLOCATED (RANK #1)');
    console.log(`✓ Corp License Scenario Verdict: "${actBadge}"`);
    if (!actBadge) throw new Error('Corp License did not resolve to ACT / ALLOCATED (RANK #1)');

    // Capture Failure Lab screenshot
    const labEl = page.locator('#failure-lab');
    const snapLab = path.resolve(process.cwd(), 'Pitch', 'showcase_failure_lab.png');
    await labEl.screenshot({ path: snapLab });
    console.log(`📸 Saved Failure Lab Screenshot: ${snapLab}`);

    // 4. Test Bento Grid: Simulate Settlement Block
    const mineBtn = page.locator('button:has-text("+ Simulate Settlement")');
    await mineBtn.click();
    await page.waitForTimeout(300);
    const blockText = await page.textContent('text=BLOCK #3');
    console.log(`✓ Mined New Cryptographic Block: "${blockText}"`);

    // Capture Bento Grid
    const bentoEl = page.locator('#bento-grid');
    const snapBento = path.resolve(process.cwd(), 'Pitch', 'showcase_bento_grid.png');
    await bentoEl.screenshot({ path: snapBento });
    console.log(`📸 Saved Bento Grid Screenshot: ${snapBento}`);

    // Capture Full Page
    const snapFull = path.resolve(process.cwd(), 'Pitch', 'showcase_full_page.png');
    await page.screenshot({ path: snapFull, fullPage: true });
    console.log(`📸 Saved Full Showcase Screenshot: ${snapFull}`);

    console.log('🎉 All Next.js Motion Graphics SaaS Product Showcase Tests PASSED completely!');
  } finally {
    await browser.close();
    if (nextProcess.pid) {
      spawn('taskkill', ['/PID', nextProcess.pid.toString(), '/T', '/F'], { shell: true });
    }
  }
}

testShowcaseProduct().catch(err => {
  console.error('❌ Showcase product test failed:', err);
  process.exit(1);
});
