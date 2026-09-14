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

export async function completeRecovery(paymentLinkUrl: string, paymentLinkId: string) {
  console.log(`🌐 Launching automated payment for: ${paymentLinkUrl} (${paymentLinkId})...`);
  const browser = await puppeteer.launch({
    executablePath: getBrowserExecutablePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(paymentLinkUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));

    const checkoutFrame = page.frames().find((f) => f.url().includes('checkout/public')) || page;

    // Step 1: Type phone number cleanly
    console.log('Step 1: Typing phone number 9988776655...');
    const inputHandle = await checkoutFrame.$('input[type="tel"], input[placeholder*="mobile" i], input');
    if (inputHandle) {
      await inputHandle.click();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('9988776655', { delay: 150 });
    }

    await new Promise((r) => setTimeout(r, 2000));

    // If still on contact screen, click Continue
    await checkoutFrame.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const btn = all.find((el) => (el.textContent || '').trim() === 'Continue' && (el as HTMLElement).offsetParent !== null);
      if (btn) (btn as HTMLElement).click();
    });

    // Step 2: Wait for Payment Options screen
    console.log('Step 2: Waiting for Payment Options screen...');
    await new Promise((r) => setTimeout(r, 4000));
    fs.writeFileSync('rec_step2_options.png', await page.screenshot());

    // Step 3: Click Axis Bank Netbanking option
    console.log('Step 3: Clicking Axis Bank Netbanking...');
    await checkoutFrame.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const bank = all.find((el) => (el.textContent || '').includes('Axis Bank') && (el as HTMLElement).offsetParent !== null);
      if (bank) {
        const target = bank.closest('div[role="button"]') || bank.closest('button') || bank;
        (target as HTMLElement).click();
      }
    });

    await new Promise((r) => setTimeout(r, 2000));
    fs.writeFileSync('rec_step3_bank_clicked.png', await page.screenshot());

    // Step 4: Click Continue/Pay button
    console.log('Step 4: Clicking Pay / Continue button...');
    await checkoutFrame.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const payBtn = all.find(
        (el) =>
          ((el.textContent || '').trim() === 'Continue' ||
            (el.textContent || '').includes('Pay ₹') ||
            (el.textContent || '').includes('Proceed')) &&
          (el as HTMLElement).offsetParent !== null
      );
      if (payBtn) {
        const target = payBtn.closest('button') || payBtn.closest('div[role="button"]') || payBtn;
        (target as HTMLElement).click();
      }
    });

    // Step 5: Handle Test Bank Gateway
    console.log('Step 5: Waiting 6s for Razorpay mock bank gateway...');
    await new Promise((r) => setTimeout(r, 6000));

    const pages = await browser.pages();
    console.log(`Active pages count: ${pages.length}`);

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const url = p.url();
      console.log(`Page ${i} URL: ${url}`);
      if (url === 'about:blank') continue;

      fs.writeFileSync(`rec_page_${i}.png`, await p.screenshot());

      const frames = p.frames();
      for (const f of frames) {
        const successClicked = await f.evaluate(() => {
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

        if (successClicked) {
          console.log(`🎉 SUCCESS BUTTON CLICKED ON PAGE ${i}!`);
          break;
        }
      }
    }

    // Step 6: Wait for settlement
    console.log('Step 6: Waiting 12s for Razorpay API settlement...');
    await new Promise((r) => setTimeout(r, 12000));
    fs.writeFileSync('rec_final.png', await page.screenshot());
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }

  // Step 7: Check official Razorpay API status directly from Razorpay
  console.log('\n📡 Fetching official Razorpay API payment link record...');
  const remoteRecord: any = await rzpClient.paymentLink.fetch(paymentLinkId);
  console.log('\n================ OFFICIAL RAZORPAY API RECORD ================');
  console.log(JSON.stringify(remoteRecord, null, 2));
  console.log('==============================================================\n');

  return remoteRecord;
}

completeRecovery('https://rzp.io/rzp/rGGhYnto', 'plink_TWMLNbZbfzFp7C').catch(console.error);
