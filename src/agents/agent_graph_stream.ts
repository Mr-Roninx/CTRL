import { Response } from 'express';
import { EventEmitter } from 'node:events';

export interface DeliberationEvent {
  event_id: string;
  stage: 'PERCEPTION' | 'ECONOMIC' | 'MARKET' | 'AUTHORITY' | 'OUTREACH' | 'EXECUTION';
  agent_name: string;
  opportunity_id?: string;
  status: 'STARTED' | 'DELIBERATING' | 'APPROVED' | 'VETOED' | 'COMPLETED';
  thought_summary: string;
  metrics?: Record<string, any>;
  timestamp: string;
}

class DeliberationStreamHub extends EventEmitter {
  private static instance: DeliberationStreamHub;
  private recentEvents: DeliberationEvent[] = [];

  public static getInstance(): DeliberationStreamHub {
    if (!DeliberationStreamHub.instance) {
      DeliberationStreamHub.instance = new DeliberationStreamHub();
      DeliberationStreamHub.instance.setMaxListeners(100);
    }
    return DeliberationStreamHub.instance;
  }

  public publish(event: Omit<DeliberationEvent, 'event_id' | 'timestamp'>): void {
    const fullEvent: DeliberationEvent = {
      ...event,
      event_id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    this.recentEvents.push(fullEvent);
    if (this.recentEvents.length > 50) {
      this.recentEvents.shift();
    }

    this.emit('deliberation', fullEvent);
  }

  public getRecentEvents(): DeliberationEvent[] {
    return [...this.recentEvents];
  }
}

export const deliberationStreamHub = DeliberationStreamHub.getInstance();

/**
 * Express SSE Controller for streaming live agent deliberation events to UI.
 */
export function handleDeliberationStream(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial backlog of recent events
  const backlog = deliberationStreamHub.getRecentEvents();
  for (const evt of backlog) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  const listener = (event: DeliberationEvent) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {}
  };

  deliberationStreamHub.on('deliberation', listener);

  // Keep-alive heartbeat every 15s
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    } catch {}
  }, 15000);

  res.on('close', () => {
    clearInterval(heartbeat);
    deliberationStreamHub.off('deliberation', listener);
  });
}
