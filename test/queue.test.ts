import test from "node:test";
import assert from "node:assert/strict";
import { JobQueue } from "../src/queue.js";

test("processes one job at a time and preserves queue order", async () => {
  const seen: string[] = []; let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const queue = new JobQueue(2, async (job) => { seen.push(job.prompt); if (job.prompt === "first") await gate; });
  assert.equal(queue.enqueue({ chatId: 1, prompt: "first" }).accepted, true); assert.equal(queue.enqueue({ chatId: 1, prompt: "second" }).accepted, true); assert.equal(queue.enqueue({ chatId: 1, prompt: "third" }).accepted, true); assert.equal(queue.enqueue({ chatId: 1, prompt: "fourth" }).accepted, false);
  await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(seen, ["first"]); release(); await new Promise((resolve) => setTimeout(resolve, 20)); assert.deepEqual(seen, ["first", "second", "third"]);
});

test("cancels queued jobs for one chat without touching another", () => { const queue = new JobQueue(4, async () => undefined); queue.enqueue({ chatId: 1, prompt: "one" }); queue.enqueue({ chatId: 2, prompt: "two" }); queue.enqueue({ chatId: 1, prompt: "three" }); const result = queue.cancelForChat(1); assert.equal(result.removed, 1); assert.equal(queue.statusForChat(1).queued, 0); assert.equal(queue.statusForChat(2).queued, 1); });

test("btw side-channel runs immediately in parallel with an active main job for the same chat", async () => {
  const events: string[] = [];
  let releaseMain!: () => void;
  const mainGate = new Promise<void>((resolve) => { releaseMain = resolve; });

  const queue = new JobQueue(4, async (job) => {
    events.push(`start:${job.kind || "prompt"}:${job.prompt}`);
    if (job.kind !== "btw") {
      await mainGate;
    }
    events.push(`end:${job.kind || "prompt"}:${job.prompt}`);
  });

  // Start a long-running main job on chat 1
  const mainRes = queue.enqueue({ chatId: 1, kind: "prompt", prompt: "long-task" });
  assert.equal(mainRes.accepted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start:prompt:long-task"]);

  // Enqueue a /btw side question on the SAME chat 1 while main job is still active
  const btwRes = queue.enqueue({ chatId: 1, kind: "btw", prompt: "quick-question" });
  assert.equal(btwRes.accepted, true);
  assert.equal(btwRes.position, 0);

  // Give microtasks a tick: btw must BOTH start and finish while main job is still blocked!
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(events, [
    "start:prompt:long-task",
    "start:btw:quick-question",
    "end:btw:quick-question",
  ]);

  // Now finish main job
  releaseMain();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(events, [
    "start:prompt:long-task",
    "start:btw:quick-question",
    "end:btw:quick-question",
    "end:prompt:long-task",
  ]);
});

test("cancelForChat respects includeBtw option to preserve or cancel side-channel jobs", async () => {
  let mainCancelled = false;
  let btwCancelled = false;
  let releaseMain!: () => void;
  let releaseBtw!: () => void;
  const mainGate = new Promise<void>((resolve) => { releaseMain = resolve; });
  const btwGate = new Promise<void>((resolve) => { releaseBtw = resolve; });

  const queue = new JobQueue(4, async (job, isCancelled) => {
    if (job.kind === "btw") {
      await btwGate;
      btwCancelled = isCancelled();
    } else {
      await mainGate;
      mainCancelled = isCancelled();
    }
  });

  queue.enqueue({ chatId: 1, kind: "prompt", prompt: "main" });
  queue.enqueue({ chatId: 1, kind: "btw", prompt: "side" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(queue.statusForChat(1).active);
  assert.ok(queue.statusForChat(1).activeBtw);

  // Cancelling main only (e.g. autoInterrupt) must NOT cancel active btw
  queue.cancelForChat(1, { includeBtw: false });
  releaseMain();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(mainCancelled, true);
  assert.equal(btwCancelled, false);

  // Full cancel cancels btw too
  queue.cancelForChat(1);
  releaseBtw();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(btwCancelled, true);
});
