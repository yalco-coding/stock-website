import type { MockEnvironment } from "../api/kiwoom.server";

type QueueItem<T> = {
  trId: string;
  priority: number;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type EnvironmentQueue = {
  running: boolean;
  items: QueueItem<unknown>[];
  lastRunByTr: Map<string, number>;
};

const globalQueues = globalThis as typeof globalThis & { __kiwoomTrQueues?: Map<MockEnvironment, EnvironmentQueue> };
const queues = globalQueues.__kiwoomTrQueues ??= new Map();
const MOCK_SAME_TR_INTERVAL_MS = 1_050;

function queueFor(environment: MockEnvironment) {
  let queue = queues.get(environment);
  if (!queue) {
    queue = { running: false, items: [], lastRunByTr: new Map() };
    queues.set(environment, queue);
  }
  return queue;
}

async function drain(environment: MockEnvironment) {
  const queue = queueFor(environment);
  if (queue.running) return;
  queue.running = true;
  try {
    while (queue.items.length > 0) {
      queue.items.sort((left: QueueItem<unknown>, right: QueueItem<unknown>) => right.priority - left.priority);
      const item = queue.items.shift()!;
      const waitMs = Math.max(0, (queue.lastRunByTr.get(item.trId) ?? 0) + MOCK_SAME_TR_INTERVAL_MS - Date.now());
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      queue.lastRunByTr.set(item.trId, Date.now());
      try {
        item.resolve(await item.run());
      } catch (error) {
        item.reject(error);
      }
    }
  } finally {
    queue.running = false;
    if (queue.items.length > 0) void drain(environment);
  }
}

export function scheduleKiwoomTr<T>(environment: MockEnvironment, trId: string, priority: number, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queueFor(environment).items.push({ trId, priority, run, resolve: resolve as (value: unknown) => void, reject });
    void drain(environment);
  });
}

export function getKiwoomQueueDepth(environment: MockEnvironment) {
  return queueFor(environment).items.length;
}

export function applyKiwoomBackoff(environment: MockEnvironment, trId: string, delayMs: number) {
  queueFor(environment).lastRunByTr.set(trId, Date.now() + Math.max(0, delayMs));
}
