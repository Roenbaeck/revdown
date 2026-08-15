type SourceChangeVerifierOptions = {
  delayMs: number;
  check: () => Promise<boolean>;
  onChanged: () => void;
  onError: (error: unknown) => void;
};

export class SourceChangeVerifier {
  private timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly options: SourceChangeVerifierOptions) {}

  readonly notify = (): void => {
    if (this.disposed) return;
    if (this.timeout !== undefined) globalThis.clearTimeout(this.timeout);
    this.timeout = globalThis.setTimeout(() => {
      this.timeout = undefined;
      void this.options
        .check()
        .then((changed) => {
          if (!this.disposed && changed) this.options.onChanged();
        })
        .catch((error: unknown) => {
          if (!this.disposed) this.options.onError(error);
        });
    }, this.options.delayMs);
  };

  dispose(): void {
    this.disposed = true;
    if (this.timeout !== undefined) globalThis.clearTimeout(this.timeout);
    this.timeout = undefined;
  }
}
