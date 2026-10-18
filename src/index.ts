/**
 * Tiny, fully typed event emitter.
 *
 * @example
 * import { Emitter } from "typemit";
 *
 * const chat = new Emitter<{ message: [text: string, from: string]; close: [] }>();
 * chat.on("message", (text, from) => console.log(`${from}: ${text}`));
 * chat.emit("message", "hi", "ada");
 */

/**
 * Arguments of an event, from its entry in the event map:
 * a tuple (`[text: string]`), a function type (`(text: string) => void`),
 * `void`/`undefined` for no arguments, or any other type for a single argument.
 */
export type EventArgs<T> = T extends (...args: infer A) => unknown
  ? A
  : T extends readonly unknown[]
    ? T
    : [T] extends [void]
      ? []
      : [T];

/** A listener for one event. */
export type Listener<Events, K extends keyof Events> = (...args: EventArgs<Events[K]>) => unknown;

/** A listener for every event: gets the event name, then its arguments. */
export type AnyListener<Events> = (...args: { [K in keyof Events]: [event: K, ...args: EventArgs<Events[K]>] }[keyof Events]) => unknown;

export interface ListenOptions {
  /** Remove the listener when this signal aborts. */
  signal?: AbortSignal;
  /** Remove the listener after its first call. */
  once?: boolean;
}

export interface WaitOptions<A extends readonly unknown[]> {
  /** Reject with the signal's reason when it aborts. */
  signal?: AbortSignal;
  /** Reject with a `TimeoutError` after this many milliseconds. */
  timeout?: number;
  /** Only resolve for emissions whose arguments pass this test. */
  filter?: (...args: A) => boolean;
}

interface Entry {
  fn: (...args: never[]) => unknown;
  once: boolean;
  cleanup: (() => void) | undefined;
}

const ANY: unique symbol = Symbol("any");

/** A typed event emitter. `Events` maps each event name to its arguments. */
export class Emitter<Events extends object = Record<string, unknown[]>> {
  #listeners = new Map<PropertyKey, Entry[]>();

  /** Listen to an event. Returns a function that removes the listener. */
  on<K extends keyof Events>(event: K, listener: Listener<Events, K>, options: ListenOptions = {}): () => void {
    return this.#add(event, listener as Entry["fn"], options);
  }

  /** Listen to the next emission of an event only. */
  once<K extends keyof Events>(event: K, listener: Listener<Events, K>, options: Omit<ListenOptions, "once"> = {}): () => void {
    return this.#add(event, listener as Entry["fn"], { ...options, once: true });
  }

  /** Listen to every event. The listener gets the event name first. */
  onAny(listener: AnyListener<Events>, options: ListenOptions = {}): () => void {
    return this.#add(ANY, listener as Entry["fn"], options);
  }

  /** Remove a listener, or every listener of the event when none is given. */
  off<K extends keyof Events>(event: K, listener?: Listener<Events, K>): void {
    this.#remove(event, listener as Entry["fn"] | undefined);
  }

  /** Remove a wildcard listener, or all of them. */
  offAny(listener?: AnyListener<Events>): void {
    this.#remove(ANY, listener as Entry["fn"] | undefined);
  }

  /**
   * Call every listener of the event, in the order they were added, then the wildcard listeners.
   * Returns `true` if anything was listening. A listener that throws stops the emit and the error propagates.
   */
  emit<K extends keyof Events>(event: K, ...args: EventArgs<Events[K]>): boolean {
    const own = this.#listeners.get(event);
    const any = this.#listeners.get(ANY);
    if (!own?.length && !any?.length) return false;
    // Snapshot, so listeners added or removed during the emit don't change this round.
    for (const entry of own ? [...own] : []) {
      if (entry.once) this.#removeEntry(event, entry);
      (entry.fn as (...a: unknown[]) => unknown)(...args);
    }
    for (const entry of any ? [...any] : []) {
      if (entry.once) this.#removeEntry(ANY, entry);
      (entry.fn as (...a: unknown[]) => unknown)(event, ...args);
    }
    return true;
  }

  /**
   * Like {@link emit}, but awaits every listener (in parallel) and rejects if any of them
   * throws or rejects. Returns `true` if anything was listening.
   */
  async emitAsync<K extends keyof Events>(event: K, ...args: EventArgs<Events[K]>): Promise<boolean> {
    const own = this.#listeners.get(event);
    const any = this.#listeners.get(ANY);
    if (!own?.length && !any?.length) return false;
    const calls: unknown[] = [];
    for (const entry of own ? [...own] : []) {
      if (entry.once) this.#removeEntry(event, entry);
      calls.push(Promise.resolve().then(() => (entry.fn as (...a: unknown[]) => unknown)(...args)));
    }
    for (const entry of any ? [...any] : []) {
      if (entry.once) this.#removeEntry(ANY, entry);
      calls.push(Promise.resolve().then(() => (entry.fn as (...a: unknown[]) => unknown)(event, ...args)));
    }
    await Promise.all(calls);
    return true;
  }

