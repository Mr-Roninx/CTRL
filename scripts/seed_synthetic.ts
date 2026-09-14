import dotenv from 'dotenv';
import path from 'node:path';
import {
  initDatabase,
  upsertOpportunity,
  insertLedgerEntry,
  upsertCustomer,
  db,
} from '../src/db/database.js';
import { RecoveryOpportunity } from '../src/types/index.js';
import { classifyDeclineTaxonomy } from '../src/perception/normalizer.js';
import { scoreOpportunity } from '../src/economics/scorer.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

export const SYNTHETIC_SCENARIOS: RecoveryOpportunity[] = [
  {
    id: 'synth_01_stolen_card',
    source: 'synthetic',
    amount_paise: 450000, // ₹4,500
    currency: 'INR',
    reason_code: 'stolen_card',
    decline_type: classifyDeclineTaxonomy('stolen_card', 'card stolen or lost'), // hard
    attempt_count: 1,
    customer_id: 'cust_synth_stolen_01',
    customer_trust_score: 0.1,
    created_at: new Date(Date.now() - 3600000 * 15).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Hard decline: Stolen or lost card reported by issuer' }),
  },
  {
    id: 'synth_02_insufficient_funds_att1',
    source: 'synthetic',
    amount_paise: 250000, // ₹2,500
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: classifyDeclineTaxonomy('insufficient_funds', 'insufficient account funds'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_funds_02',
    customer_trust_score: 0.8,
    created_at: new Date(Date.now() - 3600000 * 14).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Soft decline: Insufficient funds at attempt 1' }),
  },
  {
    id: 'synth_03_retry_cap_exceeded',
    source: 'synthetic',
    amount_paise: 180000, // ₹1,800
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: classifyDeclineTaxonomy('insufficient_funds', 'insufficient funds retry cap'), // soft
    attempt_count: 3, // At retry cap
    customer_id: 'cust_synth_retrycap_03',
    customer_trust_score: 0.4,
    created_at: new Date(Date.now() - 3600000 * 13).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Soft decline: Insufficient funds at attempt 3 (policy retry cap)' }),
  },
  {
    id: 'synth_04_expired_card',
    source: 'synthetic',
    amount_paise: 320000, // ₹3,200
    currency: 'INR',
    reason_code: 'expired_card',
    decline_type: classifyDeclineTaxonomy('expired_card', 'card has expired'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_expired_04',
    customer_trust_score: 0.5,
    created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Soft decline: Expired card on file (renewable)' }),
  },
  {
    id: 'synth_05_ambiguous_soft_att2',
    source: 'synthetic',
    amount_paise: 500000, // ₹5,000
    currency: 'INR',
    reason_code: 'transaction_not_permitted',
    decline_type: classifyDeclineTaxonomy('transaction_not_permitted', 'bank generic decline'), // soft
    attempt_count: 2,
    customer_id: 'cust_synth_ambig_05',
    customer_trust_score: 0.6,
    created_at: new Date(Date.now() - 3600000 * 11).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Ambiguous soft decline at attempt 2 (transaction not permitted)' }),
  },
  {
    id: 'synth_06_bank_timeout_high_nat',
    source: 'synthetic',
    amount_paise: 120000, // ₹1,200
    currency: 'INR',
    reason_code: 'bank_gateway_timeout',
    decline_type: classifyDeclineTaxonomy('bank_gateway_timeout', 'timeout'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_timeout_06',
    customer_trust_score: 0.9,
    created_at: new Date(Date.now() - 3600000 * 10).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Bank gateway timeout with high natural recovery' }),
  },
  {
    id: 'synth_07_high_val_enterprise',
    source: 'synthetic',
    amount_paise: 1500000, // ₹15,000
    currency: 'INR',
    reason_code: 'bank_gateway_timeout',
    decline_type: classifyDeclineTaxonomy('bank_gateway_timeout', 'timeout'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_ent_07',
    customer_trust_score: 0.95,
    created_at: new Date(Date.now() - 3600000 * 9).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'High value enterprise subscription renewal' }),
  },
  {
    id: 'synth_08_mid_val_saas',
    source: 'synthetic',
    amount_paise: 850000, // ₹8,500
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: classifyDeclineTaxonomy('insufficient_funds', 'insufficient funds'), // soft
    attempt_count: 2,
    customer_id: 'cust_synth_saas_08',
    customer_trust_score: 0.7,
    created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Mid value SaaS tier plan renewal attempt 2' }),
  },
  {
    id: 'synth_09_high_val_license',
    source: 'synthetic',
    amount_paise: 2500000, // ₹25,000
    currency: 'INR',
    reason_code: 'network_timeout',
    decline_type: classifyDeclineTaxonomy('network_timeout', 'network error'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_corp_09',
    customer_trust_score: 0.92,
    created_at: new Date(Date.now() - 3600000 * 7).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'High value corporate annual software license' }),
  },
  {
    id: 'synth_10_mid_val_ecom',
    source: 'synthetic',
    amount_paise: 350000, // ₹3,500
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: classifyDeclineTaxonomy('insufficient_funds', 'insufficient funds'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_ecom_10',
    customer_trust_score: 0.65,
    created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Mid value consumer order checkout' }),
  },
  {
    id: 'synth_11_high_val_deposit',
    source: 'synthetic',
    amount_paise: 2000000, // ₹20,000
    currency: 'INR',
    reason_code: 'payment_authentication_failed',
    decline_type: classifyDeclineTaxonomy('payment_authentication_failed', 'authentication failed'), // soft
    attempt_count: 2,
    customer_id: 'cust_synth_hardware_11',
    customer_trust_score: 0.85,
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'High value hardware lease security deposit' }),
  },
  {
    id: 'synth_12_mid_val_retainer',
    source: 'synthetic',
    amount_paise: 1200000, // ₹12,000
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: classifyDeclineTaxonomy('insufficient_funds', 'insufficient funds'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_retainer_12',
    customer_trust_score: 0.78,
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Mid value legal & advisory monthly retainer' }),
  },
  {
    id: 'synth_13_low_mid_utility',
    source: 'synthetic',
    amount_paise: 150000, // ₹1,500
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: classifyDeclineTaxonomy('insufficient_funds', 'insufficient funds'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_util_13',
    customer_trust_score: 0.55,
    created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Low-mid value utility cloud quota top-up' }),
  },
  {
    id: 'synth_14_high_val_cloud_infra',
    source: 'synthetic',
    amount_paise: 1800000, // ₹18,000
    currency: 'INR',
    reason_code: 'bank_gateway_timeout',
    decline_type: classifyDeclineTaxonomy('bank_gateway_timeout', 'timeout'), // soft
    attempt_count: 1,
    customer_id: 'cust_synth_infra_14',
    customer_trust_score: 0.9,
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'High value multi-region GPU compute reservation' }),
  },
  {
    id: 'synth_15_mid_val_training',
    source: 'synthetic',
    amount_paise: 600000, // ₹6,000
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: classifyDeclineTaxonomy('insufficient_funds', 'insufficient funds'), // soft
    attempt_count: 2,
    customer_id: 'cust_synth_training_15',
    customer_trust_score: 0.7,
    created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    status: 'pending',
    raw_payload_ref: JSON.stringify({ scenario: 'Mid value executive engineering cohort seat' }),
  },
];

