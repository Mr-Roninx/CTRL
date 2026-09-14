import { rzpClient } from '../src/execution/executor.js';

async function checkRemoteStatus() {
  const paymentLinkId = process.argv[2] || 'plink_TWcnQZVwogNPop';
  const link: any = await rzpClient.paymentLink.fetch(paymentLinkId);

  console.log('--- FULL PAYMENT LINK OBJECT ---');
  console.log(JSON.stringify(link, null, 2));
}

checkRemoteStatus().catch(console.error);


