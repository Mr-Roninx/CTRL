import crypto from 'node:crypto';

export interface LoopGuardResult {
  allowed: boolean;
  reason?: string;
  fingerprint: string;
}

export class LoopGuard {
  private toolCallHistory: { fingerprint: string; toolName: string; timestamp: number; success: boolean }[] = [];
  private planFingerprints: Set<string> = new Set();
  private maxConsecutiveIdenticalCalls: number;
  private maxConsecutiveFailures: number;

  constructor(maxConsecutiveIdenticalCalls: number = 3, maxConsecutiveFailures: number = 2) {
    this.maxConsecutiveIdenticalCalls = maxConsecutiveIdenticalCalls;
    this.maxConsecutiveFailures = maxConsecutiveFailures;
  }

  public generateToolFingerprint(toolName: string, inputPayload: Record<string, any>): string {
    const serialized = JSON.stringify(inputPayload, Object.keys(inputPayload).sort());
    return crypto.createHash('sha256').update(`${toolName}:${serialized}`).digest('hex');
  }

  public generatePlanFingerprint(steps: string[], preferredAction: string): string {
    const serialized = JSON.stringify({ steps, preferredAction });
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  public checkToolCall(toolName: string, inputPayload: Record<string, any>): LoopGuardResult {
    const fp = this.generateToolFingerprint(toolName, inputPayload);

    // 1. Check for identical consecutive calls
    const recent = this.toolCallHistory.slice(-this.maxConsecutiveIdenticalCalls);
    if (recent.length >= this.maxConsecutiveIdenticalCalls) {
      const allIdentical = recent.every((entry) => entry.fingerprint === fp);
      if (allIdentical) {
        return {
          allowed: false,
          reason: `Loop Guard: Blocked ${this.maxConsecutiveIdenticalCalls} consecutive identical tool calls to '${toolName}'`,
          fingerprint: fp,
        };
      }
    }

    // 2. Check for consecutive failures of same tool
    const recentToolFailures = this.toolCallHistory
      .filter((entry) => entry.toolName === toolName)
      .slice(-this.maxConsecutiveFailures);

    if (recentToolFailures.length >= this.maxConsecutiveFailures && recentToolFailures.every((e) => !e.success)) {
      return {
        allowed: false,
        reason: `Loop Guard: Blocked after ${this.maxConsecutiveFailures} consecutive failures for tool '${toolName}'`,
        fingerprint: fp,
      };
    }

    return {
      allowed: true,
      fingerprint: fp,
    };
  }

  public recordToolExecution(toolName: string, inputPayload: Record<string, any>, success: boolean): void {
    const fp = this.generateToolFingerprint(toolName, inputPayload);
    this.toolCallHistory.push({
      fingerprint: fp,
      toolName,
      timestamp: Date.now(),
      success,
    });
  }

  public checkPlanLoop(steps: string[], preferredAction: string): { allowed: boolean; reason?: string; fingerprint: string } {
    const fp = this.generatePlanFingerprint(steps, preferredAction);
    if (this.planFingerprints.has(fp)) {
      return {
        allowed: false,
        reason: `Loop Guard: Cyclic plan detected. Identical plan already executed in this mission.`,
        fingerprint: fp,
      };
    }
    this.planFingerprints.add(fp);
    return {
      allowed: true,
      fingerprint: fp,
    };
  }
}
