import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PixelJob, runPixelJob, WorkerJobError } from "./pixelWorker";

/** Stands in for a module worker: records what it was sent, replies when told to. */
class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: { message: Record<string, unknown>; transfer: Transferable[] } | null = null;
  terminated = false;
  constructor(public url: string) {
    FakeWorker.last = this;
  }
  postMessage(message: Record<string, unknown>, transfer: Transferable[]) {
    this.sent = { message, transfer };
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}

const job = (overrides: Partial<PixelJob<string>> = {}): PixelJob<string> => ({
  url: "/test/worker.js",
  label: "test encoder",
  failure: "Test encoding failed.",
  pixels: { data: new Uint8Array(2 * 2 * 4), width: 2, height: 2, flipY: true },
  params: { quality: 80 },
  timeout: { baseMs: 1000, perMegapixelMs: 0 },
  result: (out) => `got ${out.byteLength} bytes`,
  ...overrides,
});

beforeEach(() => vi.stubGlobal("Worker", FakeWorker));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runPixelJob", () => {
  it("sends the pixels (transferred) with the params, and maps the reply", async () => {
    const pixels = job().pixels;
    const promise = runPixelJob(job({ pixels }));
    const w = FakeWorker.last;
    expect(w.url).toBe("/test/worker.js");
    expect(w.sent?.message).toEqual({
      quality: 80,
      pixels: pixels.data.buffer,
      width: 2,
      height: 2,
      flipY: true,
    });
    expect(w.sent?.transfer).toEqual([pixels.data.buffer]);
    w.reply({ out: new ArrayBuffer(5) });
    await expect(promise).resolves.toBe("got 5 bytes");
    expect(w.terminated).toBe(true);
  });

  it("rejects with the worker's error, or the job's failure message, and terminates", async () => {
    const withReason = runPixelJob(job());
    FakeWorker.last.reply({ error: "out of memory" });
    await expect(withReason).rejects.toThrow(new WorkerJobError("out of memory"));
    expect(FakeWorker.last.terminated).toBe(true);

    const withoutReason = runPixelJob(job());
    FakeWorker.last.reply({});
    await expect(withoutReason).rejects.toThrow("Test encoding failed.");
  });

  it("rejects when the worker can't start or crashes", async () => {
    const promise = runPixelJob(job());
    const preventDefault = vi.fn();
    FakeWorker.last.onerror?.({ message: "", preventDefault });
    await expect(promise).rejects.toThrow("The test encoder couldn't be started.");
    expect(preventDefault).toHaveBeenCalled();
  });

  it("times out, scaled by the image size, and terminates", async () => {
    vi.useFakeTimers();
    const big = { data: new Uint8Array(4), width: 2000, height: 1000, flipY: false }; // 2 MP
    const promise = runPixelJob(
      job({ pixels: big, timeout: { baseMs: 1000, perMegapixelMs: 500 } }),
    );
    const settled = vi.fn();
    promise.catch(settled);
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toThrow("The test encoder timed out.");
    expect(FakeWorker.last.terminated).toBe(true);
  });

  it("rejects up front where workers aren't available", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(runPixelJob(job())).rejects.toThrow(WorkerJobError);
  });
});
