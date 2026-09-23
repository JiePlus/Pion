import assert from "node:assert/strict";
import test from "node:test";
import { addAttachments, attachmentDraft, setAttachmentDraft } from "../src/core/attachments.ts";
import type { ImageAttachment } from "../src/core/attachments.ts";
import { applyAssistantDelta } from "../src/core/chat-stream.ts";
import {
  emptyExtensionDialogs,
  extensionDialogReducer,
  isExtensionDialog,
} from "../src/core/extension-ui.ts";
import { translate } from "../src/core/i18n.ts";
import { queueFromEvent } from "../src/core/pi-events.ts";
import { flatHistoryItems, sessionTreeItems } from "../src/core/session-tree.ts";

test("extension dialogs queue, correlate ids and clear on generation changes", () => {
  const first = { id: "a", method: "confirm" as const, title: "A", message: "Continue?" };
  const second = { id: "b", method: "input" as const, title: "B" };
  let state = extensionDialogReducer(emptyExtensionDialogs, { type: "enqueue", request: first });
  state = extensionDialogReducer(state, { type: "enqueue", request: second });
  assert.equal(state.active?.id, "a");
  assert.deepEqual(
    state.queued.map((item) => item.id),
    ["b"],
  );
  assert.equal(extensionDialogReducer(state, { type: "finish", id: "wrong" }).active?.id, "a");
  state = extensionDialogReducer(state, { type: "finish", id: "a" });
  assert.equal(state.active?.id, "b");
  assert.deepEqual(extensionDialogReducer(state, { type: "clear" }), emptyExtensionDialogs);
  assert.equal(isExtensionDialog(first), true);
  assert.equal(isExtensionDialog({ id: "bad", method: "select", title: "Bad" }), false);
  assert.equal(
    isExtensionDialog({ id: "bad", method: "confirm", title: "Bad", message: 1 }),
    false,
  );
});

test("queue_update maps steering and follow-up without trusting malformed fields", () => {
  assert.deepEqual(queueFromEvent({ steering: ["one"], followUp: ["two"] }), {
    steering: ["one"],
    followUp: ["two"],
  });
  assert.deepEqual(queueFromEvent({ steering: "bad", followUp: null }), {
    steering: [],
    followUp: [],
  });
});

test("attachment state enforces count and total limits without clearing a failed draft", () => {
  const image = (id: string, size = 1): ImageAttachment => ({
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    size,
    data: "iVBORw0KGgo=",
  });
  const draft = [image("one")];
  assert.equal(addAttachments(draft, [image("two")]).length, 2);
  assert.throws(() => addAttachments(draft, [image("huge", 10 * 1024 * 1024 + 1)]));
  assert.throws(() =>
    addAttachments(
      [],
      Array.from({ length: 6 }, (_, index) => image(String(index))),
    ),
  );
  assert.equal(draft.length, 1);
  setAttachmentDraft("task-a", draft);
  assert.equal(attachmentDraft("task-a").length, 1);
  assert.equal(attachmentDraft("task-b").length, 0);
  setAttachmentDraft("task-a", []);
  assert.equal(attachmentDraft("task-a").length, 0);
});

test("Pi 0.87 deltas assemble by content index", () => {
  let message = applyAssistantDelta(null, { type: "text_start", contentIndex: 0 });
  message = applyAssistantDelta(message, { type: "text_delta", contentIndex: 0, delta: "Hello " });
  message = applyAssistantDelta(message, { type: "thinking_start", contentIndex: 1 });
  message = applyAssistantDelta(message, {
    type: "thinking_delta",
    contentIndex: 1,
    delta: "Check",
  });
  message = applyAssistantDelta(message, { type: "text_delta", contentIndex: 0, delta: "world" });
  assert.deepEqual(message.content, [
    { type: "text", text: "Hello world" },
    { type: "thinking", thinking: "Check" },
  ]);
});

test("session trees map depth, labels and active leaf", () => {
  const items = sessionTreeItems(
    [
      {
        entry: { id: "one", type: "message", message: { role: "user", content: "First" } },
        children: [
          {
            entry: { id: "two", parentId: "one", type: "message" },
            label: "checkpoint",
            children: [],
          },
        ],
      },
    ],
    "two",
  );
  assert.deepEqual(
    items.map(({ depth, label, active }) => ({ depth, label, active })),
    [
      { depth: 0, label: "First", active: false },
      { depth: 1, label: "checkpoint", active: true },
    ],
  );
});

test("flat history remains usable beyond 128 levels", () => {
  const entries = Array.from({ length: 200 }, (_, index) => ({
    id: `entry-${index}`,
    parentId: index ? `entry-${index - 1}` : null,
    type: "message",
    label: `Entry ${index}`,
  }));
  const items = flatHistoryItems(entries, "entry-199");
  assert.equal(items.length, 200);
  assert.equal(items[199].depth, 199);
  assert.equal(items[199].active, true);
});

test("new Pi features have English fallback and Simplified Chinese copy", () => {
  assert.equal(translate("en", "Session history"), "Session history");
  assert.equal(translate("zh-CN", "Session history"), "会话历史");
  assert.equal(translate("zh-CN", "Attach images"), "添加图片");
  assert.equal(translate("zh-CN", "Maximum 5 images"), "最多添加 5 张图片");
  assert.equal(translate("zh-CN", "Extension dialog timed out."), "扩展对话框已超时。");
  assert.equal(translate("en", "Read-only tools"), "Read-only tools");
  assert.equal(translate("zh-CN", "Read-only tools"), "只读工具");
  assert.equal(translate("zh-CN", "Automatic compaction"), "自动压缩");
  assert.equal(translate("en", "Custom compaction"), "Custom compaction");
  assert.equal(translate("zh-CN", "Custom compaction"), "自定义压缩");
  assert.equal(translate("zh-CN", "Import Pi CLI sessions"), "导入 Pi CLI 会话");
  assert.equal(
    translate(
      "zh-CN",
      "Tool presets change tools exposed to the model; Pi extensions remain trusted code.",
    ),
    "工具预设只改变模型可调用的工具；Pi 扩展仍是受信任代码。",
  );
});
