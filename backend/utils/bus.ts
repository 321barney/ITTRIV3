// src/lib/bus.ts
import { EventEmitter } from 'events';

export type ConversationStart = {
  order_id: string;
  store_id: string;
  customer_id?: string | null;
};

export type WAOutbound = {
  order_id: string;
  to: string;
  text: string;
  conversation_id?: string;
};

export type WARender = {
  order_id: string;
  store_id: string;
  to: string;
  template?: string;
  text?: string;
  locale?: string;
  vars?: Record<string, string>;
  conversation_id?: string;
};

type EventMap = {
  'conversation.start': ConversationStart;
  'wa.dispatch': WAOutbound;
  'wa.render': WARender;
  // Node-style error channel
  error: { event: keyof EventMap; payload: unknown; error: unknown };
};

type Handler<T> = (payload: T) => void | Promise<void>;
type Unsubscribe = () => void;

const DEFAULT_TIMEOUT_MS = Number(process.env.BUS_HANDLER_TIMEOUT_MS ?? 15000);
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.BUS_HANDLER_CONCURRENCY ?? 8));

/**
 * A small concurrency pool for handler execution.
 */
async function withPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency = DEFAULT_CONCURRENCY
) {
  let i = 0;
  let running = 0;
  let err: unknown;
  return new Promise<void>((resolve, reject) => {
    const kick = () => {
      if (err) return; // stop spawning
      while (running < concurrency && i < items.length) {
        const idx = i++;
        running++;
        Promise.resolve(worker(items[idx], idx))
          .then(() => {
            running--;
            if (!err) {
              if (i >= items.length && running === 0) resolve();
              else kick();
            }
          })
          .catch((e) => {
            err = e;
            reject(e);
          });
      }
    };
    if (items.length === 0) resolve();
    else kick();
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label = 'bus-handler'): Promise<T> {
  if (!Number.isFinite(ms) || ms! <= 0) return p;
  let to: NodeJS.Timeout;
  const t = new Promise<T>((_, rej) => {
    to = setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(to!));
}

export class TypedBus extends EventEmitter {
  private metrics = {
    emitted: new Map<keyof EventMap, number>(),
    handled: new Map<keyof EventMap, number>(),
    failed: new Map<keyof EventMap, number>(),
  };

  onEvent<K extends keyof EventMap>(
    event: K,
    handler: Handler<EventMap[K]>,
    opts?: { signal?: AbortSignal }
  ): Unsubscribe {
    const wrapped = (payload: EventMap[K]) => handler(payload);
    this.on(event as string, wrapped);
    if (opts?.signal) {
      const abort = () => {
        this.off(event as string, wrapped);
      };
      if (opts.signal.aborted) abort();
      else opts.signal.addEventListener('abort', abort, { once: true });
    }
    return () => this.off(event as string, wrapped);
  }

  onceEvent<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): Unsubscribe {
    const wrapped = (payload: EventMap[K]) => handler(payload);
    this.once(event as string, wrapped);
    return () => this.off(event as string, wrapped);
  }

  onError(handler: Handler<EventMap['error']>): Unsubscribe {
    return this.onEvent('error', handler);
  }

  /**
   * Await the next event that matches a predicate (optional).
   */
  waitFor<K extends keyof EventMap>(
    event: K,
    predicate?: (p: EventMap[K]) => boolean | Promise<boolean>,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<EventMap[K]> {
    return withTimeout(
      new Promise<EventMap[K]>((resolve) => {
        const off = this.onEvent(event, async (payload) => {
          if (!predicate || (await predicate(payload))) {
            off();
            resolve(payload);
          }
        });
      }),
      timeoutMs,
      `waitFor(${String(event)})`
    );
  }

  /**
   * Emit + await all handlers (with timeout & concurrency).
   * Errors from handlers are surfaced and also emitted to 'error'.
   */
  async emitAsync<K extends keyof EventMap>(
    event: K,
    payload: EventMap[K],
    opts?: { timeoutMs?: number; concurrency?: number; swallowErrors?: boolean }
  ): Promise<void> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const concurrency = opts?.concurrency ?? DEFAULT_CONCURRENCY;

    // metrics: emitted
    this.metrics.emitted.set(event, (this.metrics.emitted.get(event) ?? 0) + 1);

    // Snapshot handlers at emit time
    const listeners = this.listeners(event as string) as Array<Handler<EventMap[K]>>;

    try {
      await withPool(
        listeners,
        async (fn) => {
          await withTimeout(Promise.resolve(fn(payload)), timeoutMs, `${String(event)} handler`);
          // metrics: handled
          this.metrics.handled.set(event, (this.metrics.handled.get(event) ?? 0) + 1);
        },
        concurrency
      );
    } catch (error) {
      // metrics: failed
      this.metrics.failed.set(event, (this.metrics.failed.get(event) ?? 0) + 1);
      // also publish to error channel (best-effort, do not await)
      super.emit('error', { event, payload, error });
      if (!opts?.swallowErrors) throw error;
    }
  }

  // ---- Convenience strongly-typed wrappers (same API you had) ----
  emitConversationStart(p: ConversationStart, opts?: { timeoutMs?: number; concurrency?: number }) {
    return this.emitAsync('conversation.start', p, opts);
  }
  onConversationStart(h: Handler<ConversationStart>, opts?: { signal?: AbortSignal }) {
    return this.onEvent('conversation.start', h, opts);
  }

  emitWADispatch(p: WAOutbound, opts?: { timeoutMs?: number; concurrency?: number }) {
    return this.emitAsync('wa.dispatch', p, opts);
  }
  onWADispatch(h: Handler<WAOutbound>, opts?: { signal?: AbortSignal }) {
    return this.onEvent('wa.dispatch', h, opts);
  }

  emitWARender(p: WARender, opts?: { timeoutMs?: number; concurrency?: number }) {
    return this.emitAsync('wa.render', p, opts);
  }
  onWARender(h: Handler<WARender>, opts?: { signal?: AbortSignal }) {
    return this.onEvent('wa.render', h, opts);
  }

  // Expose metrics for /diag use
  snapshotMetrics() {
    const toObj = (m: Map<any, number>) =>
      Array.from(m.entries()).reduce<Record<string, number>>((acc, [k, v]) => {
        acc[String(k)] = v;
        return acc;
      }, {});
    return {
      emitted: toObj(this.metrics.emitted),
      handled: toObj(this.metrics.handled),
      failed: toObj(this.metrics.failed),
      listenerCounts: {
        conversationStart: this.listenerCount('conversation.start'),
        waDispatch: this.listenerCount('wa.dispatch'),
        waRender: this.listenerCount('wa.render'),
        error: this.listenerCount('error'),
      },
    };
  }
}

export const bus = new TypedBus();

/* ============================
   Example usage in workers
   ============================

import { bus } from '../lib/bus';

const stop = bus.onWADispatch(async (msg) => {
  // send to provider…
}, { signal: abortController.signal });

// later: to emit and await all handlers
await bus.emitWADispatch({ order_id, to, text });

*/
