export const UPDATE_STARTUP_DELAY_MS = 10_000;
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

type Timers = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>;

// Shared single-flight policy covers both manual and scheduled checks.
export function createUpdateCheckScheduler(options: {
  packaged: boolean;
  check: () => Promise<unknown>;
  onError: (error: unknown) => void;
  timers?: Timers;
}) {
  const timers = options.timers ?? globalThis;
  let running: Promise<void> | undefined;
  let stopped = false;
  let startup: ReturnType<typeof setTimeout> | undefined;
  let daily: ReturnType<typeof setInterval> | undefined;
  const check = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (!running) {
      running = Promise.resolve().then(options.check).then(() => {}, options.onError)
        .finally(() => { running = undefined; });
    }
    return running;
  };
  if (options.packaged) {
    startup = timers.setTimeout(() => { void check(); }, UPDATE_STARTUP_DELAY_MS);
    daily = timers.setInterval(() => { void check(); }, UPDATE_INTERVAL_MS);
  }
  return {
    check,
    stop() {
      stopped = true;
      if (startup !== undefined) timers.clearTimeout(startup);
      if (daily !== undefined) timers.clearInterval(daily);
    },
  };
}
