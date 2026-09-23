export interface MessageQueue {
  steering: string[];
  followUp: string[];
}

export function queueFromEvent(event: Record<string, unknown>): MessageQueue {
  return {
    steering: Array.isArray(event.steering) ? event.steering.map(String) : [],
    followUp: Array.isArray(event.followUp) ? event.followUp.map(String) : [],
  };
}
