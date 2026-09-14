import { Response } from 'express';
import { EventEmitter } from 'node:events';

export type TraceEventType =
  | 'AGENT_INITIALIZED'
  | 'AGENT_STEP'
  | 'REASONING_UPDATE'
  | 'TOOL_EXECUTION_START'
  | 'TOOL_EXECUTION_END'
  | 'SIGNAL_EMITTED'
  | 'DECISION_REACHED'
  | 'MISSION_COMPLETED'
  | 'MISSION_ABORTED';

export interface AgentTraceEvent {
  event_id: string;
  run_id: string;
  opportunity_id?: string;
  event_type: TraceEventType;
  payload: Record<string, any>;
  timestamp: string;
}

/**
 * TraceStreamManager — Server-Sent Events (SSE) Engine for Real-Time Agent Reasoning Streaming
 */
export class TraceStreamManager {
  private static emitter = new EventEmitter();
  private static recentEvents: AgentTraceEvent[] = [];
  private static MAX_BUFFER_SIZE = 100;

  static {
    // Prevent memory leaks with many SSE connections
    this.emitter.setMaxListeners(200);
  }

  /**
   * Broadcast an agent trace event to all active SSE subscribers.
   */
  public static broadcast(event: Omit<AgentTraceEvent, 'event_id' | 'timestamp'>): void {
    const fullEvent: AgentTraceEvent = {
      ...event,
      event_id: `trc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    // Buffer event
    this.recentEvents.push(fullEvent);
    if (this.recentEvents.length > this.MAX_BUFFER_SIZE) {
      this.recentEvents.shift();
    }

    // Emit event for run-specific listeners and global listeners
    this.emitter.emit(`trace:${fullEvent.run_id}`, fullEvent);
    this.emitter.emit('trace:global', fullEvent);
  }

  /**
   * Subscribe an Express SSE HTTP response to trace events.
   */
  public static subscribe(res: Response, runId?: string): () => void {
    // Configure SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Send initial handshake
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'Trace stream connected', run_id: runId || 'ALL' })}\n\n`);

    // Replay buffered events matching runId
    const matchingBuffered = runId && runId !== 'ALL'
      ? this.recentEvents.filter((e) => e.run_id === runId)
      : this.recentEvents.slice(-25);

    for (const buffered of matchingBuffered) {
      res.write(`data: ${JSON.stringify(buffered)}\n\n`);
    }

    // Listener for new events
    const channel = runId && runId !== 'ALL' ? `trace:${runId}` : 'trace:global';
    const listener = (event: AgentTraceEvent) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (err) {
        // Client connection dropped
      }
    };

    this.emitter.on(channel, listener);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch (e) {
        clearInterval(heartbeat);
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.emitter.off(channel, listener);
    };

    res.on('close', cleanup);
    return cleanup;
  }

  /**
   * Get recent trace events buffer.
   */
  public static getRecentEvents(runId?: string): AgentTraceEvent[] {
    if (runId && runId !== 'ALL') {
      return this.recentEvents.filter((e) => e.run_id === runId);
    }
    return [...this.recentEvents];
  }
}