  /** A promise of the next emission's arguments. */
  waitFor<K extends keyof Events>(event: K, options: WaitOptions<EventArgs<Events[K]>> = {}): Promise<EventArgs<Events[K]>> {
    return new Promise((resolve, reject) => {
      const { signal, timeout, filter } = options;
      if (signal?.aborted) return reject(signal.reason);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        off();
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const off = this.on(event, ((...args: EventArgs<Events[K]>) => {
        if (filter && !filter(...args)) return;
        done();
        resolve(args);
      }) as Listener<Events, K>);
      const onAbort = () => {
        done();
        reject(signal!.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (timeout !== undefined) {
        timer = setTimeout(() => {
          done();
          const error = new Error(`Timed out after ${timeout} ms waiting for "${String(event)}".`);
          error.name = "TimeoutError";
          reject(error);
        }, timeout);
      }
    });
  }

  /**
   * Iterate over emissions with `for await`. Emissions are buffered, so none are missed
   * between iterations. Ends when the signal aborts or the loop breaks.
   */
  events<K extends keyof Events>(event: K, options: { signal?: AbortSignal } = {}): AsyncIterableIterator<EventArgs<Events[K]>> {
    const buffer: EventArgs<Events[K]>[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    const finish = () => {
      finished = true;
      off();
      wake?.();
    };
    const off = this.on(event, ((...args: EventArgs<Events[K]>) => {
      buffer.push(args);
      wake?.();
    }) as Listener<Events, K>, options.signal ? { signal: options.signal } : {});
    options.signal?.addEventListener("abort", finish, { once: true });
    if (options.signal?.aborted) finish();
    const iterator: AsyncIterableIterator<EventArgs<Events[K]>> = {
      next: async () => {
        while (buffer.length === 0 && !finished) await new Promise<void>((r) => (wake = r));
        wake = undefined;
        if (buffer.length > 0) return { value: buffer.shift()!, done: false };
        return { value: undefined, done: true };
      },
      return: async () => {
        finish();
        buffer.length = 0;
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
    return iterator;
  }

  /** Number of listeners for an event, or for all events (wildcards included) when none is given. */
  listenerCount(event?: keyof Events): number {
    if (event !== undefined) return this.#listeners.get(event)?.length ?? 0;
    let total = 0;
    for (const list of this.#listeners.values()) total += list.length;
    return total;
  }

  /** Names of the events that have listeners. */
  eventNames(): (keyof Events)[] {
    return [...this.#listeners.keys()].filter((k) => k !== ANY) as (keyof Events)[];
  }

  /** Remove every listener of an event, or of all events. */
  clear(event?: keyof Events): void {
    const keys = event === undefined ? [...this.#listeners.keys()] : [event];
    for (const key of keys) {
      for (const entry of this.#listeners.get(key) ?? []) entry.cleanup?.();
      this.#listeners.delete(key);
    }
  }

  #add(key: PropertyKey, fn: Entry["fn"], options: ListenOptions): () => void {
    if (typeof fn !== "function") throw new TypeError(`The listener for "${String(key)}" must be a function.`);
    const { signal } = options;
    const entry: Entry = { fn, once: options.once === true, cleanup: undefined };
    if (signal?.aborted) return () => {};
    if (signal) {
      const onAbort = () => this.#removeEntry(key, entry);
      signal.addEventListener("abort", onAbort, { once: true });
      entry.cleanup = () => signal.removeEventListener("abort", onAbort);
    }
    const list = this.#listeners.get(key);
    if (list) list.push(entry);
    else this.#listeners.set(key, [entry]);
    return () => this.#removeEntry(key, entry);
  }

  #remove(key: PropertyKey, fn: Entry["fn"] | undefined): void {
    const list = this.#listeners.get(key);
    if (!list) return;
    if (fn === undefined) return this.clear(key as keyof Events);
    // Remove the most recently added match, like Node's EventEmitter.
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.fn === fn) {
        this.#removeEntry(key, list[i]!);
        return;
      }
    }
  }

  #removeEntry(key: PropertyKey, entry: Entry): void {
    const list = this.#listeners.get(key);
    if (!list) return;
    const i = list.indexOf(entry);
    if (i === -1) return;
    list.splice(i, 1);
    entry.cleanup?.();
    if (list.length === 0) this.#listeners.delete(key);
  }
}

/** Same as `new Emitter<Events>()`. */
export function createEmitter<Events extends object = Record<string, unknown[]>>(): Emitter<Events> {
  return new Emitter<Events>();
}

export default Emitter;
