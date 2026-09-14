process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRouter } from '../../src/providers/router.js';

describe('V6 Enterprise: Multi-Provider Health Discovery & Dynamic Failover Routing', () => {
  it('resolves primary provider Razorpay when healthy for INR currency', () => {
    const route = ProviderRouter.resolveProvider({ currency: 'INR' });
    assert.equal(route.selected_provider, 'razorpay');
    assert.equal(route.is_fallback, false);
  });

  it('routes international currency USD to Stripe with multi-currency capability', () => {
    const route = ProviderRouter.resolveProvider({ currency: 'USD', preferredProvider: 'razorpay' });
    // Razorpay Test in our config only declared INR; Stripe supports USD
    assert.equal(route.selected_provider, 'stripe');
    assert.equal(route.is_fallback, true);
  });

  it('dynamically fails over to alternate provider when primary reports consecutive failures', () => {
    // Simulate 5 consecutive failures on Razorpay
    for (let i = 0; i < 5; i++) {
      ProviderRouter.updateProviderTelemetry('razorpay', 5000, false, 'test');
    }

    // Now resolve INR: should failover to Cashfree
    const failoverRoute = ProviderRouter.resolveProvider({ currency: 'INR', preferredProvider: 'razorpay' });
    assert.equal(failoverRoute.selected_provider, 'cashfree');
    assert.equal(failoverRoute.is_fallback, true);
    assert.ok(failoverRoute.routing_reason.includes('Failover activated'));

    // Simulate recovery probe success
    ProviderRouter.updateProviderTelemetry('razorpay', 85, true, 'test');
    ProviderRouter.updateProviderTelemetry('razorpay', 90, true, 'test');
    const recoveredRoute = ProviderRouter.resolveProvider({ currency: 'INR', preferredProvider: 'razorpay' });
    assert.equal(recoveredRoute.selected_provider, 'razorpay');
  });
});
