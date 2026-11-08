import { execFile } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const marker = "Pion-Release: ";
const tagNamespace = "refs/pion-release/tags/";
export const versionFiles = [
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

function parts(version) {
  if (!stable.test(version)) throw new Error(`Expected stable semver, got ${version}`);
  return version.split(".").map(BigInt);
}

export function nextVersion(current, tags) {
  let highest = parts(current);
  for (const tag of tags) {
    if (!tag.startsWith("v") || !stable.test(tag.slice(1))) continue;
    const candidate = parts(tag.slice(1));
    const difference = candidate.findIndex((value, index) => value !== highest[index]);
    if (difference !== -1 && candidate[difference] > highest[difference]) highest = candidate;
  }
  return `${highest[0]}.${highest[1]}.${highest[2] + 1n}`;
}

// Only the app's named TOML section may change; dependency versions stay byte-for-byte intact.
function tomlVersion(text, file, version) {
  const header = file.endsWith("Cargo.lock") ? /^\[\[package\]\]\s*$/gm : /^\[package\]\s*$/gm;
  const sections = [...text.matchAll(header)].map((match) => {
    const start = match.index + match[0].length;
    const next = text.slice(start).search(/^\[/m);
    return { start, end: next === -1 ? text.length : start + next };
  });
  const matches = sections.filter(({ start, end }) =>
    /^name\s*=\s*"pion"\s*$/m.test(text.slice(start, end)),
  );
  if (matches.length !== 1) throw new Error(`${file}: expected one pion package section`);
  const { start, end } = matches[0];
  const section = text.slice(start, end);
  const declarations = [...section.matchAll(/^(version\s*=\s*")([^"]+)("[^\n]*)$/gm)];
  if (declarations.length !== 1) throw new Error(`${file}: expected one app version`);
  const current = declarations[0][2];
  parts(current);
  if (version === undefined) return current;
  return (
    text.slice(0, start) +
    section.replace(/^(version\s*=\s*")([^"]+)("[^\n]*)$/m, `$1${version}$3`) +
    text.slice(end)
  );
}

export function updateVersionFiles(contents, version) {
  parts(version);
  /** @type {Record<string, string>} */
  const result = {};
  for (const file of versionFiles) {
    if (file.endsWith(".json")) {
      const data = JSON.parse(contents[file]);
      parts(data.version);
      // Preserve project formatting and all dependency/configuration bytes.
      // These manifests place the application version before nested objects.
      const rootVersion = /("version"\s*:\s*")([^"\n]+)(")/;
      const rootMatch = contents[file].match(rootVersion);
      if (!rootMatch || rootMatch[2] !== data.version)
        throw new Error(`${file}: cannot locate root application version`);
      let updated = contents[file].replace(
        rootVersion,
        (_, prefix, _old, suffix) => `${prefix}${version}${suffix}`,
      );
      if (file === "package-lock.json") {
        if (!data.packages?.[""]) throw new Error(`${file}: missing root package`);
        parts(data.packages[""].version);
        const packageVersion =
          /("packages"\s*:\s*\{\s*""\s*:\s*\{[^}]*?"version"\s*:\s*")([^"\n]+)(")/;
        const packageMatch = updated.match(packageVersion);
        if (!packageMatch || packageMatch[2] !== data.packages[""].version)
          throw new Error(`${file}: cannot locate root package version`);
        updated = updated.replace(
          packageVersion,
          (_, prefix, _old, suffix) => `${prefix}${version}${suffix}`,
        );
      }
      result[file] = updated;
    } else result[file] = tomlVersion(contents[file], file, version);
  }
  if (appVersions(result) !== version)
    throw new Error("Unable to update all root application versions");
  return result;
}

function appVersions(contents) {
  const packageJson = JSON.parse(contents["package.json"]);
  const lock = JSON.parse(contents["package-lock.json"]);
  const versions = [
    packageJson.version,
    lock.version,
    lock.packages?.[""]?.version,
    JSON.parse(contents["src-tauri/tauri.conf.json"]).version,
    tomlVersion(contents["src-tauri/Cargo.toml"], "Cargo.toml"),
    tomlVersion(contents["src-tauri/Cargo.lock"], "Cargo.lock"),
  ];
  versions.forEach(parts);
  if (new Set(versions).size !== 1) throw new Error("App version declarations disagree");
  return versions[0];
}

function metadata(message) {
  const lines = message.split("\n").filter((line) => line.startsWith(marker));
  if (lines.length !== 1) return null;
  try {
    const value = JSON.parse(lines[0].slice(marker.length));
    return value.schema === 1 &&
      stable.test(value.version) &&
      /^[0-9]+$/.test(value.runId) &&
      /^[a-f0-9]{40,64}$/.test(value.source)
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Reserve using git only. beforePush is a test seam for a concurrent writer.
 * @param {{
 *   cwd?: string,
 *   runId?: string,
 *   remote?: string,
 *   branch?: string,
 *   maxAttempts?: number,
 *   beforePush?: (reservation: {
 *     attempt: number, version: string, tag: string, sha: string, source: string
 *   }) => void | Promise<void>
 * }} [options]
 */
export async function prepareRelease({
  cwd = process.cwd(),
  runId,
  remote = "origin",
  branch = "main",
  maxAttempts = 4,
  beforePush,
} = {}) {
  if (typeof runId !== "string" || !/^[0-9]+$/.test(runId))
    throw new Error("A numeric stable GITHUB_RUN_ID is required");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(remote) || branch !== "main")
    throw new Error("Reservation requires a named remote and main branch");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10)
    throw new Error("maxAttempts must be between 1 and 10");
  const git = async (...args) =>
    (await exec("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
  if (await git("status", "--porcelain"))
    throw new Error("Release preparation requires a clean working tree");
  const readContents = async (sha) =>
    Object.fromEntries(
      await Promise.all(
        versionFiles.map(async (file) => [
          file,
          sha ? await git("show", `${sha}:${file}`) : await readFile(path.join(cwd, file), "utf8"),
        ]),
      ),
    );
  const depth =
    (await git("rev-parse", "--is-shallow-repository")) === "true" ? ["--unshallow"] : [];
  let lastError;
  // One final fetch reconciles a successful push whose acknowledgement was lost.
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await git(
      "fetch",
      "--no-tags",
      ...(attempt === 0 ? depth : []),
      remote,
      `refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
      `refs/tags/*:${tagNamespace}*`,
    );
    const tip = await git("rev-parse", `refs/remotes/${remote}/${branch}`);
    const refs = (await git("for-each-ref", "--format=%(refname)", tagNamespace))
      .split("\n")
      .filter(Boolean);
    const tags = refs.map((ref) => ref.slice(tagNamespace.length));
    const reservations = [];
    for (const ref of refs) {
      const tag = ref.slice(tagNamespace.length);
      if (
        !/^v/.test(tag) ||
        !stable.test(tag.slice(1)) ||
        (await git("cat-file", "-t", ref)) !== "tag"
      )
        continue;
      const annotation = await git("cat-file", "-p", ref);
      const data = metadata(annotation.slice(annotation.indexOf("\n\n") + 2));
      if (!data || tag !== `v${data.version}`) continue;
      const sha = await git("rev-parse", `${ref}^{commit}`);
      const commitData = metadata(await git("show", "-s", "--format=%B", sha));
      if (
        !commitData ||
        JSON.stringify(commitData) !== JSON.stringify(data) ||
        (await git("show", "-s", "--format=%P", sha)) !== data.source
      )
        continue;
      if (appVersions(await readContents(sha)) !== data.version) continue;
      try {
        await git("merge-base", "--is-ancestor", sha, tip);
      } catch {
        continue;
      }
      reservations.push({
        version: data.version,
        tag,
        sha,
        source: data.source,
        runId: data.runId,
      });
    }
    const own = reservations.filter((reservation) => reservation.runId === runId);
    if (own.length > 1) throw new Error(`Multiple reservations found for run ${runId}`);
    // A second run may share a reservation at main's tip. Persist that alias
    // before returning, so rerunning it after later merges still uses its original SHA.
    const aliasTag = `pion-release-run-${runId}`;
    const aliasRef = `${tagNamespace}${aliasTag}`;
    const aliasSha = refs.includes(aliasRef)
      ? await git("rev-parse", `${aliasRef}^{commit}`)
      : null;
    const alias = aliasSha
      ? reservations.find((reservation) => reservation.sha === aliasSha)
      : null;
    if (aliasSha && !alias) throw new Error(`Invalid release alias for run ${runId}`);
    const reusable = own[0] ?? alias ?? reservations.find((reservation) => reservation.sha === tip);
    if (reusable) {
      if (!own[0] && !alias) {
        try {
          await git("push", remote, `${reusable.sha}:refs/tags/${aliasTag}`);
        } catch (error) {
          lastError = error;
          continue;
        }
      }
      await git("checkout", "--detach", reusable.sha);
      const { version, tag, sha, source } = reusable;
      return { version, tag, sha, source };
    }
    if (attempt === maxAttempts) break;
    await git("checkout", "--detach", tip);
    const contents = await readContents();
    const version = nextVersion(appVersions(contents), tags);
    const tag = `v${version}`;
    const updated = updateVersionFiles(contents, version);
    await Promise.all(versionFiles.map((file) => writeFile(path.join(cwd, file), updated[file])));
    await git("add", "--", ...versionFiles);
    const data = { schema: 1, version, source: tip, runId };
    const message = `chore: reserve ${tag}\n\n${marker}${JSON.stringify(data)}`;
    await git(
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      message,
    );
    const sha = await git("rev-parse", "HEAD");
    // mktag avoids creating a local tag that could survive a failed atomic push.
    const identity = await git(
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "var",
      "GIT_COMMITTER_IDENT",
    );
    const { stdout } = await new Promise((resolve, reject) => {
      const child = execFile("git", ["mktag"], { cwd }, (error, stdout, stderr) =>
        error ? reject(new Error(stderr || error.message)) : resolve({ stdout }),
      );
      child.stdin.end(`object ${sha}\ntype commit\ntag ${tag}\ntagger ${identity}\n\n${message}\n`);
    });
    await beforePush?.({ attempt, version, tag, sha, source: tip });
    try {
      await git(
        "push",
        "--atomic",
        remote,
        `${sha}:refs/heads/${branch}`,
        `${stdout.trim()}:refs/tags/${tag}`,
      );
      return { version, tag, sha, source: tip };
    } catch (error) {
      // Even an ambiguous network failure may have succeeded: refetch and recover by run ID.
      lastError = error;
    }
  }
  throw new Error(
    `Unable to reserve a release after ${maxAttempts} attempts: ${lastError?.message}`,
  );
}

export async function main(env = process.env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/main")
    throw new Error("prepare-release CLI is allowed only in GitHub Actions CI on main");
  const result = await prepareRelease({ runId: env.GITHUB_RUN_ID });
  if (env.GITHUB_OUTPUT)
    await appendFile(
      env.GITHUB_OUTPUT,
      Object.entries(result)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`prepare-release: ${error.message}`);
    process.exitCode = 1;
  });
}
