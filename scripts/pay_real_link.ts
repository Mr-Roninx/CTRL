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

export async function payRazorpayPaymentLink(paymentLinkUrl: string, paymentLinkId: string) {
  console.log(`🌐 Opening live Razorpay checkout: ${paymentLinkUrl} (${paymentLinkId})...`);
  const executablePath = getBrowserExecutablePath();

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    console.log(`Navigating to ${paymentLinkUrl}...`);
    await page.goto(paymentLinkUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    await new Promise((r) => setTimeout(r, 4000));

    // Log frames
    const frames = page.frames();
    console.log(`Found ${frames.length} frames on page.`);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      console.log(`Frame ${i} URL:`, f.url().slice(0, 80));
    }

    // Step 1: Click on UPI option
    console.log('Step 1: Selecting UPI payment method...');
    for (const frame of frames) {
      await frame.evaluate(() => {
        const els = Array.from(document.querySelectorAll('*'));
        for (const el of els) {
          const txt = (el.textContent || '').trim();
          if (txt === 'UPI' || txt === 'UPI / QR' || txt === 'UPI - Google Pay, PhonePe, Paytm, BHIM' || txt.includes('UPI')) {
            const clickTarget = el.closest('button') || el.closest('div[role="button"]') || el.closest('li') || el;
            (clickTarget as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
    }

    await new Promise((r) => setTimeout(r, 3000));

    // Step 2: Fill UPI ID input with success@razorpay
    console.log('Step 2: Entering UPI ID: success@razorpay...');
    let vpaTyped = false;
    for (const frame of frames) {
      const typed = await frame.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const input of inputs) {
          if (
            input.type === 'text' ||
            input.placeholder.toLowerCase().includes('upi') ||
            input.name === 'vpa' ||
            input.id.includes('vpa') ||
            input.getAttribute('autocomplete') === 'upi-vpa'
          ) {
            input.focus();
            input.value = 'success@razorpay';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      });
      if (typed) {
        vpaTyped = true;
        console.log('Successfully set VPA input value in frame');
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 2000));

    // Step 3: Click the Pay / Continue button
    console.log('Step 3: Clicking Pay Now button...');
    for (const frame of frames) {
      await frame.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"], a'));
        for (const btn of btns) {
          const txt = (btn.textContent || '').trim();
          if (txt.includes('Pay') || txt.includes('Continue') || txt.includes('Proceed') || txt.includes('Verify')) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
    }

    // Step 4: Wait for Razorpay test mode payment to process and confirm
    console.log('Step 4: Waiting for payment gateway settlement in Razorpay Test Mode...');
    await new Promise((r) => setTimeout(r, 10000));

    // Capture screenshot if needed
    const screenshotBuf = await page.screenshot();
    fs.writeFileSync('payment_result_screenshot.png', screenshotBuf);
    console.log('Captured payment screen to payment_result_screenshot.png');
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }

  // Step 5: Query official Razorpay API directly
  console.log('\n📡 Fetching official Razorpay API payment link record...');
  const checkPlink: any = await rzpClient.paymentLink.fetch(paymentLinkId);
  console.log('\n================ OFFICIAL RAZORPAY API RECORD ================');
  console.log(JSON.stringify(checkPlink, null, 2));
  console.log('==============================================================\n');

  return checkPlink;
}

if (process.argv[1]?.includes('inspect_frame_dom') || process.argv[1]?.includes('pay_real_link')) {
  const testUrl = process.argv[2] || 'https://rzp.io/rzp/rGGhYnto';
  const testId = process.argv[3] || 'plink_TWMLNbZbfzFp7C';
  payRazorpayPaymentLink(testUrl, testId).catch(console.error);
}
