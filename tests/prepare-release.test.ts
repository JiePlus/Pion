import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  main,
  nextVersion,
  prepareRelease,
  updateVersionFiles,
  versionFiles,
} from "../scripts/prepare-release.mjs";

const exec = promisify(execFile);
const fixture = {
  "package.json": '{"name":"pion","version":"0.1.1","dependencies":{"dep":"0.1.1"}}\n',
  "package-lock.json":
    '{"name":"pion","version":"0.1.1","lockfileVersion":3,"packages":{"":{"name":"pion","version":"0.1.1","dependencies":{"dep":"0.1.1"}},"node_modules/dep":{"version":"0.1.1","integrity":"unchanged"}}}\n',
  "src-tauri/tauri.conf.json": '{"version":"0.1.1","bundle":{"active":true}}\n',
  "src-tauri/Cargo.toml":
    '[package]\nname = "pion"\nversion = "0.1.1"\nedition = "2021"\n\n[dependencies]\ndep = "0.1.1"\n',
  "src-tauri/Cargo.lock":
    '# generated\nversion = 4\n\n[[package]]\nname = "dep"\nversion = "0.1.1"\nsource = "registry+unchanged"\n\n[[package]]\nname = "pion"\nversion = "0.1.1"\ndependencies = [\n "dep",\n]\n\n[[package]]\nname = "tail"\nversion = "9.0.0"\n',
};

