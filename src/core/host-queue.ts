// Host requests run in lanes. Core requests share one serial lane so app
// operations keep their order; each plugin gets its own lane, so a slow plugin
// call (a network fetch, a large diff) cannot hold up Core or other plugins.
// Development reload checks get a lane per plugin too, so polling never queues
// behind Core work.
export function laneOf(request: Record<string, unknown>): string {
  if (request.op === "plugin") return `plugin:${String(request.id)}`;
  if (request.op === "dev.poll") return `dev:${String(request.id)}`;
  return "core";
}

export function createHostQueue(run: (request: Record<string, unknown>) => Promise<unknown>) {
  const tails = new Map<string, Promise<unknown>>();
  function enqueue<T>(request: Record<string, unknown>, guard: () => void = () => {}): Promise<T> {
    const lane = laneOf(request);
    // The guard runs when the request reaches the front of its lane, not when it is queued.
    const result = (tails.get(lane) ?? Promise.resolve()).then(() => {
      guard();
      return run(request) as Promise<T>;
    });
    const tail = result.then(
      () => {},
      () => {},
    );
    tails.set(lane, tail);
    void tail.then(() => {
      if (tails.get(lane) === tail) tails.delete(lane);
    });
    return result;
  }
  return { enqueue, lanes: () => [...tails.keys()] };
}
