import type { LocalizedText } from "./api.ts";

// Features that ship inside Pion (Core UI + host operations, not sandboxed
// plugins). They are listed in Settings → Plugins and can be switched off;
// the host keeps the state in builtins.json and refuses their operations when off.
export interface BuiltinFeature {
  id: string;
  name: string;
  nameI18n: LocalizedText;
  description: string;
  descriptionI18n: LocalizedText;
}

export const builtinFeatures: BuiltinFeature[] = [
  {
    id: "git-review",
    name: "Git review",
    nameI18n: { "zh-CN": "Git 审阅" },
    description:
      "Review, stage and revert changes beside the task, then commit, push or open a pull request.",
    descriptionI18n: {
      "zh-CN": "在任务旁审阅、暂存和还原改动，并提交、推送或创建拉取请求。",
    },
  },
];

export type BuiltinStates = Record<string, boolean>;

export function builtinEnabled(states: BuiltinStates | undefined, id: string): boolean {
  return states?.[id] ?? true;
}
