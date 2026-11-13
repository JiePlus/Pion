// Core Git review: types for the host's `git.*` operations and a unified diff
// parser for the review pane. Hunk text is kept byte-for-byte so the host can
// find the same hunk again when it is staged, unstaged or reverted.

export type ReviewScope = "unstaged" | "staged" | "branch" | "turn";
export type CommitFollowUp = "commit" | "push" | "pr";
export type HunkAction = "stage" | "unstage" | "revert";

export interface GitSummary {
  repo: boolean;
  branch?: string;
  detached?: boolean;
  ahead?: number;
  behind?: number;
  additions?: number;
  deletions?: number;
  files?: number;
}

export interface GitReview {
  repo: true;
  scope: ReviewScope;
  branch: string;
  detached: boolean;
  ahead: number;
  behind: number;
  upstream: boolean;
  remote: boolean;
  staged: number;
  unstaged: number;
  base: string | null;
  turnAvailable: boolean;
  diff: string;
  truncated: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream: string;
}

export interface CommitResult {
  ok: true;
  hash: string;
  pushed?: boolean;
  prUrl?: string;
}

export type DiffLineKind = "add" | "del" | "ctx" | "meta";
export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}
export interface DiffHunk {
  header: string;
  /** Exact hunk text including the `@@` line, as sent back to the host. */
  text: string;
  lines: DiffLine[];
}
export type FileChange = "added" | "deleted" | "modified" | "renamed";
export interface DiffFile {
  path: string;
  oldPath?: string;
  change: FileChange;
  binary: boolean;
  untracked: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function unquote(path: string): string {
  // core.quotepath=false leaves UTF-8 alone; only paths with special bytes are quoted.
  if (!path.startsWith('"')) return path;
  try {
    return JSON.parse(path) as string;
  } catch {
    return path.slice(1, -1);
  }
}

function headerPaths(line: string): { a: string; b: string } {
  const rest = line.slice("diff --git ".length);
  const quoted = rest.match(/^"a\/(.*)" "b\/(.*)"$/);
  if (quoted) return { a: unquote(`"${quoted[1]}"`), b: unquote(`"${quoted[2]}"`) };
  // Unquoted: "a/<path> b/<path>" where both sides are usually equal.
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3))
    return { a: rest.slice(2, half), b: rest.slice(half + 3) };
  const split = rest.indexOf(" b/");
  return { a: rest.slice(2, split), b: rest.slice(split + 3) };
}

/**
 * Parses `git diff` output (one or more files) into files and hunks. In the
 * unstaged scope a "new file" can only be an untracked file the host appended.
 */
export function parseDiff(text: string, scope?: ReviewScope): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  const lines = text.split(/(?<=\n)/);
  for (const raw of lines) {
    const line = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    if (line.startsWith("diff --git ")) {
      const { a, b } = headerPaths(line);
      file = {
        path: b,
        change: "modified",
        binary: false,
        untracked: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      if (a !== b) {
        file.oldPath = a;
        file.change = "renamed";
      }
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) file.change = "added";
      else if (line.startsWith("deleted file mode")) file.change = "deleted";
      else if (line.startsWith("rename from ")) {
        file.oldPath = unquote(line.slice("rename from ".length));
        file.change = "renamed";
      } else if (line.startsWith("rename to "))
        file.path = unquote(line.slice("rename to ".length));
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
    }
    const match = line.match(HUNK);
    if (match) {
      oldNo = Number(match[1]);
      newNo = Number(match[2]);
      hunk = { header: line, text: raw, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    hunk.text += raw;
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
      file.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
      file.deletions++;
    } else if (line.startsWith("\\")) {
      hunk.lines.push({ kind: "meta", text: line });
    } else if (raw.length) {
      hunk.lines.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  if (scope === "unstaged") for (const entry of files) entry.untracked = entry.change === "added";
  return files;
}

export function splitPath(path: string): { name: string; dir: string } {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { name: path, dir: "" }
    : { name: path.slice(index + 1), dir: path.slice(0, index) };
}

export function totals(files: DiffFile[]): { additions: number; deletions: number } {
  return files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}
