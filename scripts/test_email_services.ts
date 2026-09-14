import { 
  buildSignupConfirmationHtml, 
  sendSignupConfirmationEmail, 
  buildPaymentRelinkHtml, 
  sendPaymentRelinkEmail 
} from '../src/notifications/email.js';

async function main() {
  console.log('--- Testing CTRL Email Services ---');

  // 1. Test Signup Confirmation HTML builder
  const signupHtml = buildSignupConfirmationHtml({
    email: 'merchant@example.com',
    businessName: 'Apex Commerce Inc',
    userName: 'Apex Store Admin',
    loginUrl: 'https://ctrl.internal/login',
  });
  console.log('✅ Service 1 (Confirm Signup): HTML generated successfully. Length:', signupHtml.length);
  if (!signupHtml.includes('Apex Commerce Inc') || !signupHtml.includes('merchant@example.com')) {
    throw new Error('Signup HTML missing key parameters');
  }

  // 2. Test Payment Relink HTML builder
  const relinkHtml = buildPaymentRelinkHtml({
    to: 'customer@example.com',
    customerName: 'Aarav Patel',
    amountPaise: 849900,
    currency: 'INR',
    recoveryUrl: 'https://rzp.io/i/plink_demo_recovery_123',
    opportunityId: 'opp_demo_test_999',
    reasonCode: 'insufficient_funds',
    merchantName: 'Apex Commerce Inc',
  });
  console.log('✅ Service 2 (Send Relink to Pay): HTML generated successfully. Length:', relinkHtml.length);
  if (!relinkHtml.includes('₹8,499.00') || !relinkHtml.includes('plink_demo_recovery_123')) {
    throw new Error('Relink HTML missing amount or recovery URL');
  }

  const testRecipient = process.env.SMTP_USER || 'merchant@example.com';

  // 3. Test Signup Confirmation Email Dispatch
  console.log('Testing sendSignupConfirmationEmail dispatch to:', testRecipient);
  const signupResult = await sendSignupConfirmationEmail({
    email: testRecipient,
    businessName: 'Apex Commerce Inc',
    userName: 'Apex Store Admin',
  });
  console.log('✅ Service 1 Dispatch Result:', signupResult);

  // 4. Test Payment Relink Email Dispatch
  console.log('Testing sendPaymentRelinkEmail dispatch to:', testRecipient);
  const relinkResult = await sendPaymentRelinkEmail({
    to: testRecipient,
    customerName: 'Aarav Patel',
    amountPaise: 849900,
    currency: 'INR',
    recoveryUrl: 'https://rzp.io/i/plink_demo_recovery_123',
    opportunityId: 'opp_demo_test_999',
    reasonCode: 'insufficient_funds',
    merchantName: 'Apex Commerce Inc',
  });
  console.log('✅ Service 2 Dispatch Result:', relinkResult);

  console.log('🎉 Both email services verified successfully!');
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
