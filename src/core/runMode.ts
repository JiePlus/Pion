// What a message sent while Pi is working does by default: steer the current turn or queue after it.
export type RunMode = "steer" | "follow_up";

const key = "pion.runMessageMode";

export function readRunMode(): RunMode {
  try {
    return localStorage.getItem(key) === "follow_up" ? "follow_up" : "steer";
  } catch {
    return "steer";
  }
}

export function saveRunMode(mode: RunMode) {
  localStorage.setItem(key, mode);
}
