import dotenv from 'dotenv';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { buildOtpVerificationHtml } from '../src/notifications/email.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  console.log('\n======================================================================');
  console.log('📧 CTRL GMAIL SMTP VERIFICATION & OTP DISPATCH TEST');
  console.log('======================================================================\n');

  const smtpUser = process.env.SMTP_USER?.trim();
  const rawSmtpPass = process.env.SMTP_PASS?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const isGmail = (process.env.SMTP_SERVICE?.toLowerCase() === 'gmail') || smtpHost.includes('gmail');
  const smtpPass = isGmail && rawSmtpPass ? rawSmtpPass.replace(/\s+/g, '') : rawSmtpPass;
  const port = Number(process.env.SMTP_PORT) || 465;
  const isSecure = process.env.SMTP_SECURE !== undefined ? process.env.SMTP_SECURE === 'true' : port === 465;

  console.log(`Configured Host : ${smtpHost}:${port} (secure: ${isSecure})`);
  console.log(`Sender / User   : ${smtpUser || 'NOT SET'}`);
  console.log(`Password status : ${smtpPass ? 'SET (' + smtpPass.length + ' chars)' : 'NOT SET'}`);

  if (!smtpUser || !smtpPass) {
    console.error('\n❌ ERROR: SMTP_USER and SMTP_PASS must be configured in your .env file.');
    console.error('To use Gmail:');
    console.error('1. Generate a 16-character Google App Password at: https://myaccount.google.com/apppasswords');
    console.error('2. Add to your .env:');
    console.error('   SMTP_SERVICE=gmail');
    console.error('   SMTP_HOST=smtp.gmail.com');
    console.error('   SMTP_PORT=465');
    console.error('   SMTP_SECURE=true');
    console.error('   SMTP_USER=your_email@gmail.com');
    console.error('   SMTP_PASS=your_16_character_app_password');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port,
    secure: isSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  console.log('\n1. Verifying SMTP connection handshake with server...');
  try {
    await transporter.verify();
    console.log('✅ Connection verified! Handshake and authentication succeeded.');
  } catch (verifyErr: any) {
    console.error('❌ Connection handshake failed:', verifyErr.message);
    if (isGmail && verifyErr.message.includes('535')) {
      console.error('\n💡 Tip: Gmail error 535 indicates an invalid username or password.');
      console.error('   Ensure you are using a 16-character Google App Password (NOT your personal Google account password).');
      console.error('   Generate one at: https://myaccount.google.com/apppasswords');
    }
    process.exit(1);
  }

  // Determine recipient: command-line argument, or valid email from SMTP_USER
  const targetRecipient = process.argv[2] || (smtpUser && smtpUser.includes('@') ? smtpUser : null);

  if (!targetRecipient) {
    console.log('\nℹ️ No recipient email provided. To send a real test email, run:');
    console.log('   npx tsx scripts/test_gmail_smtp.ts your-email@gmail.com');
    console.log('\n✅ Handshake test passed successfully! Ready for real email dispatch.\n');
    process.exit(0);
  }

  const testOtp = Math.floor(100000 + Math.random() * 900000).toString();

  console.log(`\n2. Dispatching sample OTP verification email to: ${targetRecipient}...`);
  const html = buildOtpVerificationHtml({ otp: testOtp, expiresInMinutes: 10 });

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `CTRL Recovery <${smtpUser}>`,
      to: targetRecipient,
      subject: `${testOtp} is your CTRL verification code`,
      html,
    });

    console.log('✅ OTP email dispatched successfully!');
    console.log(`   Message ID   : ${info.messageId}`);
    console.log(`   Response     : ${info.response}`);
    console.log(`   Generated OTP: ${testOtp}`);
    console.log('\n🎉 Gmail SMTP is fully operational and delivering OTPs to real inboxes!\n');
  } catch (sendErr: any) {
    console.error('❌ Failed to dispatch email:', sendErr.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
