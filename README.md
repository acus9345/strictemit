# strictemit

A tiny, fully typed event emitter. About 1.1 kB minified and gzipped, zero dependencies, works in Node, Deno, Bun and browsers.

[![npm](https://img.shields.io/npm/v/strictemit)](https://www.npmjs.com/package/strictemit)
[![CI](https://github.com/acus9345/strictemit/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/strictemit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/strictemit)](LICENSE)

- **Typed end to end:** event names, argument types and argument counts are checked, and listeners get named, typed parameters.
- **Unsubscribe however you like:** the function `on()` returns, `off()`, `once`, or an `AbortSignal`.
- **Async helpers:** `await emitter.waitFor("ready")`, `for await (const [msg] of emitter.events("message"))`, and `emitAsync()` that awaits listeners.
- **Wildcard listeners** with `onAny()`, typed as a union of every event.

## Install

```bash
npm install strictemit
```

## Quick start

```ts
import { Emitter } from "strictemit";

type ChatEvents = {
  message: [text: string, from: string];
  typing: string; // one argument
  close: void; // no arguments
};

const chat = new Emitter<ChatEvents>();

const stop = chat.on("message", (text, from) => {
  console.log(`${from}: ${text}`); // text and from are strings
});

chat.emit("message", "hi!", "ada");
chat.emit("close");

stop(); // remove the listener

chat.emit("message", 42); // type error: 42 isn't a string, and `from` is missing
chat.emit("mesage", "hi", "ada"); // type error: no such event
```

The event map can use tuples (`[text: string]`, which also name the parameters), a single type (`string`), `void` for no arguments, or a function type (`(text: string) => void`).

## API

### `new Emitter<Events>()` / `createEmitter<Events>()`

### `on(event, listener, options?)`

Adds a listener and returns a function that removes it. Options:

- `once: true`: remove it after the first call.
- `signal`: remove it when the `AbortSignal` aborts. Handy for cleaning up a whole group of listeners at once:

```ts
const controller = new AbortController();
chat.on("message", render, { signal: controller.signal });
chat.on("typing", showTyping, { signal: controller.signal });
controller.abort(); // both are gone
```

### `once(event, listener, options?)`

Same as `on` with `once: true`.

### `off(event, listener?)`

Removes a listener (the most recently added one, if it was added twice), or every listener of the event when you leave `listener` out.

### `emit(event, ...args)`

Calls the event's listeners in the order they were added, then the wildcard listeners. Returns `true` if anything was listening. Listeners added or removed during an emit take effect from the next one. If a listener throws, the error propagates to the caller, like Node's `EventEmitter`.

### `emitAsync(event, ...args)`

Calls every listener, awaits them all in parallel, and rejects if any throws or rejects.

### `onAny(listener, options?)` / `offAny(listener?)`

Listens to every event. The listener receives the event name first:

```ts
chat.onAny((event, ...args) => log(event, args));
```

### `waitFor(event, options?)`

A promise of the next emission's arguments:

```ts
const [text, from] = await chat.waitFor("message", {
  filter: (_text, from) => from !== "bot",
  timeout: 5000, // rejects with a TimeoutError
  signal, // rejects with the signal's reason
});
```

### `events(event, options?)`

An async iterator over emissions. Emissions are buffered, so none are lost while your loop body runs. It stops when the loop breaks or `signal` aborts.

```ts
for await (const [text, from] of chat.events("message", { signal })) {
  await save(text, from);
}
```

### `listenerCount(event?)`, `eventNames()`, `clear(event?)`

Count listeners (of one event, or all), list events with listeners, and remove listeners (of one event, or all).

### Types

`EventArgs<T>` turns an event map entry into its argument tuple. `Listener<Events, K>` and `AnyListener<Events>` are the listener types, for writing helpers.

## Compared to others

| | strictemit | mitt | Node `EventEmitter` | eventemitter3 |
| --- | --- | --- | --- | --- |
| Typed events and arguments | ✓ | one payload per event | with recent `@types/node` | ✓ |
| `once` | ✓ | | ✓ | ✓ |
| `AbortSignal` on listeners | ✓ | | through `events.on` / `events.once` | |
| Promise and async iteration | ✓ | | through `events.on` / `events.once` | |
| Runs in browsers | ✓ | ✓ | | ✓ |

## License

MIT