async function repository(t: { after: (callback: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pion-reservation-"));
  assert.ok(path.isAbsolute(root) && path.basename(root).startsWith("pion-reservation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  const cwd = path.join(root, "work");
  const git = async (...args: string[]) => (await exec("git", args, { cwd })).stdout.trim();
  await exec("git", ["init", "--bare", "--initial-branch=main", remote]);
  await exec("git", ["clone", remote, cwd]);
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "fixture@example.test");
  await mkdir(path.join(cwd, "src-tauri"));
  for (const [file, content] of Object.entries(fixture))
    await writeFile(path.join(cwd, file), content);
  await git("add", ".");
  await git("commit", "-m", "initial source");
  await git("tag", "v0.1.1");
  await git("push", "origin", "main", "--tags");
  const source = await git("rev-parse", "HEAD");
  const contents = async () =>
    Object.fromEntries(
      await Promise.all(
        versionFiles.map(async (file: string) => [
          file,
          await readFile(path.join(cwd, file), "utf8"),
        ]),
      ),
    );
  const writer = async () => {
    const other = path.join(root, `writer-${Math.random()}`);
    await exec("git", ["clone", remote, other]);
    const run = async (...args: string[]) =>
      (await exec("git", args, { cwd: other })).stdout.trim();
    await run("config", "user.name", "Other writer");
    await run("config", "user.email", "writer@example.test");
    return { cwd: other, git: run };
  };
  return { cwd, remote, git, source, contents, writer };
}

function verifyVersions(contents: Record<string, string>, version: string) {
  assert.equal(JSON.parse(contents["package.json"]).version, version);
  const lock = JSON.parse(contents["package-lock.json"]);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[""].version, version);
  assert.equal(JSON.parse(contents["src-tauri/tauri.conf.json"]).version, version);
  assert.match(
    contents["src-tauri/Cargo.toml"],
    new RegExp(`name = "pion"\\nversion = "${version.replaceAll(".", "\\.")}"`),
  );
  assert.match(
    contents["src-tauri/Cargo.lock"],
    new RegExp(`name = "pion"\\nversion = "${version.replaceAll(".", "\\.")}"`),
  );
  assert.equal(JSON.parse(contents["package.json"]).dependencies.dep, "0.1.1");
  assert.deepEqual(
    lock.packages["node_modules/dep"],
    JSON.parse(fixture["package-lock.json"]).packages["node_modules/dep"],
  );
  assert.match(contents["src-tauri/Cargo.toml"], /\[dependencies\]\ndep = "0.1.1"/);
  assert.match(
    contents["src-tauri/Cargo.lock"],
    /name = "dep"\nversion = "0.1.1"\nsource = "registry\+unchanged"/,
  );
  assert.match(contents["src-tauri/Cargo.lock"], /name = "tail"\nversion = "9.0.0"/);
}

test("stable version selection uses the highest app/tag version with numeric comparison", () => {
  assert.equal(
    nextVersion("0.1.1", ["v0.1.1", "v0.1.9", "v0.1.10", "v9.0.0-beta.1", "v01.0.0", "other"]),
    "0.1.11",
  );
  assert.equal(nextVersion("2.1.9", ["v1.99.99"]), "2.1.10");
  assert.equal(nextVersion("0.1.1", ["v0.1.1"]), "0.1.2");
  assert.equal(nextVersion("1.0.9007199254740992", []), "1.0.9007199254740993");
  assert.throws(() => nextVersion("1.0.0-beta.1", []), /stable semver/);
});

test("five valid text files receive six declarations without changing dependencies", () => {
  const updated = updateVersionFiles(fixture, "0.1.2");
  verifyVersions(updated, "0.1.2");
  // Every file retains its original formatting and bytes outside the app versions.
  for (const file of versionFiles)
    assert.equal(updated[file].replaceAll("0.1.2", "0.1.1"), fixture[file]);
  // TOML edits preserve every byte outside the named app version declaration.
  for (const file of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"])
    assert.equal(
      updated[file].replace('name = "pion"\nversion = "0.1.2"', 'name = "pion"\nversion = "0.1.1"'),
      fixture[file],
    );
  assert.throws(
    () =>
      updateVersionFiles(
        { ...fixture, "src-tauri/Cargo.toml": '[package]\nname = "other"\nversion = "0.1.1"' },
        "0.1.2",
      ),
    /one pion/,
  );
});

test("reserves an atomic annotated tag and consistent commit with source/run metadata", async (t) => {
  const repo = await repository(t);
  const result = await prepareRelease({ cwd: repo.cwd, runId: "100" });
  assert.deepEqual(result, {
    version: "0.1.2",
    tag: "v0.1.2",
    sha: await repo.git("rev-parse", "HEAD"),
    source: repo.source,
  });
  verifyVersions(await repo.contents(), "0.1.2");
  assert.equal(await repo.git("status", "--porcelain"), "");
  const remoteMain = (await repo.git("ls-remote", "origin", "refs/heads/main")).split("\t")[0];
  assert.equal(remoteMain, result.sha);
  const tag = await repo.git("cat-file", "-p", "refs/pion-release/tags/v0.1.1");
  assert.ok(tag.startsWith("tree ")); // Original occupied lightweight tag is still the original source commit.
  await repo.git("fetch", "--tags", "origin");
  assert.equal(await repo.git("cat-file", "-t", result.tag), "tag");
  assert.equal(await repo.git("rev-parse", `${result.tag}^{commit}`), result.sha);
  assert.match(
    await repo.git("show", "-s", "--format=%B", result.sha),
    /Pion-Release: .*"runId":"100"/,
  );
  assert.doesNotMatch(await repo.git("show", "-s", "--format=%B", result.sha), /skip ci/);
  assert.equal(
    await repo.git("diff", "--name-only", repo.source, result.sha),
    [...versionFiles].sort().join("\n"),
  );
});

test("failed publication rerun recovers its exact reservation even after newer source", async (t) => {
  const repo = await repository(t);
  const first = await prepareRelease({ cwd: repo.cwd, runId: "101" });
  const writer = await repo.writer();
  await writeFile(path.join(writer.cwd, "feature.txt"), "new source\n");
  await writer.git("add", ".");
  await writer.git("commit", "-m", "real feature");
  await writer.git("push", "origin", "main");
  const second = await prepareRelease({ cwd: writer.cwd, runId: "102" });
  assert.equal(second.version, "0.1.3");
  assert.deepEqual(await prepareRelease({ cwd: repo.cwd, runId: "101" }), first);
  assert.equal(
    (await repo.git("ls-remote", "origin", "refs/heads/main")).split("\t")[0],
    second.sha,
  );
});

test("shallow CI checkout restores older run metadata across its history boundary", async (t) => {
  const repo = await repository(t);
  const first = await prepareRelease({ cwd: repo.cwd, runId: "105" });
  await repo.git("checkout", "-B", "main", first.sha);
  await writeFile(path.join(repo.cwd, "later.txt"), "later source\n");
  await repo.git("add", ".");
  await repo.git("commit", "-m", "later source");
  await repo.git("push", "origin", "main");
  const shallow = path.join(path.dirname(repo.cwd), "shallow");
  await exec("git", ["clone", "--depth=1", "--no-tags", `file://${repo.remote}`, shallow]);
  assert.deepEqual(await prepareRelease({ cwd: shallow, runId: "105" }), first);
});

test("fresh run without new source reuses tip; genuine source gets a new patch", async (t) => {
  const repo = await repository(t);
  const first = await prepareRelease({ cwd: repo.cwd, runId: "110" });
  assert.deepEqual(await prepareRelease({ cwd: repo.cwd, runId: "111" }), first);
  await repo.git("checkout", "-B", "main", first.sha);
  await writeFile(path.join(repo.cwd, "feature.txt"), "feature\n");
  await repo.git("add", ".");
  await repo.git("commit", "-m", "new source");
  await repo.git("push", "origin", "main");
  const source = await repo.git("rev-parse", "HEAD");
  const second = await prepareRelease({ cwd: repo.cwd, runId: "112" });
  assert.equal(second.version, "0.1.3");
  assert.equal(second.source, source);
  assert.equal(await readFile(path.join(repo.cwd, "feature.txt"), "utf8"), "feature\n");
  // Run 111 reused another run's reservation. Its rerun must not drift to 112.
  assert.deepEqual(await prepareRelease({ cwd: repo.cwd, runId: "111" }), first);
  assert.equal(
    (await repo.git("ls-remote", "origin", "refs/tags/pion-release-run-111")).split("\t")[0],
    first.sha,
  );
});

test("highest occupied stable tag is never reused or overwritten", async (t) => {
  const repo = await repository(t);
  await repo.git("tag", "-a", "v1.4.9", "-m", "existing release");
  await repo.git("tag", "v99.0.0-beta.1");
  await repo.git("push", "origin", "--tags");
  const existing = await repo.git("rev-parse", "v1.4.9");
  assert.equal((await prepareRelease({ cwd: repo.cwd, runId: "120" })).version, "1.4.10");
  assert.equal(
    (await repo.git("ls-remote", "origin", "refs/tags/v1.4.9")).split("\t")[0],
    existing,
  );
});

test("concurrent main writer triggers recomputation and preserves the new source", async (t) => {
  const repo = await repository(t);
  const writer = await repo.writer();
  let attempts = 0;
  const result = await prepareRelease({
    cwd: repo.cwd,
    runId: "130",
    beforePush: async ({ attempt }: { attempt: number }) => {
      attempts++;
      if (attempt !== 0) return;
      await writeFile(path.join(writer.cwd, "concurrent.txt"), "do not lose\n");
      await writer.git("add", ".");
      await writer.git("commit", "-m", "concurrent change");
      await writer.git("push", "origin", "main");
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result.version, "0.1.2");
  assert.equal(result.source, await writer.git("rev-parse", "HEAD"));
  assert.equal(await readFile(path.join(repo.cwd, "concurrent.txt"), "utf8"), "do not lose\n");
});

test("concurrent reservation converges to the winning tag without another bump", async (t) => {
  const repo = await repository(t);
  const writer = await repo.writer();
  let winner;
  const result = await prepareRelease({
    cwd: repo.cwd,
    runId: "140",
    maxAttempts: 1,
    beforePush: async ({ attempt }: { attempt: number }) => {
      if (attempt === 0) winner = await prepareRelease({ cwd: writer.cwd, runId: "141" });
    },
  });
  assert.deepEqual(result, winner);
  assert.deepEqual(await prepareRelease({ cwd: repo.cwd, runId: "140" }), winner);
});

test("a tag occupied during push is preserved and a higher version is recomputed", async (t) => {
  const repo = await repository(t);
  const writer = await repo.writer();
  const result = await prepareRelease({
    cwd: repo.cwd,
    runId: "150",
    beforePush: async ({ attempt, tag }: { attempt: number; tag: string }) => {
      if (attempt !== 0) return;
      await writer.git("tag", tag);
      await writer.git("push", "origin", `refs/tags/${tag}`);
    },
  });
  assert.equal(result.version, "0.1.3");
  assert.equal(
    (await repo.git("ls-remote", "origin", "refs/tags/v0.1.2")).split("\t")[0],
    repo.source,
  );
  assert.equal(result.source, repo.source);
});

test("rejected atomic pushes leave both remote main and tags intact and retry finitely", async (t) => {
  const repo = await repository(t);
  const hook = path.join(repo.remote, "hooks", "pre-receive");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  let attempts = 0;
  await assert.rejects(
    prepareRelease({
      cwd: repo.cwd,
      runId: "155",
      maxAttempts: 2,
      beforePush: () => {
        attempts++;
      },
    }),
    /after 2 attempts/,
  );
  assert.equal(attempts, 2);
  assert.equal(
    (await repo.git("ls-remote", "origin", "refs/heads/main")).split("\t")[0],
    repo.source,
  );
  assert.equal(await repo.git("ls-remote", "origin", "refs/tags/v0.1.2"), "");
});

test("CLI emits the four publication outputs and stdout JSON in CI main context", async (t) => {
  const repo = await repository(t);
  const output = path.join(path.dirname(repo.cwd), "github-output");
  const script = path.resolve("scripts/prepare-release.mjs");
  const { stdout } = await exec(process.execPath, [script], {
    cwd: repo.cwd,
    env: {
      ...process.env,
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/main",
      GITHUB_RUN_ID: "156",
      GITHUB_OUTPUT: output,
    },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.version, "0.1.2");
  assert.equal(result.source, repo.source);
  assert.deepEqual(Object.keys(result).sort(), ["sha", "source", "tag", "version"]);
  assert.equal(
    await readFile(output, "utf8"),
    Object.entries(result)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
});

test("CLI rejects non-main/non-CI and invalid run IDs; dirty trees fail clearly", async (t) => {
  await assert.rejects(main({}), /only in GitHub Actions/);
  await assert.rejects(
    main({ CI: "true", GITHUB_ACTIONS: "true", GITHUB_REF: "refs/tags/v1.0.0" }),
    /only in GitHub Actions/,
  );
  const repo = await repository(t);
  await assert.rejects(prepareRelease({ cwd: repo.cwd, runId: "run;bad" }), /numeric stable/);
  await writeFile(path.join(repo.cwd, "dirty.txt"), "uncommitted");
  await assert.rejects(prepareRelease({ cwd: repo.cwd, runId: "160" }), /clean working tree/);
});
