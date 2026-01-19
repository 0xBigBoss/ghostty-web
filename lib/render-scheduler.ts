export type RenderCallback = (now: number, scheduledAt: number | null) => void;

interface PendingRender {
  callback: RenderCallback;
  scheduledAt: number | null;
}

export class RenderScheduler {
  private pending = new Map<number, PendingRender>();
  private nextId = 1;
  private rafId?: number;

  schedule(callback: RenderCallback, scheduledAt: number | null): number {
    const id = this.nextId++;
    this.pending.set(id, { callback, scheduledAt });
    this.ensureRaf();
    return id;
  }

  cancel(id: number): void {
    this.pending.delete(id);
  }

  private ensureRaf(): void {
    if (this.rafId !== undefined) return;
    this.rafId = requestAnimationFrame((now) => this.flush(now));
  }

  private flush(now: number): void {
    this.rafId = undefined;
    if (this.pending.size === 0) {
      return;
    }
    const entries = Array.from(this.pending.values());
    this.pending.clear();
    for (const entry of entries) {
      entry.callback(now, entry.scheduledAt);
    }
    if (this.pending.size > 0) {
      this.ensureRaf();
    }
  }
}

export const renderScheduler = new RenderScheduler();
