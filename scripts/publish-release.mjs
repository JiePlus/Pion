import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const platforms = ["macos", "linux", "windows"];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validateIdentity(version, sha) {
  if (!stableVersion.test(version) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("A stable application version and full release commit SHA are required.");
  }
}

export async function recordBuild({ version, sha, platform, appVersion, output }) {
  validateIdentity(version, sha);
  if (!platforms.includes(platform) || appVersion !== version) {
    throw new Error(
      `Build identity mismatch for ${platform}: expected ${version}, got ${appVersion}`,
    );
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ version, sha, platform }, null, 2)}\n`);
}

async function walk(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

// Build one manifest after all platforms finish. No matrix job writes a Release.
export async function collectRelease({
  artifacts,
  version,
  sha,
  repository,
  pubDate = new Date().toISOString(),
}) {
  validateIdentity(version, sha);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid GitHub repository.");
  const files = await walk(artifacts);
  const assets = [];
  const oneFile = async (name) => {
    const matches = files.filter((file) => basename(file) === name);
    if (matches.length !== 1) throw new Error(`Expected one ${name}, found ${matches.length}`);
    if ((await stat(matches[0])).size === 0) throw new Error(`Empty release asset: ${name}`);
    return matches[0];
  };
  for (const platform of platforms) {
    const path = await oneFile(`release-${platform}.json`);
    const metadata = JSON.parse(await readFile(path, "utf8"));
    if (metadata.version !== version || metadata.sha !== sha || metadata.platform !== platform) {
      throw new Error(`Artifact identity mismatch: ${platform}`);
    }
  }
  const addAsset = async (source, name = source) => {
    const path = await oneFile(source);
    assets.push({ name, path, size: (await stat(path)).size });
    return path;
  };
  await addAsset(`Pion_${version}_universal.dmg`);
  await addAsset(`Pion_${version}_amd64.deb`);
  await addAsset(`Pion_${version}_x64_en-US.msi`);
  const payloads = {
    macos: ["Pion.app.tar.gz", `Pion_${version}_universal.app.tar.gz`],
    linux: [`Pion_${version}_amd64.AppImage`],
    windows: [`Pion_${version}_x64-setup.exe`],
  };
  const entries = {};
  for (const [platform, [source, destination = source]] of Object.entries(payloads)) {
    await addAsset(source, destination);
    const signaturePath = await addAsset(`${source}.sig`, `${destination}.sig`);
    const signature = (await readFile(signaturePath, "utf8")).trim();
    // Tauri's .sig files contain a base64-encoded minisign signature.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
      throw new Error(`Invalid updater signature: ${source}.sig`);
    }
    entries[platform] = {
      signature,
      url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(destination)}`,
    };
  }
  // Include additional generated installer signatures for manual downloads too.
  for (const installer of [`Pion_${version}_amd64.deb`, `Pion_${version}_x64_en-US.msi`]) {
    if (files.some((file) => basename(file) === `${installer}.sig`))
      await addAsset(`${installer}.sig`);
  }
  const manifest = {
    version,
    notes: `Pion ${version}`,
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": entries.macos,
      "darwin-x86_64": entries.macos,
      "linux-x86_64": entries.linux,
      "windows-x86_64": entries.windows,
    },
  };
  return { assets, manifest };
}

export function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    const delta = Number(a.split(".")[index]) - Number(b.split(".")[index]);
    if (delta) return delta;
  }
  return 0;
}

