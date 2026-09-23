import { useEffect, useState } from "react";
import { host, native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { Runtime } from "../../core/runtime.ts";
import type { Page } from "../layout/types.ts";
import type { PiPackage } from "../settings/PiPackages.tsx";
import type { PiSkill, PiSkills } from "../settings/Skills.tsx";

export function usePackageSkills(page: Page, projectId: string, runtime: Runtime) {
  const [packageSource, setPackageSource] = useState("");
  const [packageSources, setPackageSources] = useState<PiPackage[]>([]);
  const [packageScope, setPackageScope] = useState<"user" | "project">("user");
  const [packageBusy, setPackageBusy] = useState(false);
  const [skillPath, setSkillPath] = useState("");
  const [skillScope, setSkillScope] = useState<"user" | "project">("user");
  const [skills, setSkills] = useState<PiSkills>({
    paths: { user: [], project: [] },
    skills: [],
    skillCommands: { user: true, project: "inherit" },
  });
  const [skillBusy, setSkillBusy] = useState(false);
  useEffect(() => {
    if (page !== "packages" || !native) return;
    host<{ sources: PiPackage[] }>({ op: "package.list", projectId })
      .then((result) => setPackageSources(result.sources))
      .catch((error) => runtime.notice("Pi", String(error)));
  }, [page, projectId, runtime]);

  async function packageAction(
    op: "install" | "update" | "remove",
    source: string,
    scope: "user" | "project",
  ) {
    setPackageBusy(true);
    try {
      const result = await host<{ sources: PiPackage[] }>({
        op: `package.${op}`,
        source,
        scope,
        projectId,
      });
      setPackageSources(result.sources);
      if (op === "install") setPackageSource("");
      runtime.notice("Pi", t("Reopen a task to load Pi package changes."));
    } finally {
      setPackageBusy(false);
    }
  }

  useEffect(() => {
    if (page !== "skills" || !native) return;
    host<PiSkills>({ op: "skill.list", projectId })
      .then(setSkills)
      .catch((error) => runtime.notice("Pi", String(error)));
  }, [page, projectId, runtime]);

  useEffect(() => {
    if (!projectId) {
      setSkillScope("user");
      setPackageScope("user");
    }
  }, [projectId]);

  async function skillAction(op: "add" | "remove", path: string) {
    setSkillBusy(true);
    try {
      setSkills(await host<PiSkills>({ op: `skill.${op}`, path, scope: skillScope, projectId }));
      if (op === "add") setSkillPath("");
      runtime.notice("Pi", t("Reopen a task to load Pi skill changes."));
    } finally {
      setSkillBusy(false);
    }
  }

  async function skillToggle(skill: PiSkill) {
    setSkillBusy(true);
    try {
      setSkills(
        await host<PiSkills>({
          op: "skill.toggle",
          projectId,
          path: skill.path,
          enabled: !skill.userEnabled,
        }),
      );
      runtime.notice("Pi", t("Reopen a task to load Pi skill changes."));
    } finally {
      setSkillBusy(false);
    }
  }

  async function skillOverride(skill: PiSkill, state: "inherit" | "load" | "unload") {
    setSkillBusy(true);
    try {
      setSkills(await host<PiSkills>({ op: "skill.override", projectId, path: skill.path, state }));
      runtime.notice("Pi", t("Reopen a task to load Pi skill changes."));
    } finally {
      setSkillBusy(false);
    }
  }

  async function skillCommands(state: "inherit" | "enabled" | "disabled") {
    setSkillBusy(true);
    try {
      setSkills(
        await host<PiSkills>({ op: "skill.commands", projectId, scope: skillScope, state }),
      );
      runtime.notice("Pi", t("Reopen a task to load Pi skill changes."));
    } finally {
      setSkillBusy(false);
    }
  }

  return {
    packageSource,
    setPackageSource,
    packageSources,
    setPackageSources,
    packageScope,
    setPackageScope,
    packageBusy,
    setPackageBusy,
    skillPath,
    setSkillPath,
    skillScope,
    setSkillScope,
    skills,
    setSkills,
    skillBusy,
    setSkillBusy,
    packageAction,
    skillAction,
    skillToggle,
    skillOverride,
    skillCommands,
  };
}
