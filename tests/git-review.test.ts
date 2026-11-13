import assert from "node:assert/strict";
import test from "node:test";
import { parseDiff, splitPath, totals } from "../src/core/git-review.ts";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@ export const a = 1;",
  " one",
  "-two",
  "+TWO",
  " three",
  "@@ -20,2 +20,3 @@",
  " twenty",
  "+twenty-one",
  " twenty-two",
  "\\ No newline at end of file",
  "diff --git a/old name.txt b/new name.txt",
  "similarity index 90%",
  "rename from old name.txt",
  "rename to new name.txt",
  "diff --git a/img.png b/img.png",
  "new file mode 100644",
  "Binary files /dev/null and b/img.png differ",
  "diff --git a/notes.md b/notes.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/notes.md",
  "@@ -0,0 +1 @@",
  "+hello",
  "",
].join("\n");

test("parses files, hunks, line numbers and change kinds", () => {
  const files = parseDiff(diff, "unstaged");
  assert.deepEqual(
    files.map((file) => [file.path, file.change, file.binary, file.untracked]),
    [
      ["src/a.ts", "modified", false, false],
      ["new name.txt", "renamed", false, false],
      ["img.png", "added", true, true],
      ["notes.md", "added", false, true],
    ],
  );
  const [a] = files;
  assert.equal(a.additions, 2);
  assert.equal(a.deletions, 1);
  assert.equal(a.hunks.length, 2);
  assert.deepEqual(a.hunks[0].lines[1], { kind: "del", text: "two", oldNo: 2 });
  assert.deepEqual(a.hunks[0].lines[2], { kind: "add", text: "TWO", newNo: 2 });
  assert.deepEqual(a.hunks[1].lines[1], { kind: "add", text: "twenty-one", newNo: 21 });
  assert.equal(a.hunks[1].lines.at(-1)?.kind, "meta");
  assert.equal(files[1].oldPath, "old name.txt");
  assert.deepEqual(totals(files), { additions: 3, deletions: 1 });
});

test("hunk text round-trips byte for byte so the host can find it again", () => {
  const [a] = parseDiff(diff);
  const header = diff.slice(0, diff.indexOf("@@"));
  const fileText = diff.slice(0, diff.indexOf("diff --git a/old name.txt"));
  assert.equal(header + a.hunks.map((hunk) => hunk.text).join(""), fileText);
  assert.ok(a.hunks[0].text.startsWith("@@ -1,3 +1,3 @@ export const a = 1;\n"));
});

test("new files are only treated as untracked in the unstaged scope", () => {
  assert.equal(parseDiff(diff, "staged")[3].untracked, false);
  assert.equal(parseDiff("").length, 0);
  assert.deepEqual(splitPath("src/core/a.ts"), { name: "a.ts", dir: "src/core" });
  assert.deepEqual(splitPath("a.ts"), { name: "a.ts", dir: "" });
});

test("quoted paths with special characters are decoded", () => {
  const [file] = parseDiff('diff --git "a/tab\\there.txt" "b/tab\\there.txt"\n--- a\n+++ b\n');
  assert.equal(file.path, "tab\there.txt");
});
