import { Response } from 'express';

export type RealtimeEventType =
  | 'EVENT_INGESTED'
  | 'NOTIFICATION_CREATED'
  | 'OPPORTUNITY_UPDATED'
  | 'SWEEP_COMPLETED'
  | 'CONNECTION_STATUS';

export interface RealtimeMessage {
  type: RealtimeEventType;
  tenant_id: string;
  timestamp: string;
  data: any;
}

export class RealtimeBroadcaster {
  private static instance: RealtimeBroadcaster;
  private tenantClients: Map<string, Set<Response>> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  public static getInstance(): RealtimeBroadcaster {
    if (!RealtimeBroadcaster.instance) {
      RealtimeBroadcaster.instance = new RealtimeBroadcaster();
    }
    return RealtimeBroadcaster.instance;
  }

  constructor() {
    this.startHeartbeat();
  }

  /**
   * Register a new Server-Sent Events (SSE) client stream
   */
  public registerClient(tenantId: string, res: Response): () => void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering (Nginx, Vercel)
    res.flushHeaders?.();

    if (!this.tenantClients.has(tenantId)) {
      this.tenantClients.set(tenantId, new Set());
    }
    const clientSet = this.tenantClients.get(tenantId)!;
    clientSet.add(res);

    // Initial connection acknowledgment
    const connectPayload = JSON.stringify({
      connected: true,
      tenant_id: tenantId,
      timestamp: new Date().toISOString(),
      active_connections: clientSet.size,
    });
    res.write(`event: CONNECTED\ndata: ${connectPayload}\n\n`);

    const cleanup = () => {
      clientSet.delete(res);
      if (clientSet.size === 0) {
        this.tenantClients.delete(tenantId);
      }
    };

    res.on('close', cleanup);
    res.on('error', cleanup);

    return cleanup;
  }

  /**
   * Broadcast an event message to all connected clients for a specific tenant
   */
  public broadcastToTenant(tenantId: string, type: RealtimeEventType, data: any): void {
    const clientSet = this.tenantClients.get(tenantId);
    if (!clientSet || clientSet.size === 0) return;

    const message: RealtimeMessage = {
      type,
      tenant_id: tenantId,
      timestamp: new Date().toISOString(),
      data,
    };

    const payloadString = `event: ${type}\ndata: ${JSON.stringify(message)}\n\n`;

    for (const client of clientSet) {
      try {
        client.write(payloadString);
      } catch (err) {
        clientSet.delete(client);
      }
    }
  }

  /**
   * Keepalive heartbeat to prevent connection drops
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      for (const [_, clientSet] of this.tenantClients.entries()) {
        for (const client of clientSet) {
          try {
            client.write(':keepalive\n\n');
          } catch {
            clientSet.delete(client);
          }
        }
      }
    }, 20000);
    this.heartbeatTimer.unref?.();
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public getActiveConnectionCount(tenantId?: string): number {
    if (tenantId) {
      return this.tenantClients.get(tenantId)?.size || 0;
    }
    let total = 0;
    for (const set of this.tenantClients.values()) {
      total += set.size;
    }
    return total;
  }
}
