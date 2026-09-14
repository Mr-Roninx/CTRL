import { isKillSwitchActive } from '../authority/gate.js';
import { insertAgentAuthorityCheck } from '../db/database.js';
import { SpecialistAgentName, ToolPermission } from './types.js';
import { MissionBudgetTracker } from './budget.js';
import { LoopGuard } from './loop_guard.js';

export interface GateEvaluationContext {
  runId: string;
  agentName: SpecialistAgentName;
  toolName: string;
  inputPayload: Record<string, any>;
  permissionLevel: ToolPermission;
  budgetTracker?: MissionBudgetTracker;
  loopGuard?: LoopGuard;
  environment?: 'SYNTHETIC' | 'FIXTURE' | 'RAZORPAY_TEST' | 'PROVIDER_VERIFIED';
}

export interface GateCheckResult {
  check_name: string;
  passed: boolean;
  reason: string;
}

export interface GateVerdict {
  allowed: boolean;
  verdict: 'PERMIT' | 'DENY';
  failed_check?: string;
  reason: string;
  checks: GateCheckResult[];
  timestamp: string;
}

// In-memory rate limiting tracker (calls per minute per agent)
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_CALLS_PER_WINDOW = 60;
const rateLimitMap = new Map<string, number[]>();

export class AgentAuthorityGate {
  /**
   * Evaluates all 9 mandatory security & compliance checks before any tool can execute.
   */
  public static evaluate(ctx: GateEvaluationContext): GateVerdict {
    const checks: GateCheckResult[] = [];
    const now = new Date().toISOString();

    // 1. Kill Switch Check
    if (isKillSwitchActive()) {
      checks.push({
        check_name: 'kill_switch_check',
        passed: false,
        reason: 'Manual kill switch is actively ENGAGED. All agent operations blocked.',
      });
    } else {
      checks.push({
        check_name: 'kill_switch_check',
        passed: true,
        reason: 'Kill switch is disengaged (normal operation).',
      });
    }

    // 2. Agent Identity Check
    const recognizedAgents: SpecialistAgentName[] = [
      'PerceptionAgent',
      'StrategyAgent',
      'OutreachAgent',
      'ComplianceCopilot',
      'MerchantCopilot',
      'AgentOrchestrator',
    ];
    if (!recognizedAgents.includes(ctx.agentName)) {
      checks.push({
        check_name: 'agent_identity_check',
        passed: false,
        reason: `Unrecognized agent identity '${ctx.agentName}'.`,
      });
    } else {
      checks.push({
        check_name: 'agent_identity_check',
        passed: true,
        reason: `Agent identity '${ctx.agentName}' is verified and registered.`,
      });
    }

    // 3. Tool Scope Check
    const allowedPermissionsForAgents: ToolPermission[] = ['READ', 'ANALYZE', 'PROPOSE'];
    if (ctx.agentName !== 'AgentOrchestrator' && !allowedPermissionsForAgents.includes(ctx.permissionLevel)) {
      checks.push({
        check_name: 'tool_scope_check',
        passed: false,
        reason: `Agent '${ctx.agentName}' requested permission level '${ctx.permissionLevel}', which exceeds allowed scope (READ/ANALYZE/PROPOSE).`,
      });
    } else {
      checks.push({
        check_name: 'tool_scope_check',
        passed: true,
        reason: `Permission level '${ctx.permissionLevel}' is within authorized scope.`,
      });
    }

    // 4. Mission Budget Check
    if (ctx.budgetTracker) {
      const budgetCheck = ctx.budgetTracker.checkBudgets();
      if (budgetCheck.exceeded) {
        checks.push({
          check_name: 'mission_budget_check',
          passed: false,
          reason: budgetCheck.message || 'Mission budget exceeded.',
        });
      } else {
        checks.push({
          check_name: 'mission_budget_check',
          passed: true,
          reason: 'Mission is within all allocated computational and step budgets.',
        });
      }
    } else {
      checks.push({
        check_name: 'mission_budget_check',
        passed: true,
        reason: 'Budget tracker not attached (standard pass).',
      });
    }

    // 5. Rate Limit Check
    const nowMs = Date.now();
    const agentKey = `${ctx.runId}:${ctx.agentName}`;
    let callTimestamps = rateLimitMap.get(agentKey) || [];
    callTimestamps = callTimestamps.filter((t) => nowMs - t < RATE_LIMIT_WINDOW_MS);
    if (callTimestamps.length >= MAX_CALLS_PER_WINDOW) {
      checks.push({
        check_name: 'rate_limit_check',
        passed: false,
        reason: `Rate limit of ${MAX_CALLS_PER_WINDOW} calls/min exceeded for agent '${ctx.agentName}'.`,
      });
    } else {
      callTimestamps.push(nowMs);
      rateLimitMap.set(agentKey, callTimestamps);
      checks.push({
        check_name: 'rate_limit_check',
        passed: true,
        reason: `Rate limit verified (${callTimestamps.length}/${MAX_CALLS_PER_WINDOW} calls in current window).`,
      });
    }

    // 6. Write Boundary Check
    const forbiddenWriteToolNames = [
      'execute_payment',
      'create_payment_link_direct',
      'authorize_opportunity',
      'modify_ledger',
      'write_scores_direct',
    ];
    if (forbiddenWriteToolNames.includes(ctx.toolName) || ctx.permissionLevel === 'FINANCIAL_WRITE' || ctx.permissionLevel === 'EXECUTE') {
      checks.push({
        check_name: 'write_boundary_check',
        passed: false,
        reason: `Tool '${ctx.toolName}' attempts direct write to financial/execution boundary. Only deterministic pipelines may execute financial actions.`,
      });
    } else {
      checks.push({
        check_name: 'write_boundary_check',
        passed: true,
        reason: 'Tool call strictly adheres to read-only or proposal-only boundary.',
      });
    }

    // 7. Environment Check
    const env = ctx.environment || 'RAZORPAY_TEST';
    if (env === 'SYNTHETIC' && ctx.toolName.startsWith('razorpay_live_')) {
      checks.push({
        check_name: 'environment_check',
        passed: false,
        reason: 'Synthetic environment cannot call live provider endpoints.',
      });
    } else {
      checks.push({
        check_name: 'environment_check',
        passed: true,
        reason: `Environment '${env}' verified.`,
      });
    }

    // 8. Injection Taint Check
    const payloadStr = JSON.stringify(ctx.inputPayload).toLowerCase();
    const hostileInjectionPatterns = [
      'ignore previous instructions',
      'ignore your instructions',
      'ignore all instructions',
      'system prompt override',
      'system prompt',
      'grant financial_write',
      'execute arbitrary sql',
      'transfer 10,00,000',
      'transfer ₹',
      'transfer',
      'delete from',
      'drop table',
      '<script>',
      'bypass authority',
    ];
    const detectedPattern = hostileInjectionPatterns.find((p) => payloadStr.includes(p));
    if (detectedPattern) {
      checks.push({
        check_name: 'injection_taint_check',
        passed: false,
        reason: `Hostile prompt/SQL injection pattern detected in payload: "${detectedPattern}".`,
      });
    } else {
      checks.push({
        check_name: 'injection_taint_check',
        passed: true,
        reason: 'No hostile injection patterns detected in payload.',
      });
    }

    // 9. Loop Guard Check
    if (ctx.loopGuard) {
      const loopResult = ctx.loopGuard.checkToolCall(ctx.toolName, ctx.inputPayload);
      if (!loopResult.allowed) {
        checks.push({
          check_name: 'loop_guard_check',
          passed: false,
          reason: loopResult.reason || 'Loop guard triggered.',
        });
      } else {
        checks.push({
          check_name: 'loop_guard_check',
          passed: true,
          reason: 'Tool execution is not in a repetitive or failing loop.',
        });
      }
    } else {
      checks.push({
        check_name: 'loop_guard_check',
        passed: true,
        reason: 'Loop guard not attached (standard pass).',
      });
    }

    // Persist checks to SQLite audit table
    for (const check of checks) {
      insertAgentAuthorityCheck({
        run_id: ctx.runId,
        tool_name: ctx.toolName,
        agent_name: ctx.agentName,
        check_name: check.check_name,
        passed: check.passed,
        reason: check.reason,
        timestamp: now,
      });
    }

    const failed = checks.find((c) => !c.passed);
    if (failed) {
      return {
        allowed: false,
        verdict: 'DENY',
        failed_check: failed.check_name,
        reason: failed.reason,
        checks,
        timestamp: now,
      };
    }

    return {
      allowed: true,
      verdict: 'PERMIT',
      reason: 'All 9 security & authority compliance checks passed successfully.',
      checks,
      timestamp: now,
    };
  }
}
