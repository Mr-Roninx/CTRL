import { chromium } from 'playwright';
import path from 'node:path';

async function verifyMotionGraph() {
  console.log('🚀 Launching Playwright Chromium in 1920x1080 for Motion Graph test...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const filePath = 'file:///' + path.resolve(process.cwd(), 'Pitch', 'video.html').replace(/\\/g, '/');
  console.log(`🌐 Navigating to: ${filePath}`);

  await page.goto(filePath, { waitUntil: 'domcontentloaded' });

  // 1. Verify Title
  const title = await page.title();
  console.log(`✓ Page Title: "${title}"`);
  if (!title.includes('CTRL')) throw new Error('Title does not match');

  // 2. Check Canvas Viewport Dimensions
  const canvasBox = await page.$eval('#canvas-viewport', el => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  console.log(`✓ Canvas Dimensions: ${canvasBox.width}x${canvasBox.height}`);
  if (canvasBox.width !== 1920 || canvasBox.height !== 1080) {
    throw new Error(`Expected 1920x1080, got ${canvasBox.width}x${canvasBox.height}`);
  }

  // 3. Verify Act 1 is initially active
  const act1Active = await page.$eval('#scene-act-1', el => el.classList.contains('active'));
  console.log(`✓ Act 1 active on load: ${act1Active}`);
  if (!act1Active) throw new Error('Act 1 not active on load');

  await page.waitForTimeout(600);
  const snap1 = path.resolve(process.cwd(), 'Pitch', 'motion_act_1_problem.png');
  await page.screenshot({ path: snap1 });
  console.log(`📸 Saved Act 1 Screenshot: ${snap1}`);

  // 4. Test Key '2' -> Act 2 (The Paradigm Shift & IVEN)
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(600);
  const act2Active = await page.$eval('#scene-act-2', el => el.classList.contains('active'));
  console.log(`✓ Key '2' -> Act 2 active: ${act2Active}`);
  if (!act2Active) throw new Error('Act 2 not active');
  const snap2 = path.resolve(process.cwd(), 'Pitch', 'motion_act_2_economics.png');
  await page.screenshot({ path: snap2 });
  console.log(`📸 Saved Act 2 Screenshot: ${snap2}`);

  // 5. Test Key '3' -> Act 3 (7-Stage Pipeline)
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(600);
  const act3Active = await page.$eval('#scene-act-3', el => el.classList.contains('active'));
  console.log(`✓ Key '3' -> Act 3 active: ${act3Active}`);
  if (!act3Active) throw new Error('Act 3 not active');
  const snap3 = path.resolve(process.cwd(), 'Pitch', 'motion_act_3_pipeline.png');
  await page.screenshot({ path: snap3 });
  console.log(`📸 Saved Act 3 Screenshot: ${snap3}`);

  // 6. Test Key '4' -> Act 4 (Decision Triad & Knapsack)
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(600);
  const act4Active = await page.$eval('#scene-act-4', el => el.classList.contains('active'));
  console.log(`✓ Key '4' -> Act 4 active: ${act4Active}`);
  if (!act4Active) throw new Error('Act 4 not active');
  const snap4 = path.resolve(process.cwd(), 'Pitch', 'motion_act_4_triad.png');
  await page.screenshot({ path: snap4 });
  console.log(`📸 Saved Act 4 Screenshot: ${snap4}`);

  // 7. Test Key '5' -> Act 5 (Action Authority Veto)
  await page.keyboard.press('Digit5');
  await page.waitForTimeout(600);
  const act5Active = await page.$eval('#scene-act-5', el => el.classList.contains('active'));
  console.log(`✓ Key '5' -> Act 5 active: ${act5Active}`);
  if (!act5Active) throw new Error('Act 5 not active');
  const snap5 = path.resolve(process.cwd(), 'Pitch', 'motion_act_5_authority.png');
  await page.screenshot({ path: snap5 });
  console.log(`📸 Saved Act 5 Screenshot: ${snap5}`);

  // 8. Test Key '6' -> Act 6 (Causal Truth & Ledger)
  await page.keyboard.press('Digit6');
  await page.waitForTimeout(600);
  const act6Active = await page.$eval('#scene-act-6', el => el.classList.contains('active'));
  console.log(`✓ Key '6' -> Act 6 active: ${act6Active}`);
  if (!act6Active) throw new Error('Act 6 not active');
  const snap6 = path.resolve(process.cwd(), 'Pitch', 'motion_act_6_truth.png');
  await page.screenshot({ path: snap6 });
  console.log(`📸 Saved Act 6 Screenshot: ${snap6}`);

  // 9. Test Space (Play/Pause) & 'R' (Restart)
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);

  const act1Restored = await page.$eval('#scene-act-1', el => el.classList.contains('active'));
  console.log(`✓ Key 'R' -> Reset back to Act 1: ${act1Restored}`);
  if (!act1Restored) throw new Error('Reset failed');

  await browser.close();
  console.log('🎉 1920x1080 Motion Graph Verification PASSED COMPLETELY!');
}

verifyMotionGraph().catch(err => {
  console.error('❌ Motion Graph verification failed:', err);
  process.exit(1);
});
