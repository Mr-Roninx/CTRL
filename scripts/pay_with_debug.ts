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

export async function completeRazorpayTestPayment(paymentLinkUrl: string, paymentLinkId: string) {
  console.log(`🌐 Starting real payment completion for: ${paymentLinkUrl} (${paymentLinkId})...`);
  const browser = await puppeteer.launch({
    executablePath: getBrowserExecutablePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    await page.setViewport({ width: 1280, height: 900 });

    console.log('Navigating to checkout...');
    await page.goto(paymentLinkUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));

    const checkoutFrame = page.frames().find((f) => f.url().includes('checkout/public')) || page;

    // Step 1: Fill Phone Number
    console.log('Step 1: Filling contact number 9988776655...');
    const inputHandle = await checkoutFrame.$('input[type="tel"], input');
    if (inputHandle) {
      await inputHandle.click();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('9988776655', { delay: 100 });
    }

    await new Promise((r) => setTimeout(r, 1000));

    // Click Continue
    console.log('Clicking Continue on Contact screen...');
    await checkoutFrame.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
      for (const btn of btns) {
        if ((btn.textContent || '').trim() === 'Continue') {
          (btn as HTMLElement).click();
          return;
        }
      }
    });

    // Step 2: Wait for Payment Options screen
    console.log('Step 2: Waiting for Payment Options screen...');
    await new Promise((r) => setTimeout(r, 4000));

    // Step 3: Select Netbanking (Axis Bank)
    console.log('Step 3: Selecting Axis Bank Netbanking...');
    await checkoutFrame.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        if ((el.textContent || '').includes('Axis Bank Netbanking')) {
          const target = el.closest('div[role="button"]') || el.closest('button') || el.closest('div') || el;
          (target as HTMLElement).click();
          return;
        }
      }
    });

    await new Promise((r) => setTimeout(r, 2000));

    // Click Pay button
    console.log('Step 4: Clicking Pay button...');
    await checkoutFrame.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, div[role="button"], a, div'));
      for (const el of els) {
        const txt = (el.textContent || '').trim();
        if (txt === 'Continue' || txt.includes('Pay ₹') || txt.includes('Proceed')) {
          (el as HTMLElement).click();
          return;
        }
      }
    });

    // Step 5: Handle mock bank page (in popup or in main window)
    console.log('Step 5: Waiting 6s for mock bank simulator...');
    await new Promise((r) => setTimeout(r, 6000));

    const allPages = await browser.pages();
    console.log(`Active pages count: ${allPages.length}`);

    let clicked = false;
    for (let i = 0; i < allPages.length; i++) {
      const p = allPages[i];
      const url = p.url();
      console.log(`Page ${i} URL: ${url}`);
      if (url === 'about:blank') continue;

      fs.writeFileSync(`active_page_${i}.png`, await p.screenshot());

      const frames = p.frames();
      for (const f of frames) {
        const successClicked = await f.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a, div[role="button"]'));
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
          clicked = true;
          break;
        }
      }
    }

    // Step 6: Wait for Razorpay to process settlement and redirect
    console.log('Step 6: Waiting 12s for Razorpay settlement...');
    await new Promise((r) => setTimeout(r, 12000));
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

completeRazorpayTestPayment('https://rzp.io/rzp/rGGhYnto', 'plink_TWMLNbZbfzFp7C').catch(console.error);
