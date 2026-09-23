import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

function packageEntry(executable) {
  const paths = isAbsolute(executable)
    ? [executable]
    : (process.env.PATH ?? "").split(delimiter).map((entry) => join(entry, executable));
  const found = paths.find(existsSync);
  if (!found) throw new Error("Pi executable was not found");
  const windowsPackage = join(
    dirname(found),
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "index.js",
  );
  if (existsSync(windowsPackage)) return windowsPackage;
  let directory = dirname(realpathSync(found));
  while (directory !== dirname(directory)) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const packageName = JSON.parse(readFileSync(manifest, "utf8")).name;
      if (packageName === "@earendil-works/pi-coding-agent")
        return join(directory, "dist/index.js");
    }
    directory = dirname(directory);
  }
  throw new Error(`Pi SDK is unavailable for ${basename(found)}`);
}

function resourceName(path) {
  return basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path);
}

const [, , executable, cwd, projectFlag] = process.argv;
process.env.PI_OFFLINE = "1";

try {
  const { DefaultPackageManager, SettingsManager, getAgentDir } = await import(
    pathToFileURL(packageEntry(executable)).href
  );
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(cwd, agentDir, {
    projectTrusted: projectFlag === "true",
  });
  const manager = new DefaultPackageManager({
    cwd: cwd || agentDir,
    agentDir,
    settingsManager: settings,
  });
  const resolved = await manager.resolve();
  let userResources = new Map();
  if (projectFlag === "true") {
    const userSettings = SettingsManager.create(agentDir, agentDir);
    const userManager = new DefaultPackageManager({
      cwd: agentDir,
      agentDir,
      settingsManager: userSettings,
    });
    const userResolved = await userManager.resolve();
    userResources = new Map(userResolved.skills.map((item) => [item.path, item]));
  }
  const skills = resolved.skills.map((item) => {
    const inherited = userResources.get(item.path);
    const metadata = inherited?.metadata ?? item.metadata;
    const baseDir =
      metadata.baseDir ??
      (metadata.origin === "package"
        ? dirname(item.path)
        : metadata.scope === "project"
          ? join(cwd, ".pi")
          : agentDir);
    return {
      name: resourceName(item.path),
      path: item.path,
      enabled: item.enabled,
      userEnabled: inherited?.enabled ?? item.enabled,
      scope: metadata.scope,
      origin: metadata.origin,
      source: metadata.origin === "package" ? metadata.source : null,
      baseDir,
      pattern: relative(baseDir, item.path).replaceAll("\\", "/"),
    };
  });
  const projectEntries = settings.getProjectSettings().skills ?? [];
  const paths = {
    user: (settings.getGlobalSettings().skills ?? []).filter((entry) => !/^[!+-]/.test(entry)),
    project: projectEntries.filter(
      (entry) =>
        !/^[!+-]/.test(entry) &&
        !(
          userResources.has(entry) &&
          projectEntries.some((other) => other === `+${entry}` || other === `-${entry}`)
        ),
    ),
  };
  process.stdout.write(
    `${JSON.stringify({
      paths,
      skills,
      skillCommands: {
        user: settings.getGlobalSettings().enableSkillCommands ?? true,
        project:
          settings.getProjectSettings().enableSkillCommands === undefined
            ? "inherit"
            : settings.getProjectSettings().enableSkillCommands
              ? "enabled"
              : "disabled",
      },
    })}\n`,
  );
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: String(error) })}\n`);
  process.exitCode = 1;
}
