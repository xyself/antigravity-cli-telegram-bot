import type { ChatId } from "./types.js";

export interface QueueJob {
  chatId: ChatId;
  prompt?: string;
  kind?: "prompt" | "usage" | "credits" | "context" | "compact" | "btw";
  id?: string;
  enqueuedAt?: number;
  imagePath?: string;
  imagePaths?: string[];
  documentPath?: string;
  documentPaths?: string[];
  documentName?: string;
  mediaPath?: string;
  mediaPaths?: string[];
  mediaType?: string;
  wasVoiceInput?: boolean;
  /** Times this job has already been auto-resumed after a service restart. */
  resumeCount?: number;
}
export interface QueueStatus {
  active: (QueueJob & { cancel: () => boolean }) | null;
  queued: number;
  totalQueued: number;
  activeBtw?: (QueueJob & { cancel: () => boolean }) | null;
  queuedBtw?: number;
}
type Worker = (job: QueueJob, isCancelled: () => boolean) => Promise<void>;

export interface JobQueueOptions {
  /** Invoked on every cancelForChat so owners can abort associated work. */
  onCancel?: (chatId: ChatId, includeBtw: boolean) => void;
  maxConcurrent?: number;
}

export class JobQueue {
  private readonly pending: QueueJob[] = [];
  private readonly activeJobs: Map<string, QueueJob & { cancel: () => boolean }> = new Map();
  private readonly pendingBtw: QueueJob[] = [];
  private readonly activeBtwJobs: Map<string, QueueJob & { cancel: () => boolean }> = new Map();
  private sequence = 0;
  private isDraining = false;
  private isDrainingBtw = false;
  private readonly maxConcurrent: number;

  public constructor(
    private readonly maxSize: number,
    private readonly worker: Worker,
    private readonly options: JobQueueOptions = {}
  ) {
    this.maxConcurrent = options.maxConcurrent ?? 1;
  }

  public enqueue(job: QueueJob): { accepted: boolean; reason?: string; jobId?: string; position?: number } {
    if (job.kind === "btw") {
      if (this.pendingBtw.length >= this.maxSize) return { accepted: false, reason: "queue_full" };
      const queued = { ...job, id: `btw-${++this.sequence}`, enqueuedAt: Date.now() };
      const chatKey = String(job.chatId);
      const alreadyRunningBtw = this.activeBtwJobs.has(chatKey);
      this.pendingBtw.push(queued);
      const position = alreadyRunningBtw
        ? this.pendingBtw.filter((item) => String(item.chatId) === chatKey).length
        : 0;
      void this.drainBtw().catch((err) => console.error("[queue] DrainBtw unhandled error:", err));
      return { accepted: true, jobId: queued.id, position };
    }

    if (this.pending.length >= this.maxSize) return { accepted: false, reason: "queue_full" };
    const queued = { ...job, id: `job-${++this.sequence}`, enqueuedAt: Date.now() };
    this.pending.push(queued);
    void this.drain().catch((err) => console.error("[queue] Drain unhandled error:", err));
    return { accepted: true, jobId: queued.id, position: this.pending.length };
  }

  public cancelForChat(chatId: ChatId, options?: { includeBtw?: boolean }): { removed: number; activeCancelled: boolean } {
    const includeBtw = options?.includeBtw !== false;
    const key = String(chatId);
    const before = this.pending.length;
    this.pending.splice(0, this.pending.length, ...this.pending.filter((job) => String(job.chatId) !== key));
    let removed = before - this.pending.length;

    const active = this.activeJobs.get(key);
    let activeCancelled = active ? active.cancel() : false;

    if (includeBtw) {
      const beforeBtw = this.pendingBtw.length;
      this.pendingBtw.splice(0, this.pendingBtw.length, ...this.pendingBtw.filter((job) => String(job.chatId) !== key));
      removed += beforeBtw - this.pendingBtw.length;
      const activeBtw = this.activeBtwJobs.get(key);
      if (activeBtw) {
        activeCancelled = activeBtw.cancel() || activeCancelled;
      }
    }

    this.options.onCancel?.(chatId, includeBtw);
    return { removed, activeCancelled };
  }

  public pendingForChat(chatId: ChatId): QueueJob[] {
    const key = String(chatId);
    return this.pending.filter((job) => String(job.chatId) === key);
  }

  public statusForChat(chatId: ChatId): QueueStatus {
    const key = String(chatId);
    return {
      active: this.activeJobs.get(key) || null,
      queued: this.pending.filter((job) => String(job.chatId) === key).length,
      totalQueued: this.pending.length,
      activeBtw: this.activeBtwJobs.get(key) || null,
      queuedBtw: this.pendingBtw.filter((job) => String(job.chatId) === key).length,
    };
  }

  private async drainBtw(): Promise<void> {
    if (this.isDrainingBtw) return;
    this.isDrainingBtw = true;
    try {
      while (this.pendingBtw.length > 0) {
        const jobIndex = this.pendingBtw.findIndex((job) => !this.activeBtwJobs.has(String(job.chatId)));
        if (jobIndex === -1) break;

        const job = this.pendingBtw.splice(jobIndex, 1)[0];
        const chatKey = String(job.chatId);
        let cancelled = false;
        const activeItem = { ...job, cancel: () => { cancelled = true; return true; } };
        this.activeBtwJobs.set(chatKey, activeItem);

        void (async () => {
          try {
            await this.worker(job, () => cancelled);
          } catch (workerError) {
            console.error(`[queue] Side-channel (/btw) worker error for chat ${job.chatId}:`, workerError);
          } finally {
            this.activeBtwJobs.delete(chatKey);
            void this.drainBtw().catch((err) => console.error("[queue] DrainBtw error after worker finish:", err));
          }
        })();
      }
    } finally {
      this.isDrainingBtw = false;
    }
  }

  private async drain(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;
    try {
      while (this.activeJobs.size < this.maxConcurrent && this.pending.length > 0) {
        const jobIndex = this.pending.findIndex((job) => !this.activeJobs.has(String(job.chatId)));
        if (jobIndex === -1) break;

        const job = this.pending.splice(jobIndex, 1)[0];
        const chatKey = String(job.chatId);
        let cancelled = false;
        const activeItem = { ...job, cancel: () => { cancelled = true; return true; } };
        this.activeJobs.set(chatKey, activeItem);

        void (async () => {
          try {
            await this.worker(job, () => cancelled);
          } catch (workerError) {
            console.error(`[queue] Worker execution error for chat ${job.chatId}:`, workerError);
          } finally {
            this.activeJobs.delete(chatKey);
            void this.drain().catch((err) => console.error("[queue] Drain error after worker finish:", err));
          }
        })();
      }
    } finally {
      this.isDraining = false;
    }
  }
}
