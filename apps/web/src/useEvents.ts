import { useEffect, useRef } from 'react';
import type { DomainEventEnvelope } from './types';

/**
 * Subscribes to /v1/events (SSE) and invokes onEvent for every domain event.
 * Also invokes onTick roughly every 2s as a polling fallback so views refetch
 * even if the SSE connection drops (proxied dev servers, flaky networks, etc.).
 */
export function useEvents(onEvent: (e: DomainEventEnvelope) => void, onTick?: () => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let connected = false;

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => onTickRef.current?.(), 2000);
    };
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    try {
      es = new EventSource('/v1/events');
      es.onopen = () => {
        connected = true;
        stopPolling();
      };
      es.onerror = () => {
        connected = false;
        startPolling();
      };
      const events: DomainEventEnvelope['event'][] = [
        'sb.registered',
        'token.locked',
        'payout.confirmed',
        'match.proposed',
        'sb.realised',
        'ebrc.issued',
        'alert',
      ] as unknown as DomainEventEnvelope['event'][];
      for (const evt of events) {
        es.addEventListener(evt, (msg: MessageEvent) => {
          try {
            const parsed = JSON.parse(msg.data) as DomainEventEnvelope;
            onEventRef.current(parsed);
          } catch {
            // ignore malformed payloads
          }
        });
      }
    } catch {
      startPolling();
    }

    // Always keep a slow background poll as a belt-and-braces fallback even
    // when SSE looks connected, cheap, and covers silently-stalled streams.
    const safetyTimer = setInterval(() => {
      if (!connected) onTickRef.current?.();
    }, 2000);

    return () => {
      es?.close();
      stopPolling();
      clearInterval(safetyTimer);
    };
  }, []);
}
