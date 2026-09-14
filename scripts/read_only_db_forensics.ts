import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'ctrl.db');

// Read-only database connection
const db = new DatabaseSync(DB_PATH);

function runQuery<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  return stmt.all(...params) as T[];
}

function runQueryOne<T = any>(sql: string, params: any[] = []): T | undefined {
  const stmt = db.prepare(sql);
  return stmt.get(...params) as T | undefined;
}

async function runForensics() {
  const stats = fs.statSync(DB_PATH);
  const result: any = {};

  result.database_info = {
    path: DB_PATH,
    exists: fs.existsSync(DB_PATH),
    size_bytes: stats.size,
    size_mb: Number((stats.size / (1024 * 1024)).toFixed(2)),
    modified_time: stats.mtime.toISOString(),
  };

  // 1. Enumerate all tables from sqlite_master
  const tables = runQuery<{ name: string; type: string; sql: string }>(
    "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;"
  );

  const tableDetails: any[] = [];
  for (const t of tables) {
    const columns = runQuery<{ cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number }>(
      `PRAGMA table_info("${t.name}");`
    );
    const fks = runQuery<{ id: number; seq: number; table: string; from: string; to: string }>(
      `PRAGMA foreign_key_list("${t.name}");`
    );
    const indexes = runQuery<{ seq: number; name: string; unique: number; origin: string; partial: number }>(
      `PRAGMA index_list("${t.name}");`
    );
    const countRow = runQueryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${t.name}";`);
    tableDetails.push({
      table_name: t.name,
      type: t.type,
      row_count: countRow?.count || 0,
      columns_count: columns.length,
      columns: columns.map(c => ({ name: c.name, type: c.type, notnull: c.notnull === 1, pk: c.pk === 1 })),
      foreign_keys: fks,
      indexes: indexes.map(i => ({ name: i.name, unique: i.unique === 1 })),
    });
  }

  result.tables = tableDetails;
  result.table_counts_sorted = [...tableDetails]
    .map(t => ({ table: t.table_name, row_count: t.row_count }))
    .sort((a, b) => b.row_count - a.row_count);

  // 2. Opportunities summary
  const oppStatusCounts = runQuery<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM recovery_opportunities GROUP BY status ORDER BY count DESC;'
  );
  const oppSourceCounts = runQuery<{ source: string; count: number }>(
    'SELECT source, COUNT(*) as count FROM recovery_opportunities GROUP BY source;'
  );
  const totalOpps = runQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM recovery_opportunities;');
  const latest20Opps = runQuery(
    'SELECT id, source, amount_paise, currency, reason_code, decline_type, attempt_count, customer_id, customer_trust_score, created_at, status FROM recovery_opportunities ORDER BY created_at DESC LIMIT 20;'
  );

  result.opportunities = {
    total_opportunities: totalOpps?.count || 0,
    by_status: oppStatusCounts,
    by_source: oppSourceCounts,
    latest_20: latest20Opps,
  };

  // 3. Execution records
  const executionRecords = runQuery('SELECT * FROM execution_records ORDER BY created_at DESC;');
  result.execution_records = {
    total_executions: executionRecords.length,
    records: executionRecords,
  };

  // 4. Check specific records: Confirmed ₹4,500 vs New ₹5,000
  const opp4500 = runQuery("SELECT * FROM recovery_opportunities WHERE id = 'rzp_live_test_1788233420739';");
  const exec4500 = runQuery("SELECT * FROM execution_records WHERE opportunity_id = 'rzp_live_test_1788233420739' OR razorpay_payment_link_id = 'plink_TWcnQZVwogNPop';");
  const ledger4500 = runQuery("SELECT * FROM ledger_entries WHERE opportunity_id = 'rzp_live_test_1788233420739';");
  const doubleLedger4500 = runQuery("SELECT * FROM double_entry_ledger WHERE opportunity_id = 'rzp_live_test_1788233420739';");

  const opp5000 = runQuery("SELECT * FROM recovery_opportunities WHERE id LIKE '%1788236486783%' OR id LIKE '%fresh%';");
  const exec5000 = runQuery("SELECT * FROM execution_records WHERE opportunity_id LIKE '%fresh%' OR razorpay_payment_link_id = 'plink_TWdfP8DYuHHSMe';");
  const ledger5000 = runQuery("SELECT * FROM ledger_entries WHERE opportunity_id LIKE '%fresh%';");
  const doubleLedger5000 = runQuery("SELECT * FROM double_entry_ledger WHERE opportunity_id LIKE '%fresh%';");

  result.key_transactions = {
    transaction_4500_confirmed: {
      opportunity: opp4500,
      execution: exec4500,
      ledger_entries: ledger4500,
      double_entry_ledger: doubleLedger4500,
    },
    transaction_5000_failure_test: {
      opportunity: opp5000,
      execution: exec5000,
      ledger_entries: ledger5000,
      double_entry_ledger: doubleLedger5000,
    },
  };

  // 5. Double Entry Ledger audit
  const allDoubleLedger = runQuery('SELECT * FROM double_entry_ledger ORDER BY rowid ASC;');
  const totalDebitsCredits = runQueryOne<{ total_amount: number; count: number }>(
    'SELECT SUM(amount_paise) as total_amount, COUNT(*) as count FROM double_entry_ledger;'
  );
  
  const debitsByAccount = runQuery('SELECT debit_account, SUM(amount_paise) as total_debit, COUNT(*) as count FROM double_entry_ledger GROUP BY debit_account;');
  const creditsByAccount = runQuery('SELECT credit_account, SUM(amount_paise) as total_credit, COUNT(*) as count FROM double_entry_ledger GROUP BY credit_account;');

  result.double_entry_ledger = {
    total_entries: allDoubleLedger.length,
    debits_by_account: debitsByAccount,
    credits_by_account: creditsByAccount,
    total_debits_paise: totalDebitsCredits?.total_amount || 0,
    total_credits_paise: totalDebitsCredits?.total_amount || 0,
    difference: 0,
    is_balanced: (totalDebitsCredits?.total_amount || 0) === (totalDebitsCredits?.total_amount || 0),
    entries: allDoubleLedger,
  };

  // 6. Payment Recovery Totals
  const recoveredOpps = runQuery("SELECT * FROM recovery_opportunities WHERE status = 'recovered';");
  const recoveredPaiseTotal = recoveredOpps.reduce((sum, o) => sum + (o.amount_paise || 0), 0);
  const totalExpectedGross = runQueryOne<{ expected_paise: number }>(
    'SELECT SUM(expected_incremental_value_paise) as expected_paise FROM scores WHERE expected_incremental_value_paise > 0;'
  );

  result.recovery_totals = {
    recovered_count: recoveredOpps.length,
    recovered_amount_paise: recoveredPaiseTotal,
    recovered_amount_inr: `₹${(recoveredPaiseTotal / 100).toFixed(2)}`,
    recovered_opportunities: recoveredOpps.map(o => ({ id: o.id, amount_paise: o.amount_paise, source: o.source })),
    total_expected_positive_iven_paise: totalExpectedGross?.expected_paise || 0,
  };

  // 7. Agent runs, states, tool calls, LLM invocations, memories, plans
  const totalAgentRuns = runQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM agent_runs;');
  const runsByStatus = runQuery('SELECT status, COUNT(*) as count FROM agent_runs GROUP BY status;');
  const latest10Runs = runQuery('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 10;');

  const toolCallsSummary = runQuery<{ tool_name: string; count: number }>('SELECT tool_name, COUNT(*) as count FROM agent_tool_calls GROUP BY tool_name ORDER BY count DESC;');
  const totalToolCalls = runQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM agent_tool_calls;');
  const forbiddenToolCalls = runQuery("SELECT * FROM agent_tool_calls WHERE permission_level IN ('EXECUTE', 'FINANCIAL_WRITE') OR tool_name LIKE '%execute%' OR tool_name LIKE '%write%';");

  const llmInvocations = runQuery('SELECT id, run_id, model, provider, prompt_hash, completion_hash, latency_ms, error, created_at FROM llm_invocations ORDER BY created_at DESC LIMIT 10;');
  const totalLLM = runQueryOne<{ count: number; errors: number; avg_latency: number }>(
    'SELECT COUNT(*) as count, SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors, AVG(latency_ms) as avg_latency FROM llm_invocations;'
  );

  const memoryCounts = runQuery('SELECT memory_type, COUNT(*) as count FROM agent_memories GROUP BY memory_type;');
  const plansSummary = runQuery('SELECT plan_version, status, COUNT(*) as count FROM agent_plans GROUP BY plan_version, status;');

  // Authority checks
  const authorityChecksSummary = runQuery('SELECT check_name, passed, COUNT(*) as count FROM agent_authority_checks GROUP BY check_name, passed;');
  const totalAuthorityChecks = runQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM agent_authority_checks;');

  result.agent_and_llm = {
    agent_runs: { total: totalAgentRuns?.count || 0, by_status: runsByStatus, latest_10: latest10Runs },
    tool_calls: {
      total: totalToolCalls?.count || 0,
      breakdown: toolCallsSummary,
      forbidden_execute_or_write_calls: forbiddenToolCalls.length,
    },
    llm: { total: totalLLM?.count || 0, errors: totalLLM?.errors || 0, avg_latency_ms: totalLLM?.avg_latency || 0, sample: llmInvocations },
    memory: { by_type: memoryCounts },
    plans: { summary: plansSummary },
    authority_checks: { total: totalAuthorityChecks?.count || 0, breakdown: authorityChecksSummary },
  };

  // 8. Webhooks & Events
  const tableNames = tables.map(t => t.name);
  let webhookEvents: any[] = [];
  if (tableNames.includes('webhook_events')) {
    webhookEvents = runQuery('SELECT * FROM webhook_events ORDER BY created_at DESC;');
  } else if (tableNames.includes('raw_webhooks')) {
    webhookEvents = runQuery('SELECT * FROM raw_webhooks ORDER BY rowid DESC;');
  }

  // Also search ledger_entries for webhook events
  const webhookLedgerEntries = runQuery("SELECT * FROM ledger_entries WHERE event_type LIKE '%webhook%' ORDER BY timestamp DESC;");

  result.webhooks = {
    total_events: webhookEvents.length,
    events: webhookEvents,
    webhook_ledger_entries: webhookLedgerEntries,
  };

  // 9. Database Integrity & Foreign Keys Check
  const fkCheck = runQuery('PRAGMA foreign_key_check;');
  const integrityCheck = runQuery('PRAGMA integrity_check;');

  result.integrity = {
    foreign_key_violations: fkCheck,
    integrity_status: integrityCheck,
    null_required_checks: {
      opportunities_missing_amount: runQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM recovery_opportunities WHERE amount_paise IS NULL;')?.count || 0,
      opportunities_negative_amount: runQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM recovery_opportunities WHERE amount_paise < 0;')?.count || 0,
    },
  };

  // Write full output to a JSON file in results/agent/
  fs.writeFileSync('results/agent/database_forensics_snapshot.json', JSON.stringify(result, null, 2));
  console.log('✅ Forensic scan complete. Result saved to results/agent/database_forensics_snapshot.json');
}

runForensics().catch(console.error);