export const UNMAPPED_TEST_SCENARIO: RecoveryOpportunity = {
  id: 'synth_unmapped_reason_test',
  source: 'synthetic',
  amount_paise: 299900,
  currency: 'INR',
  reason_code: 'unmapped_custom_issuer_code_999',
  decline_type: classifyDeclineTaxonomy('unmapped_custom_issuer_code_999', 'unrecognized message'),
  attempt_count: 1,
  customer_id: 'cust_synth_unmapped_99',
  customer_trust_score: 0.65,
  created_at: new Date().toISOString(),
  status: 'pending',
  raw_payload_ref: JSON.stringify({ scenario: 'Unmapped exotic decline code for unknown classification test' }),
};

export function seedSyntheticData(): void {
  console.log('🌱 Seeding synthetic recovery opportunities, customer profiles & economic scores...');
  
  const allScenarios = [...SYNTHETIC_SCENARIOS, UNMAPPED_TEST_SCENARIO];

  for (const opp of allScenarios) {
    // Seed customer profile
    upsertCustomer({
      id: opp.customer_id,
      trust_score: opp.customer_trust_score,
      created_at: opp.created_at,
      updated_at: opp.created_at,
    });

    // Seed opportunity
    upsertOpportunity(opp);

    // Seed ledger entry
    insertLedgerEntry({
      id: `led_seed_${opp.id}`,
      opportunity_id: opp.id,
      event_type: 'webhook_received',
      amount_paise: opp.amount_paise,
      timestamp: opp.created_at,
      raw_payload_ref: JSON.stringify({ source: 'synthetic_seed', scenario: opp.id }),
    });

    // Compute and store economic score
    scoreOpportunity(opp);
  }

  const countOpps = db.prepare("SELECT COUNT(*) as c FROM recovery_opportunities WHERE source = 'synthetic'").get() as { c: number };
  const countScores = db.prepare("SELECT COUNT(*) as c FROM scores").get() as { c: number };
  console.log(`✅ Successfully seeded ${countOpps.c} opportunities and generated ${countScores.c} economic scores.`);
}

// Run if called as script
seedSyntheticData();