export function githubClient({ repository, token, fetchImpl = fetch }) {
  if (!token) throw new Error("GitHub release token is required.");
  const root = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  async function request(path, options = {}) {
    const response = await fetchImpl(`${root}${path}`, {
      ...options,
      headers: {
        ...headers,
        Accept: "application/vnd.github+json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    if (response.status === 404 && options.allowMissing) return null;
    if (!response.ok)
      throw new Error(`GitHub ${options.method ?? "GET"} ${path} failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  return {
    request,
    async upload(release, asset) {
      const url = new URL(release.upload_url.replace(/\{.*$/, ""));
      url.searchParams.set("name", asset.name);
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(asset.size),
        },
        body: createReadStream(asset.path),
        duplex: "half",
      });
      if (!response.ok) throw new Error(`Uploading ${asset.name} failed (${response.status})`);
      return response.json();
    },
    async download(asset) {
      const response = await fetchImpl(`${root}/releases/assets/${asset.id}`, {
        headers: { ...headers, Accept: "application/octet-stream" },
      });
      if (!response.ok)
        throw new Error(`Reading published asset ${asset.name} failed (${response.status})`);
      return response.text();
    },
  };
}

async function verifyTag(client, tag, sha) {
  const ref = await client.request(`/git/ref/tags/${tag}`);
  let object = ref.object;
  for (let depth = 0; object.type === "tag" && depth < 8; depth += 1) {
    object = (await client.request(`/git/tags/${object.sha}`)).object;
  }
  if (object.type !== "commit" || object.sha !== sha)
    throw new Error(`Release tag ${tag} does not point to ${sha}`);
}

async function releaseAssets(client, release) {
  const result = [];
  for (let page = 1; ; page += 1) {
    const entries = await client.request(
      `/releases/${release.id}/assets?per_page=100&page=${page}`,
    );
    result.push(...entries);
    if (entries.length < 100) return result;
  }
}

async function hasNewerPublished(client, version) {
  for (let page = 1; ; page += 1) {
    const releases = await client.request(`/releases?per_page=100&page=${page}`);
    if (
      releases.some(
        (release) =>
          !release.draft &&
          !release.prerelease &&
          stableVersion.test(release.tag_name.slice(1)) &&
          compareVersions(release.tag_name.slice(1), version) > 0,
      )
    )
      return true;
    if (releases.length < 100) return false;
  }
}

// Published versions are immutable, including when an old Actions run is rerun.
async function verifyPublished(client, existing, expected) {
  const names = new Set(existing.map((asset) => asset.name));
  for (const asset of expected.assets)
    if (!names.has(asset.name))
      throw new Error(`Published release is missing ${asset.name}; refusing to overwrite it.`);
  const manifestAsset = existing.find((asset) => asset.name === "latest.json");
  if (!manifestAsset)
    throw new Error("Published release has no latest.json; refusing to overwrite it.");
  const manifest = JSON.parse(await client.download(manifestAsset));
  if (
    manifest.version !== expected.manifest.version ||
    JSON.stringify(Object.keys(manifest.platforms ?? {}).sort()) !==
      JSON.stringify(Object.keys(expected.manifest.platforms).sort())
  ) {
    throw new Error("Published updater version/platforms do not match this release.");
  }
  for (const [platform, entry] of Object.entries(expected.manifest.platforms)) {
    const actual = manifest.platforms[platform];
    const name = decodeURIComponent(new URL(entry.url).pathname.split("/").at(-1));
    const signature = existing.find((asset) => asset.name === `${name}.sig`);
    if (
      actual.url !== entry.url ||
      !signature ||
      actual.signature !== (await client.download(signature)).trim()
    ) {
      throw new Error(`Published updater mismatch: ${platform}`);
    }
  }
}

export async function publishRelease({ artifacts, output, version, sha, repository, client }) {
  const tag = `v${version}`;
  const collected = await collectRelease({ artifacts, version, sha, repository });
  await verifyTag(client, tag, sha);
  let release = await client.request(`/releases/tags/${tag}`, { allowMissing: true });
  if (release && !release.draft) {
    await verifyPublished(client, await releaseAssets(client, release), collected);
    return { tag, published: true, reused: true };
  }
  if (!release) {
    release = await client.request("/releases", {
      method: "POST",
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: sha,
        name: `Pion ${tag}`,
        draft: true,
        prerelease: false,
        body: `Automated Pion release from commit ${sha}.\n\nDownload the installer for your platform below.`,
      }),
    });
  }
  await mkdir(output, { recursive: true });
  const manifestPath = join(output, "latest.json");
  await writeFile(manifestPath, `${JSON.stringify(collected.manifest, null, 2)}\n`);
  const assets = [
    ...collected.assets,
    { name: "latest.json", path: manifestPath, size: (await stat(manifestPath)).size },
  ];
  // Only an unpublished draft can be repaired. Remove stale partial assets first.
  for (const asset of await releaseAssets(client, release))
    await client.request(`/releases/assets/${asset.id}`, { method: "DELETE" });
  for (const asset of assets) await client.upload(release, asset);
  const uploaded = await releaseAssets(client, release);
  if (
    uploaded.length !== assets.length ||
    assets.some(
      (asset) =>
        !uploaded.some((actual) => actual.name === asset.name && actual.size === asset.size),
    )
  ) {
    throw new Error("Release asset verification failed; leaving the release unpublished.");
  }
  await verifyTag(client, tag, sha);
  const newer = await hasNewerPublished(client, version);
  await client.request(`/releases/${release.id}`, {
    method: "PATCH",
    body: JSON.stringify({ draft: false, make_latest: newer ? "false" : "true" }),
  });
  return { tag, published: true, latest: !newer };
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      ["version", "sha", "platform", "app-version", "output", "artifacts"].map((key) => [
        key,
        { type: "string" },
      ]),
    ),
  });
  if (positionals[0] === "record") {
    await recordBuild({ ...values, appVersion: values["app-version"] });
  } else if (positionals[0] === "publish") {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_EVENT_NAME !== "push"
    )
      throw new Error("Publishing is restricted to main push workflows.");
    const repository = process.env.GITHUB_REPOSITORY;
    console.log(
      JSON.stringify(
        await publishRelease({
          ...values,
          repository,
          client: githubClient({ repository, token: process.env.GH_TOKEN }),
        }),
      ),
    );
  } else throw new Error("Expected record or publish command.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
