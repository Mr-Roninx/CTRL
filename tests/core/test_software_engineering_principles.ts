import { AuthorityRuleRegistry } from '../../src/authority/rule_registry.js';
import { IAuthorityRule, AuthorityRuleContext, AuthorityRuleResult } from '../../src/authority/rules/rule_interface.js';
import { OpportunityStateMachine, IllegalStateTransitionError } from '../../src/domain/state_machine.js';
import { IOpportunityRepository } from '../../src/db/repositories/opportunity_repository.js';
import { RecoveryOpportunity, Score, AllocationDecision, OpportunityStatus } from '../../src/types/index.js';

async function runSoftwareEngineeringPrinciplesTest() {
  console.log('🏛️ Testing Software Engineering Principles Implementation on CTRL...\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (!condition) {
      throw new Error(`❌ Assertion Failed: ${message}`);
    }
    console.log(`  ✓ ${message}`);
    passedTests++;
  }

  // =========================================================================
  // 1. OPEN/CLOSED PRINCIPLE (OCP) - Specification Rule Engine
  // =========================================================================
  console.log('1️⃣ Testing Open/Closed Principle (Specification Rule Pattern):');
  const registry = AuthorityRuleRegistry.getInstance();
  registry.resetToDefaults();

  const activeRules = registry.getActiveRules();
  assert(activeRules.length === 5, `Default rule registry contains exactly 5 core rules (found: ${activeRules.length})`);

  const mockOpp: RecoveryOpportunity = {
    id: 'opp_eng_test_01',
    source: 'real',
    amount_paise: 250000, // ₹2,500.00
    currency: 'INR',
    reason_code: 'INSUFFICIENT_FUNDS',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_eng_1',
    customer_trust_score: 0.9,
    created_at: new Date().toISOString(),
    status: 'allocated',
    tenant_id: 'tenant_default',
    environment: 'test',
  };

  const mockScore: Score = {
    opportunity_id: mockOpp.id,
    natural_recovery_prob: 0.25,
    intervention_recovery_prob: 0.75,
    incremental_prob: 0.5,
    operational_cost_paise: 400,
    fatigue_cost_paise: 0,
    expected_incremental_value_paise: 124600,
    confidence: 'high',
  };

  const mockDecision: AllocationDecision = {
    opportunity_id: mockOpp.id,
    decision: 'ACT',
    rank_in_batch: 1,
    shadow_price_paise_at_decision: 50000,
    reason: 'Top priority',
  };

  // Baseline evaluation should pass
  const baselineEval = registry.evaluate({
    opportunity: mockOpp,
    score: mockScore,
    decision: mockDecision,
    tenantId: mockOpp.tenant_id,
  });
  assert(baselineEval.verdict === 'AUTHORIZED', 'Baseline soft decline with ACT decision is AUTHORIZED');
  assert(baselineEval.checks.length === 5, 'Baseline generates all 5 durable audit check records');

  // Dynamically EXTEND by registering a new custom rule WITHOUT modifying existing engine code (OCP)
  class MerchantVipAntiSpamRule implements IAuthorityRule {
    public readonly id = 'merchant_vip_anti_spam_check';
    public readonly name = 'VIP Customer Anti-Spam Specification';
    public readonly priority = 1; // Evaluated first
    public readonly isBlocking = true;

    public evaluate(context: AuthorityRuleContext): AuthorityRuleResult {
      if (context.opportunity.amount_paise > 200000 && context.opportunity.customer_trust_score > 0.85) {
        return {
          passed: false,
          reason: 'VIP high-trust customer routed to dedicated relationship manager instead of automated link',
          suggestedVerdictOnFailure: 'BLOCKED',
          suggestedStatusOnFailure: 'blocked',
        };
      }
      return {
        passed: true,
        reason: 'Standard customer threshold compliant',
        suggestedVerdictOnFailure: 'BLOCKED',
        suggestedStatusOnFailure: 'blocked',
      };
    }
  }

  registry.registerRule(new MerchantVipAntiSpamRule());
  assert(registry.getActiveRules().length === 6, 'Successfully extended rule engine dynamically to 6 rules (Open for Extension)');

  const extendedEval = registry.evaluate({
    opportunity: mockOpp,
    score: mockScore,
    decision: mockDecision,
    tenantId: mockOpp.tenant_id,
  });
  assert(extendedEval.verdict === 'BLOCKED', 'New VIP rule successfully intercepted opportunity and issued BLOCKED verdict');
  assert(
    extendedEval.checks.some((c) => c.check_name === 'merchant_vip_anti_spam_check' && !c.passed),
    'Custom rule recorded its check in the durable audit trail'
  );

  // Unregister custom rule and restore baseline
  registry.unregisterRule('merchant_vip_anti_spam_check');
  assert(registry.getActiveRules().length === 5, 'Cleanly unregistered custom rule without engine reboot');
  console.log('  ✅ Open/Closed Principle successfully verified.\n');

  // =========================================================================
  // 2. FINITE STATE MACHINE (FSM) - Lifecycle & Invariant Protection
  // =========================================================================
  console.log('2️⃣ Testing Finite State Machine (FSM Lifecycle Invariants):');

  // Valid pipeline transitions
  assert(OpportunityStateMachine.canTransition('pending', 'scored'), 'Legal: pending -> scored');
  assert(OpportunityStateMachine.canTransition('scored', 'allocated'), 'Legal: scored -> allocated');
  assert(OpportunityStateMachine.canTransition('allocated', 'authorized'), 'Legal: allocated -> authorized');
  assert(OpportunityStateMachine.canTransition('authorized', 'executing'), 'Legal: authorized -> executing');
  assert(OpportunityStateMachine.canTransition('executing', 'recovered'), 'Legal: executing -> recovered');

  // Illegal pipeline transitions (Defensive Programming & Fail-Safe Invariants)
  assert(!OpportunityStateMachine.canTransition('pending', 'executing'), 'Illegal: pending cannot jump directly to executing');
  assert(!OpportunityStateMachine.canTransition('blocked', 'executing'), 'Illegal: blocked opportunity cannot transition to executing');
  assert(!OpportunityStateMachine.canTransition('recovered', 'pending'), 'Illegal: terminal recovered state cannot transition to pending');
  assert(!OpportunityStateMachine.canTransition('recovered', 'executing'), 'Illegal: terminal recovered state cannot transition to executing');

  // Throws IllegalStateTransitionError on violation
  let errorCaught = false;
  try {
    OpportunityStateMachine.validateTransition('opp_test_99', 'blocked', 'executing');
  } catch (err) {
    if (err instanceof IllegalStateTransitionError) {
      errorCaught = true;
      assert(err.currentStatus === 'blocked' && err.targetStatus === 'executing', 'Error captures exact invalid state transition');
    }
  }
  assert(errorCaught, 'validateTransition throws IllegalStateTransitionError on invalid transition');
  console.log('  ✅ Finite State Machine Invariants successfully verified.\n');

  // =========================================================================
  // 3. DEPENDENCY INVERSION PRINCIPLE (DIP) - Port & In-Memory Test Double
  // =========================================================================
  console.log('3️⃣ Testing Dependency Inversion Principle (DIP & Repository Port):');

  // In-Memory Test Double implementing the IOpportunityRepository contract
  class InMemoryOpportunityRepository implements IOpportunityRepository {
    private store = new Map<string, RecoveryOpportunity>();

    public getById(id: string): RecoveryOpportunity | undefined {
      return this.store.get(id);
    }
    public getByRazorpayEventId(eventId: string): RecoveryOpportunity | undefined {
      return Array.from(this.store.values()).find((o) => o.razorpay_event_id === eventId);
    }
    public getAll(): RecoveryOpportunity[] {
      return Array.from(this.store.values());
    }
    public getPending(): RecoveryOpportunity[] {
      return Array.from(this.store.values()).filter((o) => o.status === 'pending');
    }
    public getByStatus(status: OpportunityStatus): RecoveryOpportunity[] {
      return Array.from(this.store.values()).filter((o) => o.status === status);
    }
    public insert(opp: RecoveryOpportunity): void {
      this.store.set(opp.id, { ...opp });
    }
    public upsert(opp: RecoveryOpportunity): void {
      this.store.set(opp.id, { ...opp });
    }
    public updateStatus(id: string, status: OpportunityStatus): void {
      const opp = this.store.get(id);
      if (opp) opp.status = status;
    }
    public count(): number {
      return this.store.size;
    }
  }

  const memoryRepo = new InMemoryOpportunityRepository();
  memoryRepo.insert(mockOpp);
  assert(memoryRepo.count() === 1, 'In-memory repository port satisfies insert and count');
  assert(memoryRepo.getById(mockOpp.id)?.amount_paise === 250000, 'In-memory repository port retrieves opportunity by ID');

  memoryRepo.updateStatus(mockOpp.id, 'scored');
  assert(memoryRepo.getById(mockOpp.id)?.status === 'scored', 'In-memory repository port updates status cleanly');
  console.log('  ✅ Dependency Inversion Principle successfully verified.\n');

  console.log(`🎉 ALL ${passedTests}/${totalTests} SOFTWARE ENGINEERING PRINCIPLE TESTS PASSED!`);
}

runSoftwareEngineeringPrinciplesTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
