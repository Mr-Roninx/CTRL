import { AgentState } from './types.js';
import { insertAgentState, getAgentStatesByRunId } from '../db/database.js';

export interface StateTransitionResult {
  success: boolean;
  from: AgentState;
  to: AgentState;
  trigger: string;
  timestamp: string;
  error?: string;
}

export const VALID_STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  IDLE: ['TRIGGERED'],
  TRIGGERED: ['OBSERVE', 'ABORTED'],
  OBSERVE: ['INVESTIGATE', 'DIAGNOSE', 'PLAN_INVALIDATED', 'ABORTED'],
  INVESTIGATE: ['DIAGNOSE', 'OBSERVE', 'HUMAN_REVIEW', 'ABORTED'],
  DIAGNOSE: ['HYPOTHESIZE', 'HUMAN_REVIEW', 'ABORTED'],
  HYPOTHESIZE: ['PLAN', 'OBSERVE', 'HUMAN_REVIEW', 'ABORTED'],
  PLAN: ['VALIDATE_PLAN', 'HUMAN_REVIEW', 'ABORTED'],
  VALIDATE_PLAN: ['PROPOSE', 'PLAN_INVALIDATED', 'REPLAN', 'ABORTED'],
  PROPOSE: ['WAIT_AUTHORITY', 'HUMAN_REVIEW', 'ABORTED'],
  WAIT_AUTHORITY: ['EXECUTE', 'WAIT', 'ABORTED', 'HUMAN_REVIEW'],
  EXECUTE: ['WAIT', 'OBSERVE_OUTCOME', 'ABORTED'],
  WAIT: ['WAKE', 'ABORTED'],
  WAKE: ['OBSERVE', 'OBSERVE_OUTCOME', 'PLAN_INVALIDATED', 'REPLAN', 'ABORTED'],
  OBSERVE_OUTCOME: ['LEARN', 'PLAN_INVALIDATED', 'COMPLETE', 'ABORTED'],
  PLAN_INVALIDATED: ['REPLAN', 'ABORTED', 'HUMAN_REVIEW'],
  REPLAN: ['PLAN', 'ABORTED', 'HUMAN_REVIEW'],
  LEARN: ['MEMORY_UPDATE', 'COMPLETE', 'ABORTED'],
  MEMORY_UPDATE: ['COMPLETE', 'ABORTED'],
  COMPLETE: [],
  ABORTED: [],
  HUMAN_REVIEW: ['OBSERVE', 'PLAN', 'EXECUTE', 'ABORTED', 'COMPLETE'],
};

export class AgentStateMachine {
  private runId: string;
  private currentState: AgentState;

  constructor(runId: string, initialState: AgentState = 'IDLE') {
    this.runId = runId;
    this.currentState = initialState;
  }

  public getCurrentState(): AgentState {
    return this.currentState;
  }

  public getRunId(): string {
    return this.runId;
  }

  public canTransitionTo(nextState: AgentState): boolean {
    const allowed = VALID_STATE_TRANSITIONS[this.currentState] || [];
    return allowed.includes(nextState);
  }

  public transition(nextState: AgentState, trigger: string, metadata?: Record<string, any>): StateTransitionResult {
    const fromState = this.currentState;
    const now = new Date().toISOString();

    if (!this.canTransitionTo(nextState)) {
      const errorMsg = `Invalid state transition from '${fromState}' to '${nextState}' (trigger: ${trigger})`;
      return {
        success: false,
        from: fromState,
        to: nextState,
        trigger,
        timestamp: now,
        error: errorMsg,
      };
    }

    this.currentState = nextState;

    insertAgentState({
      run_id: this.runId,
      state: nextState,
      previous_state: fromState,
      trigger,
      metadata: metadata ? JSON.stringify(metadata) : null,
      timestamp: now,
    });

    return {
      success: true,
      from: fromState,
      to: nextState,
      trigger,
      timestamp: now,
    };
  }

  public getHistory(): any[] {
    return getAgentStatesByRunId(this.runId);
  }
}
