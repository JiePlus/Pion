import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { collectRelease, publishRelease, recordBuild } from "../scripts/publish-release.mjs";

const version = "0.1.2";
const sha = "a".repeat(40);
const repository = "JiePlus/Pion";

type Release = { id: number; draft: boolean; upload_url: string };
type Asset = { name: string; path: string; size: number; id: number; content: string };
type Write = { method: string; path: string; body?: { make_latest?: string } };

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pion-publish-test-"));
  assert.ok(root.startsWith(join(tmpdir(), "pion-publish-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const platform of ["macos", "linux", "windows"]) {
    await recordBuild({
      version,
      sha,
      platform,
      appVersion: version,
      output: join(root, `release-${platform}.json`),
    });
  }
  for (const name of [
    "Pion_0.1.2_universal.dmg",
    "Pion_0.1.2_amd64.deb",
    "Pion_0.1.2_x64_en-US.msi",
    "Pion.app.tar.gz",
    "Pion_0.1.2_amd64.AppImage",
    "Pion_0.1.2_x64-setup.exe",
  ]) {
    await writeFile(join(root, name), `payload:${name}`);
  }
  for (const name of ["Pion.app.tar.gz", "Pion_0.1.2_amd64.AppImage", "Pion_0.1.2_x64-setup.exe"]) {
    await writeFile(join(root, `${name}.sig`), Buffer.from(`signature:${name}`).toString("base64"));
  }
  return { artifacts: root, output: join(root, "publish"), version, sha, repository };
}

function fakeGitHub({ newer = false, tagSha = sha } = {}) {
  const state: {
    release: Release | null;
    assets: Asset[];
    writes: Write[];
    failAfterUploads: number;
    uploads: number;
  } = { release: null, assets: [], writes: [], failAfterUploads: -1, uploads: 0 };
  let nextId = 100;
  const client = {
    async request(
      path: string,
      options: { method?: string; body?: string; allowMissing?: boolean } = {},
    ) {
      const method = options.method ?? "GET";
      if (method !== "GET")
        state.writes.push({ method, path, body: options.body && JSON.parse(options.body) });
      if (path.startsWith("/git/ref/tags/")) return { object: { type: "tag", sha: "tag-object" } };
      if (path === "/git/tags/tag-object") return { object: { type: "commit", sha: tagSha } };
      if (path.startsWith("/releases/tags/")) return state.release;
      if (path === "/releases" && method === "POST") {
        assert.ok(options.body);
        state.release = {
          id: 1,
          ...JSON.parse(options.body),
          upload_url: "https://uploads.github.com/test{?name,label}",
        };
        return state.release;
      }
      if (path.startsWith("/releases/1/assets?")) return state.assets;
      if (path.startsWith("/releases/assets/") && method === "DELETE") {
        state.assets = state.assets.filter((asset) => asset.id !== Number(path.split("/").at(-1)));
        return null;
      }
      if (path.startsWith("/releases?"))
        return newer ? [{ tag_name: "v0.1.3", draft: false, prerelease: false }] : [];
      if (path === "/releases/1" && method === "PATCH") {
        assert.ok(state.release);
        assert.ok(options.body);
        Object.assign(state.release, JSON.parse(options.body));
        return state.release;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
    async upload(_release: Release, asset: Omit<Asset, "id" | "content">) {
      state.writes.push({ method: "UPLOAD", path: asset.name });
      if (state.failAfterUploads === state.uploads++)
        throw new Error("Simulated asset upload failure");
      const value = { ...asset, id: nextId++, content: await readFile(asset.path, "utf8") };
      state.assets.push(value);
      return value;
    },
    async download(asset: Asset) {
      return asset.content;
    },
  };
  return { client, state };
}

test("one manifest contains every supported architecture and matching updater payload signatures", async (t) => {
  const options = await fixture(t);
  const { manifest, assets } = await collectRelease(options);
  assert.deepEqual(Object.keys(manifest.platforms), [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(manifest.version, version);
  assert.deepEqual(manifest.platforms["darwin-aarch64"], manifest.platforms["darwin-x86_64"]);
  assert.match(
    manifest.platforms["darwin-x86_64"].url,
    /v0\.1\.2\/Pion_0\.1\.2_universal\.app\.tar\.gz$/,
  );
  assert.match(manifest.platforms["windows-x86_64"].url, /-setup\.exe$/);
  for (const entry of Object.values(manifest.platforms)) {
    const assetName = new URL(entry.url).pathname.split("/").at(-1);
    const signature = assets.find((asset) => asset.name === `${assetName}.sig`);
    assert.ok(signature);
    assert.equal(entry.signature, (await readFile(signature.path, "utf8")).trim());
  }
});

test("refuses mismatched native build version before recording identity", async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    recordBuild({
      ...options,
      platform: "linux",
      appVersion: "0.1.1",
      output: join(options.artifacts, "wrong.json"),
    }),
    /Build identity mismatch/,
  );
});

test("missing payload/signature, duplicate assets, and mismatched SHA all fail before creating a Release", async (t) => {
  for (const failure of ["signature", "payload", "duplicate", "identity"]) {
    await t.test(failure, async (t) => {
      const options = await fixture(t);
      if (failure === "signature") await rm(join(options.artifacts, "Pion.app.tar.gz.sig"));
      if (failure === "payload") await rm(join(options.artifacts, "Pion_0.1.2_x64-setup.exe"));
      if (failure === "duplicate") {
        await recordBuild({
          ...options,
          platform: "macos",
          appVersion: version,
          output: join(options.artifacts, "duplicate/release-macos.json"),
        });
      }
      if (failure === "identity")
        await writeFile(
          join(options.artifacts, "release-linux.json"),
          JSON.stringify({ platform: "linux", version, sha: "b".repeat(40) }),
        );
      const { client, state } = fakeGitHub();
      await assert.rejects(publishRelease({ ...options, client }));
      assert.equal(state.writes.length, 0);
    });
  }
});

test("a partial upload stays draft; retry repairs only that draft and publishes after all assets verify", async (t) => {
  const options = await fixture(t);
  const { client, state } = fakeGitHub();
  state.failAfterUploads = 2;
  await assert.rejects(publishRelease({ ...options, client }), /Simulated asset upload failure/);
  assert.ok(state.release);
  assert.equal(state.release.draft, true);
  assert.equal(state.writes.filter((write) => write.method === "PATCH").length, 0);
  state.failAfterUploads = -1;
  const result = await publishRelease({ ...options, client });
  assert.equal(result.latest, true);
  assert.equal(state.release.draft, false);
  const publish = state.writes.at(-1);
  assert.ok(publish);
  assert.equal(publish.method, "PATCH");
  assert.equal(publish.body?.make_latest, "true");
  assert.equal(new Set(state.assets.map((asset) => asset.name)).size, state.assets.length);
  assert.ok(state.assets.some((asset) => asset.name === "latest.json"));
});

test("published same-SHA release is immutable even if a rebuild produces different signature bytes", async (t) => {
  const options = await fixture(t);
  const { client, state } = fakeGitHub();
  await publishRelease({ ...options, client });
  state.writes.length = 0;
  await writeFile(
    join(options.artifacts, "Pion.app.tar.gz.sig"),
    Buffer.from("new rebuild signature").toString("base64"),
  );
  const result = await publishRelease({ ...options, client });
  assert.equal(result.reused, true);
  assert.deepEqual(state.writes, []);
});

test("refuses to overwrite damaged published releases", async (t) => {
  const options = await fixture(t);
  const { client, state } = fakeGitHub();
  await publishRelease({ ...options, client });
  state.assets = state.assets.filter((asset) => asset.name !== "latest.json");
  state.writes.length = 0;
  await assert.rejects(publishRelease({ ...options, client }), /no latest\.json/);
  assert.deepEqual(state.writes, []);
});

test("old run recovery cannot roll the latest updater back behind a newer published version", async (t) => {
  const options = await fixture(t);
  const { client, state } = fakeGitHub({ newer: true });
  const result = await publishRelease({ ...options, client });
  assert.equal(result.latest, false);
  const publish = state.writes.at(-1);
  assert.ok(publish);
  assert.equal(publish.body?.make_latest, "false");
});

test("annotated release tag must resolve to the reserved SHA", async (t) => {
  const options = await fixture(t);
  const { client, state } = fakeGitHub({ tagSha: "b".repeat(40) });
  await assert.rejects(publishRelease({ ...options, client }), /does not point to/);
  assert.deepEqual(state.writes, []);
});
