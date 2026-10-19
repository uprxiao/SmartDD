export interface TerminalFitSize { cols: number; rows: number }
export interface TerminalFitScheduler { request(): void; dispose(): void }

/** One visible fit per frame; changing pixels need not change PTY cells. */
export function createTerminalFitScheduler(deps: {
  ready(): boolean;
  measure(): TerminalFitSize | null;
  send(size: TerminalFitSize): void;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}): TerminalFitScheduler {
  let frame: number | null = null, disposed = false, last: TerminalFitSize | null = null;
  return {
    request() {
      if (disposed || frame !== null || !deps.ready()) return;
      frame = deps.requestFrame(() => {
        frame = null;
        if (disposed || !deps.ready()) return;
        const size = deps.measure();
        if (!size || !Number.isSafeInteger(size.cols) || !Number.isSafeInteger(size.rows) || size.cols < 1 || size.rows < 1) return;
        if (last?.cols === size.cols && last.rows === size.rows) return;
        deps.send(size);
        last = { ...size };
      });
    },
    dispose() {
      disposed = true;
      if (frame !== null) deps.cancelFrame(frame);
      frame = null;
    },
  };
}
