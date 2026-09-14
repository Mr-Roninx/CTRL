"use client";

export type SSEConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING';

export interface SSERealtimeMessage<T = any> {
  type: string;
  tenant_id?: string;
  timestamp: string;
  data: T;
}

export type SSEListener<T = any> = (message: SSERealtimeMessage<T>) => void;

/**
 * Resilient Server-Sent Events (SSE) Client with deterministic sub-2s reconnection backoff,
 * heartbeat liveness tracking, and typed event dispatch.
 */
export class ResilientSSEClient {
  private static instance: ResilientSSEClient | null = null;
  private eventSource: EventSource | null = null;
  private listeners: Map<string, Set<SSEListener>> = new Map();
  private state: SSEConnectionState = 'DISCONNECTED';
  private stateListeners: Set<(state: SSEConnectionState) => void> = new Set();
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectIntervalMs = 2000; // Invariant: Reconnect < 2s
  private readonly baseReconnectIntervalMs = 500;
  private lastHeartbeat = 0;

  private constructor() {}

  public static getInstance(): ResilientSSEClient {
    if (!ResilientSSEClient.instance) {
      ResilientSSEClient.instance = new ResilientSSEClient();
    }
    return ResilientSSEClient.instance;
  }

  public getState(): SSEConnectionState {
    return this.state;
  }

  public onStateChange(listener: (state: SSEConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  private setState(newState: SSEConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateListeners.forEach((fn) => {
        try {
          fn(newState);
        } catch (e) {
          console.error("SSE state listener error:", e);
        }
      });
    }
  }

  public connect(customBaseUrl?: string, tokenOverride?: string): void {
    if (typeof window === "undefined") return;
    if (this.eventSource && (this.state === 'CONNECTED' || this.state === 'CONNECTING')) return;

    this.cleanup();
    this.setState('CONNECTING');

    const apiBase = customBaseUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    const token = tokenOverride || localStorage.getItem("ctrl_session_token") || localStorage.getItem("ctrl_token") || "";

    // Stream URL with token query param for EventSource compatibility
    const url = `${apiBase}/v1/events/live-stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;

    try {
      this.eventSource = new EventSource(url, { withCredentials: false });

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.lastHeartbeat = Date.now();
        this.setState('CONNECTED');
        this.startHeartbeatMonitor();
      };

      this.eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          this.dispatchMessage(parsed.type || 'MESSAGE', parsed);
        } catch {
          // Handled raw text
        }
      };

      // Custom event listener bindings
      const eventTypes = [
        'CONNECTED', 'HEARTBEAT', 'EVENT_INGESTED', 'NOTIFICATION_CREATED',
        'OPPORTUNITY_UPDATED', 'SWEEP_COMPLETED', 'CONNECTION_STATUS', 'AGENT_RUN_FINISHED'
      ];

      eventTypes.forEach((type) => {
        this.eventSource?.addEventListener(type, (event: any) => {
          this.lastHeartbeat = Date.now();
          if (type === 'HEARTBEAT') return;

          try {
            const parsed = JSON.parse(event.data);
            this.dispatchMessage(type, parsed);
          } catch {
            this.dispatchMessage(type, { raw: event.data });
          }
        });
      });

      this.eventSource.onerror = () => {
        this.handleDisconnect();
      };
    } catch (err) {
      console.warn("⚠️ Failed to initialize EventSource:", err);
      this.handleDisconnect();
    }
  }

  private handleDisconnect(): void {
    this.cleanup();
    this.setState('RECONNECTING');

    // Exponential backoff capped at 2000ms
    const delay = Math.min(
      this.baseReconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts),
      this.maxReconnectIntervalMs
    );
    this.reconnectAttempts += 1;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeatMonitor(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.state === 'CONNECTED' && Date.now() - this.lastHeartbeat > 25000) {
        // Heartbeat timeout (30s heartbeat interval from server)
        console.warn("⚠️ SSE Heartbeat missed > 25s, reconnecting...");
        this.handleDisconnect();
      }
    }, 5000);
  }

  private dispatchMessage(type: string, data: any): void {
    const message: SSERealtimeMessage = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    const specificSet = this.listeners.get(type);
    if (specificSet) {
      specificSet.forEach((fn) => {
        try {
          fn(message);
        } catch (e) {
          console.error(`Error in SSE listener for [${type}]:`, e);
        }
      });
    }

    const wildcardSet = this.listeners.get('*');
    if (wildcardSet) {
      wildcardSet.forEach((fn) => {
        try {
          fn(message);
        } catch (e) {
          console.error(`Error in wildcard SSE listener:`, e);
        }
      });
    }
  }

  public subscribe<T = any>(eventType: string, listener: SSEListener<T>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    const set = this.listeners.get(eventType)!;
    set.add(listener as SSEListener);

    return () => {
      set.delete(listener as SSEListener);
      if (set.size === 0) {
        this.listeners.delete(eventType);
      }
    };
  }

  public disconnect(): void {
    this.cleanup();
    this.setState('DISCONNECTED');
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

export const sseClient = ResilientSSEClient.getInstance();
