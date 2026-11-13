import assert from "node:assert/strict";
import test from "node:test";
import { createHostQueue, laneOf } from "../src/core/host-queue.ts";

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Core requests share one lane; each plugin has its own", () => {
  assert.equal(laneOf({ op: "boot" }), "core");
  assert.equal(laneOf({ op: "git.status" }), "core");
  assert.equal(laneOf({ op: "plugin", id: "a", method: "network.fetch" }), "plugin:a");
  assert.notEqual(laneOf({ op: "plugin", id: "a" }), laneOf({ op: "plugin", id: "b" }));
  assert.equal(laneOf({ op: "dev.poll", id: "a" }), "dev:a");
  assert.notEqual(laneOf({ op: "dev.poll", id: "a" }), laneOf({ op: "plugin", id: "a" }));
  assert.equal(laneOf({ op: "pi_setup.status" }), "setup");
  assert.equal(laneOf({ op: "pi_setup.check_update" }), "setup");
  assert.equal(laneOf({ op: "pi_setup.install" }), "core");
});

test("a stuck plugin call blocks neither Core nor other plugins", async () => {
  const slow = deferred();
  const started: string[] = [];
  const queue = createHostQueue((request) => {
    started.push(`${request.op}:${request.id ?? ""}`);
    return request.id === "slow" ? slow.promise : Promise.resolve(request.op);
  });
  const stuck = queue.enqueue({ op: "plugin", id: "slow" });
  assert.equal(await queue.enqueue({ op: "boot" }), "boot");
  assert.equal(await queue.enqueue({ op: "plugin", id: "other" }), "plugin");
  assert.deepEqual(started, ["plugin:slow", "boot:", "plugin:other"]);
  slow.resolve("done");
  assert.equal(await stuck, "done");
});

test("requests within one lane stay serial, even after a failure", async () => {
  const first = deferred();
  const started: number[] = [];
  const queue = createHostQueue((request) => {
    started.push(request.n as number);
    return request.n === 1 ? first.promise : Promise.resolve(request.n);
  });
  const one = queue.enqueue({ op: "plugin", id: "a", n: 1 });
  const two = queue.enqueue({ op: "plugin", id: "a", n: 2 });
  await tick();
  assert.deepEqual(started, [1]);
  first.reject(new Error("boom"));
  await assert.rejects(one, /boom/);
  assert.equal(await two, 2);
  assert.deepEqual(started, [1, 2]);
});

test("the guard runs at admission and can cancel a queued request", async () => {
  const first = deferred();
  let live = true;
  let runs = 0;
  const queue = createHostQueue((request) => {
    runs++;
    return request.n === 1 ? first.promise : Promise.resolve(null);
  });
  const one = queue.enqueue({ op: "plugin", id: "a", n: 1 });
  const two = queue.enqueue({ op: "plugin", id: "a", n: 2 }, () => {
    if (!live) throw new Error("Plugin was unloaded");
  });
  live = false;
  first.resolve(null);
  await one;
  await assert.rejects(two, /unloaded/);
  assert.equal(runs, 1);
});

test("finished lanes are released", async () => {
  const queue = createHostQueue(() => Promise.resolve(null));
  await Promise.all([
    queue.enqueue({ op: "boot" }),
    queue.enqueue({ op: "plugin", id: "a" }),
    queue.enqueue({ op: "plugin", id: "b" }),
  ]);
  await tick();
  assert.deepEqual(queue.lanes(), []);
});
