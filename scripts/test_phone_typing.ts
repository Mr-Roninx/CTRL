import puppeteer from 'puppeteer-core';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function getBrowserExecutablePath(): string {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (fs.existsSync(chromePath)) return chromePath;
  if (fs.existsSync(edgePath)) return edgePath;
  throw new Error('Neither Chrome nor Edge found on system');
}

async function testPhoneTyping() {
  const browser = await puppeteer.launch({
    executablePath: getBrowserExecutablePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto('https://rzp.io/rzp/rGGhYnto', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));

    const checkoutFrame = page.frames().find((f) => f.url().includes('checkout/public')) || page;

    // Click input
    const inputHandle = await checkoutFrame.$('input[type="tel"], input[placeholder*="mobile" i], input');
    if (inputHandle) {
      await inputHandle.click();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('9988776655', { delay: 150 });
    }

    await new Promise((r) => setTimeout(r, 1000));
    fs.writeFileSync('test_phone_typed_clean.png', await page.screenshot());

    // Click continue
    const continueBtn = await checkoutFrame.$('button[type="submit"], button, div[role="button"]');
    if (continueBtn) {
      await continueBtn.click();
    }

    await new Promise((r) => setTimeout(r, 4000));
    fs.writeFileSync('test_after_continue.png', await page.screenshot());
    console.log('Saved test_after_continue.png');
  } finally {
    await browser.close();
  }
}

testPhoneTyping().catch(console.error);
