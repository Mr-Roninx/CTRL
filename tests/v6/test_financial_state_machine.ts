process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalStateMachine } from '../../src/truth/canonical_state_machine.js';

describe('V6 Phase 7: Canonical Financial State Machine & State Transition Invariants', () => {
  it('enforces INVARIANT: LINK_CREATED != RECOVERED (created status with 0 paid maps to PROVIDER_OBJECT_CREATED)', () => {
    const mapping = CanonicalStateMachine.mapRazorpayStatusToCanonicalState({
      status: 'created',
      amount_paise: 100000,
      amount_paid_paise: 0,
    });

    assert.equal(
      mapping.canonical_state,
      'PROVIDER_OBJECT_CREATED',
      'Created status must map to PROVIDER_OBJECT_CREATED, never RECOVERED'
    );
    assert.equal(mapping.is_settled, false);
    assert.equal(mapping.is_terminal, false);
    assert.match(mapping.rationale, /LINK_CREATED != RECOVERED/);
  });

  it('maps confirmed paid provider status to PAYMENT_CONFIRMED (is_settled: true, is_terminal: true)', () => {
    const mapping = CanonicalStateMachine.mapRazorpayStatusToCanonicalState({
      status: 'paid',
      amount_paise: 100000,
      amount_paid_paise: 100000,
    });

    assert.equal(mapping.canonical_state, 'PAYMENT_CONFIRMED');
    assert.equal(mapping.is_settled, true);
    assert.equal(mapping.is_terminal, true);
  });

  it('enforces legal canonical state transitions and rejects illegal transitions', () => {
    // 1. Legal progressions
    assert.equal(CanonicalStateMachine.isValidTransition('PENDING', 'SCORED'), true);
    assert.equal(CanonicalStateMachine.isValidTransition('SCORED', 'ALLOCATED'), true);
    assert.equal(CanonicalStateMachine.isValidTransition('ALLOCATED', 'AUTHORIZED'), true);
    assert.equal(CanonicalStateMachine.isValidTransition('AUTHORIZED', 'EXECUTING'), true);
    assert.equal(CanonicalStateMachine.isValidTransition('EXECUTING', 'PROVIDER_OBJECT_CREATED'), true);
    assert.equal(CanonicalStateMachine.isValidTransition('PROVIDER_OBJECT_CREATED', 'PAYMENT_CONFIRMED'), true);
    assert.equal(CanonicalStateMachine.isValidTransition('PAYMENT_CONFIRMED', 'RECOVERED'), true);

    // 2. Illegal jumps
    assert.equal(
      CanonicalStateMachine.isValidTransition('PENDING', 'RECOVERED'),
      false,
      'Illegal leap from PENDING directly to RECOVERED must be rejected'
    );
    assert.equal(
      CanonicalStateMachine.isValidTransition('BLOCKED', 'EXECUTING'),
      false,
      'BLOCKED state cannot jump to EXECUTING'
    );
    assert.equal(
      CanonicalStateMachine.isValidTransition('RECOVERED', 'FAILED'),
      false,
      'Terminal RECOVERED state cannot transition to FAILED'
    );
  });
});
