import { executeOpportunity } from '../src/execution/executor.js';

async function testSingle() {
  const res = await executeOpportunity('synth_12_mid_val_retainer');
  console.log('Result for synth_12_mid_val_retainer:', res);
}

testSingle();
