import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmitter, Emitter, type EventArgs } from "../dist/index.js";

type Events = {
  message: [text: string, from: string];
  count: number;
  close: void;
  fn: (a: boolean, b?: number) => void;
};

describe("Emitter", () => {
  it("calls listeners with typed arguments, in order", () => {
    const e = new Emitter<Events>();
    const seen: string[] = [];
    e.on("message", (text, from) => seen.push(`1:${from}:${text}`));
    e.on("message", (text) => seen.push(`2:${text.toUpperCase()}`));
    e.on("count", (n) => seen.push(`n=${n.toFixed(1)}`));
    e.on("close", () => seen.push("closed"));
    e.on("fn", (a, b) => seen.push(`fn:${a}:${b}`));
    assert.equal(e.emit("message", "hi", "ada"), true);
    e.emit("count", 2);
    e.emit("close");
    e.emit("fn", true, 3);
    assert.deepEqual(seen, ["1:ada:hi", "2:HI", "n=2.0", "closed", "fn:true:3"]);
    assert.equal(createEmitter<Events>().emit("close"), false);
  });

  it("removes listeners with the returned function, off(), once and AbortSignal", () => {
    const e = new Emitter<Events>();
    const calls: string[] = [];
    const a = () => calls.push("a");
    const off = e.on("close", a);
    e.once("close", () => calls.push("once"));
    const ac = new AbortController();
    e.on("close", () => calls.push("signal"), { signal: ac.signal });
    e.emit("close");
    off();
    ac.abort();
    e.emit("close");
    assert.deepEqual(calls, ["a", "once", "signal"]);
    e.on("close", a);
    e.on("close", a);
    e.off("close", a);
    assert.equal(e.listenerCount("close"), 1);
    e.off("close");
    assert.equal(e.listenerCount(), 0);
    e.on("close", a, { signal: AbortSignal.abort() });
    assert.equal(e.listenerCount("close"), 0, "an already-aborted signal adds nothing");
  });

  it("onAny gets the event name and arguments", () => {
    const e = new Emitter<Events>();
    const seen: unknown[][] = [];
    const off = e.onAny((...args) => seen.push(args));
    e.emit("message", "x", "y");
    e.emit("close");
    off();
    e.emit("count", 1);
    assert.deepEqual(seen, [["message", "x", "y"], ["close"]]);
  });

  it("snapshots listeners during emit", () => {
    const e = new Emitter<{ tick: [] }>();
    const calls: string[] = [];
    e.on("tick", () => {
      calls.push("first");
      e.on("tick", () => calls.push("added"));
      e.off("tick", second);
    });
    const second = () => calls.push("second");
    e.on("tick", second);
    e.emit("tick");
    assert.deepEqual(calls, ["first", "second"]);
  });

  it("waitFor resolves with the arguments, honours filter, timeout and signal", async () => {
    const e = new Emitter<Events>();
    setTimeout(() => {
      e.emit("message", "skip", "bot");
      e.emit("message", "hello", "ada");
    }, 5);
    assert.deepEqual(await e.waitFor("message", { filter: (_t, from) => from !== "bot" }), ["hello", "ada"]);
    await assert.rejects(e.waitFor("close", { timeout: 10 }), { name: "TimeoutError" });
    const ac = new AbortController();
    const waiting = e.waitFor("close", { signal: ac.signal });
    ac.abort(new Error("stop"));
    await assert.rejects(waiting, /stop/);
    assert.equal(e.listenerCount(), 0, "waitFor cleans up after itself");
  });

  it("events() is an async iterator that buffers", async () => {
    const e = new Emitter<Events>();
    const ac = new AbortController();
    const got: number[] = [];
    const reading = (async () => {
      for await (const [n] of e.events("count", { signal: ac.signal })) {
        got.push(n);
        if (n === 3) break;
      }
    })();
    e.emit("count", 1);
    e.emit("count", 2);
    await new Promise((r) => setTimeout(r, 1));
    e.emit("count", 3);
    e.emit("count", 4);
    await reading;
    assert.deepEqual(got, [1, 2, 3]);
    assert.equal(e.listenerCount("count"), 0);
  });

  it("emitAsync awaits listeners and propagates errors", async () => {
    const e = new Emitter<{ save: [id: number] }>();
    const done: number[] = [];
    e.on("save", async (id) => {
      await new Promise((r) => setTimeout(r, 5));
      done.push(id);
    });
    assert.equal(await e.emitAsync("save", 7), true);
    assert.deepEqual(done, [7]);
    e.on("save", () => {
      throw new Error("nope");
    });
    await assert.rejects(e.emitAsync("save", 8), /nope/);
  });

  it("emit lets listener errors propagate, and rejects non-function listeners", () => {
    const e = new Emitter<{ x: [] }>();
    e.on("x", () => {
      throw new Error("boom");
    });
    assert.throws(() => e.emit("x"), /boom/);
    assert.throws(() => e.on("x", "nope" as never), /must be a function/);
  });

  it("supports symbol keys and reports event names", () => {
    const key = Symbol("k");
    const e = new Emitter<{ [key]: [string]; plain: [] }>();
    let got = "";
    e.on(key, (v) => (got = v));
    e.on("plain", () => {});
    e.emit(key, "sym");
    assert.equal(got, "sym");
    assert.deepEqual(e.eventNames(), [key, "plain"]);
    e.clear();
    assert.deepEqual(e.eventNames(), []);
  });
});

// Compile-time checks: these lines fail `npm run lint` if the types regress.
type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export type TypeTests = [
  Expect<Equal<EventArgs<[a: string]>, [a: string]>>,
  Expect<Equal<EventArgs<number>, [number]>>,
  Expect<Equal<EventArgs<void>, []>>,
  Expect<Equal<EventArgs<(a: boolean) => void>, [a: boolean]>>,
];
const typed = new Emitter<Events>();
// @ts-expect-error wrong argument type
typed.emit("count", "1");
// @ts-expect-error unknown event
typed.emit("nope");
// @ts-expect-error missing argument
typed.emit("message", "only one");
