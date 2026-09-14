import { rzpClient } from '../src/execution/executor.js';

async function testRefFetch() {
  try {
    const list: any = await rzpClient.paymentLink.all({ reference_id: 'synth_11_high_val_deposit' });
    console.log('Payment links returned:', list);
  } catch (err) {
    console.error('Error fetching by reference_id:', err);
  }
}

testRefFetch();
