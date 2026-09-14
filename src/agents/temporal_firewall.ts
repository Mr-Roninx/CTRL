import { AgentMemoryItem } from './types.js';

export class TemporalMemoryFirewall {
  /**
   * Filters memories so that only records created AT OR BEFORE the cutoff timestamp can be seen.
   * Eliminates lookahead / oracle bias.
   */
  public static filterMemories(memories: AgentMemoryItem[], cutoffTimestamp: string): AgentMemoryItem[] {
    const cutoffTime = new Date(cutoffTimestamp).getTime();
    return memories.filter((m) => {
      const memTime = new Date(m.created_at).getTime();
      return memTime <= cutoffTime;
    });
  }

  /**
   * Asserts that a timestamp does not violate the temporal firewall.
   */
  public static assertTimestampValid(recordTimestamp: string, currentCutoff: string): void {
    const recTime = new Date(recordTimestamp).getTime();
    const cutTime = new Date(currentCutoff).getTime();
    if (recTime > cutTime) {
      throw new Error(`Temporal Firewall Breach: Record timestamp (${recordTimestamp}) is in the future relative to mission time (${currentCutoff}).`);
    }
  }
}
