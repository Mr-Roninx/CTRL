import { AgentStateMachine } from './state_machine.js';
import { AgentMemoryStore } from './memory.js';
import { AgentTelemetry } from './telemetry.js';

export interface WaitCondition {
  wake_at?: string;
  wake_condition_type: 'TIMER' | 'GATEWAY_HEALTH' | 'PROVIDER_WEBHOOK' | 'STATUS_CHANGE';
  parameter_target?: string;
  expected_value?: any;
}

export interface WakeEvent {
  run_id: string;
  wake_reason: string;
  wake_timestamp: string;
  new_observations: Record<string, any>;
}

export class AgentWaitWakeEngine {
  /**
   * Enters persisted WAIT state and records wake conditions.
   */
  public static enterWait(params: {
    runId: string;
    stateMachine: AgentStateMachine;
    condition: WaitCondition;
    reason: string;
  }): { success: boolean; wake_at?: string; error?: string } {
    const res = params.stateMachine.transition('WAIT', 'ENTER_WAIT_SCHEDULED', {
      condition: params.condition,
      reason: params.reason,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    AgentMemoryStore.addWorkingMemory({
      runId: params.runId,
      summary: `Entered WAIT state: ${params.reason} (Condition: ${params.condition.wake_condition_type})`,
      provenance: 'AgentWaitWakeEngine',
      semanticKey: 'wait_condition',
      semanticValue: JSON.stringify(params.condition),
    });

    AgentTelemetry.logStep({
      runId: params.runId,
      stepNumber: 99,
      state: 'WAIT',
      observation: `Scheduled wait: ${params.reason}`,
      thought: `Agent sleeping until condition '${params.condition.wake_condition_type}' is satisfied.`,
    });

    return {
      success: true,
      wake_at: params.condition.wake_at,
    };
  }

  /**
   * Wakes the agent up, transitions state to WAKE, and logs wake event.
   */
  public static triggerWake(params: {
    runId: string;
    stateMachine: AgentStateMachine;
    wakeReason: string;
    newObservations?: Record<string, any>;
  }): WakeEvent {
    const now = new Date().toISOString();

    params.stateMachine.transition('WAKE', 'WAKE_EVENT_FIRED', {
      wake_reason: params.wakeReason,
      new_observations: params.newObservations,
      wake_timestamp: now,
    });

    AgentMemoryStore.addWorkingMemory({
      runId: params.runId,
      summary: `Agent WOKE UP: ${params.wakeReason}`,
      provenance: 'AgentWaitWakeEngine',
      semanticKey: 'wake_event',
      semanticValue: JSON.stringify(params.newObservations || {}),
    });

    AgentTelemetry.logStep({
      runId: params.runId,
      stepNumber: 100,
      state: 'WAKE',
      observation: `Agent woke up: ${params.wakeReason}`,
      thought: 'Evaluating plan assumptions against latest observations.',
    });

    return {
      run_id: params.runId,
      wake_reason: params.wakeReason,
      wake_timestamp: now,
      new_observations: params.newObservations || {},
    };
  }
}
