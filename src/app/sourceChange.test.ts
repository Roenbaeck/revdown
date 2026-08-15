import { SourceChangeVerifier } from "./sourceChange";

describe("SourceChangeVerifier", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces event bursts and reports only changed source bytes", async () => {
    const check = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onChanged = vi.fn();
    const verifier = new SourceChangeVerifier({
      delayMs: 200,
      check,
      onChanged,
      onError: vi.fn(),
    });

    verifier.notify();
    verifier.notify();
    await vi.advanceTimersByTimeAsync(199);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledOnce();
    expect(onChanged).not.toHaveBeenCalled();

    verifier.notify();
    await vi.advanceTimersByTimeAsync(200);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("suppresses pending and in-flight results after disposal", async () => {
    let resolveCheck: ((changed: boolean) => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const onChanged = vi.fn();
    const verifier = new SourceChangeVerifier({
      delayMs: 200,
      check,
      onChanged,
      onError: vi.fn(),
    });

    verifier.notify();
    await vi.advanceTimersByTimeAsync(200);
    verifier.dispose();
    resolveCheck?.(true);
    await Promise.resolve();
    expect(onChanged).not.toHaveBeenCalled();

    verifier.notify();
    await vi.advanceTimersByTimeAsync(200);
    expect(check).toHaveBeenCalledOnce();
  });
});
