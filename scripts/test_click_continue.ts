import puppeteer from 'puppeteer-core';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { rzpClient } from '../src/execution/executor.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function getBrowserExecutablePath(): string {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (fs.existsSync(chromePath)) return chromePath;
  if (fs.existsSync(edgePath)) return edgePath;
  throw new Error('Neither Chrome nor Edge found on system');
}

async function testClickContinue() {
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

    // Type phone
    const inputHandle = await checkoutFrame.$('input[type="tel"], input[placeholder*="mobile" i], input');
    if (inputHandle) {
      await inputHandle.click();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('9988776655', { delay: 150 });
    }

    await new Promise((r) => setTimeout(r, 4000));

    const iframeHandle = await page.$('iframe[src*="checkout/public"], iframe');
    const iframeBox = iframeHandle ? await iframeHandle.boundingBox() : { x: 717.5, y: 40 };

    // Step 1: Click Axis Bank row at pixel offset inside iframe
    const axisCoord = await checkoutFrame.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const axis = all.find((el) => (el.textContent || '').trim().startsWith('Axis Bank') && (el as HTMLElement).offsetParent !== null);
      if (axis) {
        const rect = axis.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return null;
    });

    console.log('Axis Bank coordinates:', axisCoord);
    if (axisCoord && iframeBox) {
      console.log(`Clicking Axis Bank at (${iframeBox.x + axisCoord.x}, ${iframeBox.y + axisCoord.y})...`);
      await page.mouse.click(iframeBox.x + axisCoord.x, iframeBox.y + axisCoord.y);
    }

    await new Promise((r) => setTimeout(r, 2000));
    fs.writeFileSync('step_axis_selected.png', await page.screenshot());

    // Step 2: Click Continue button
    const btnCoords = await checkoutFrame.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const btn = all.find((el) => (el.textContent || '').trim() === 'Continue' && (el as HTMLElement).offsetParent !== null);
      if (btn) {
        const rect = btn.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return null;
    });

    if (btnCoords && iframeBox) {
      console.log(`Clicking Continue at (${iframeBox.x + btnCoords.x}, ${iframeBox.y + btnCoords.y})...`);
      await page.mouse.click(iframeBox.x + btnCoords.x, iframeBox.y + btnCoords.y);
    }

    // Step 3: Wait for Bank simulation
    console.log('Waiting 8s for Bank Simulation page...');
    await new Promise((r) => setTimeout(r, 8000));

    const pages = await browser.pages();
    console.log('Total pages after bank launch:', pages.length);

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (p.url() === 'about:blank') continue;
      console.log(`Page ${i} URL:`, p.url());
      fs.writeFileSync(`bank_page_${i}.png`, await p.screenshot());

      const frames = p.frames();
      for (const f of frames) {
        const clicked = await f.evaluate(() => {
          const btns = Array.from(
            document.querySelectorAll('button, input[type="button"], input[type="submit"], a, div[role="button"]')
          );
          for (const btn of btns) {
            const txt = (btn.textContent || (btn as HTMLInputElement).value || '').trim().toLowerCase();
            if (txt === 'success' || txt.includes('success') || txt === 'successful') {
              (btn as HTMLElement).click();
              return true;
            }
          }
          return false;
        });
        if (clicked) {
          console.log(`🎉 CLICKED SUCCESS ON PAGE ${i}!`);
          break;
        }
      }
    }

    await new Promise((r) => setTimeout(r, 10000));
  } finally {
    await browser.close();
  }

  const checkPlink: any = await rzpClient.paymentLink.fetch('plink_TWMLNbZbfzFp7C');
  console.log('\n================ OFFICIAL RAZORPAY API RECORD ================');
  console.log(JSON.stringify(checkPlink, null, 2));
  console.log('==============================================================\n');
}

testClickContinue().catch(console.error);
