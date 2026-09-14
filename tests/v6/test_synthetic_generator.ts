process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyntheticDataGenerator } from '../../src/simulation/synthetic_generator.js';
import { CanonicalPaymentEventSchema } from '../../src/security/schemas.js';

describe('V6 Phase 12: Synthetic Data Generator & Schema Conformance', () => {
  const generator = new SyntheticDataGenerator({
    tenantId: 'tenant_synth_test_01',
    defaultCurrency: 'INR',
  });

  it('generates canonical payment events strictly valid against Zod Canonical schema', () => {
    const event = generator.generateFailureEvent({
      amount_paise: 250000,
      failure_code: 'bad_request_payment_card_expired',
    });

    const validated = CanonicalPaymentEventSchema.safeParse(event);
    assert.equal(validated.success, true, 'Synthetic event must strictly conform to CanonicalPaymentEventSchema');

    // INVARIANT: source must be SYNTHETIC_SIMULATION
    assert.equal(event.source, 'SYNTHETIC_SIMULATION');
    assert.equal(event.tenant_id, 'tenant_synth_test_01');
    assert.equal(event.amount_paise, 250000);
    assert.equal(event.currency, 'INR');
    assert.equal(event.environment, 'test');
  });

  it('generates batches of synthetic opportunities with valid distributions and integer paise', () => {
    const batch = generator.generateOpportunityBatch({
      count: 10,
      minAmountPaise: 100000,
      maxAmountPaise: 500000,
    });

    assert.equal(batch.length, 10);
    for (const opp of batch) {
      assert.equal(opp.source, 'synthetic');
      assert.ok(opp.amount_paise >= 100000 && opp.amount_paise <= 500000);
      assert.equal(Number.isInteger(opp.amount_paise), true, 'Amount must be integer paise');
      assert.ok(opp.customer_trust_score >= 50 && opp.customer_trust_score <= 100);
    }
  });
});
