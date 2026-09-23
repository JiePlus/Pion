export type ExtensionDialog =
  | { id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { id: string; method: "editor"; title: string; prefill?: string; timeout?: number };

const ansiEscape =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function plainExtensionText(value: string): string {
  return value.replace(ansiEscape, "");
}

export interface ExtensionDialogState {
  active: ExtensionDialog | null;
  queued: ExtensionDialog[];
  responding: boolean;
}

export type ExtensionDialogAction =
  | { type: "enqueue"; request: ExtensionDialog }
  | { type: "responding" }
  | { type: "finish"; id: string }
  | { type: "clear" };

export const emptyExtensionDialogs: ExtensionDialogState = {
  active: null,
  queued: [],
  responding: false,
};

export function extensionDialogReducer(
  state: ExtensionDialogState,
  action: ExtensionDialogAction,
): ExtensionDialogState {
  if (action.type === "clear") return emptyExtensionDialogs;
  if (action.type === "responding") return { ...state, responding: true };
  if (action.type === "enqueue") {
    if (
      state.active?.id === action.request.id ||
      state.queued.some((item) => item.id === action.request.id)
    )
      return state;
    if (!state.active) return { active: action.request, queued: [], responding: false };
    return { ...state, queued: [...state.queued, action.request] };
  }
  if (state.active?.id !== action.id) {
    return { ...state, queued: state.queued.filter((item) => item.id !== action.id) };
  }
  const [active = null, ...queued] = state.queued;
  return { active, queued, responding: false };
}

export function isExtensionDialog(value: unknown): value is ExtensionDialog {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  if (
    typeof request.id !== "string" ||
    typeof request.title !== "string" ||
    !["select", "confirm", "input", "editor"].includes(String(request.method)) ||
    (request.timeout !== undefined &&
      (typeof request.timeout !== "number" ||
        !Number.isFinite(request.timeout) ||
        request.timeout < 0))
  )
    return false;
  if (request.method === "select")
    return (
      Array.isArray(request.options) &&
      request.options.every((option) => typeof option === "string")
    );
  if (request.method === "confirm") return typeof request.message === "string";
  if (request.method === "input")
    return request.placeholder === undefined || typeof request.placeholder === "string";
  return request.prefill === undefined || typeof request.prefill === "string";
}
