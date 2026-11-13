import utilityStyles from "../primitives/Utilities.module.css";
import { Select } from "../primitives/Select.tsx";
import { componentClass } from "../componentClass.ts";
import managementStyles from "./Management.module.css";
import { Card, EmptyState, PageHero } from "./PageKit.tsx";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { Runtime } from "../../core/runtime.ts";
import { Checkbox } from "../primitives/Checkbox.tsx";
import { Icon } from "../primitives/Icon.tsx";
import styles from "./Skills.module.css";

export interface PiSkill {
  name: string;
  path: string;
  scope: "user" | "project";
  origin: "package" | "top-level";
  source: string | null;
  enabled: boolean;
  userEnabled: boolean;
  projectOverride?: "inherit" | "load" | "unload";
}
export interface PiSkills {
  paths: { user: string[]; project: string[] };
  skills: PiSkill[];
  skillCommands: { user: boolean; project: "inherit" | "enabled" | "disabled" };
}
interface SkillsProps {
  skills: PiSkills;
  skillScope: "user" | "project";
  setSkillScope: Dispatch<SetStateAction<"user" | "project">>;
  skillBusy: boolean;
  skillPath: string;
  setSkillPath: Dispatch<SetStateAction<string>>;
  projectId: string;
  skillCommands: (state: "inherit" | "enabled" | "disabled") => Promise<void>;
  skillAction: (op: "add" | "remove", path: string) => Promise<void>;
  skillOverride: (skill: PiSkill, state: "inherit" | "load" | "unload") => Promise<void>;
  skillToggle: (skill: PiSkill) => Promise<void>;
  runtime: Runtime;
}

export function Skills({
  skills,
  skillScope,
  setSkillScope,
  skillBusy,
  skillPath,
  setSkillPath,
  projectId,
  skillCommands,
  skillAction,
  skillOverride,
  skillToggle,
  runtime,
}: SkillsProps) {
  return (
    <main className={`${componentClass(managementStyles, "management")} ${styles.skillsPage}`}>
      <PageHero
        eyebrow="Pi skills"
        title={t("Pi skills")}
        description={t(
          "Manage discovered user, project, and Pi package skills here. Install and update packages under Pi packages.",
        )}
        stat={{
          value: skills.skills.filter((skill) => skillScope === "project" || skill.scope === "user")
            .length,
          caption: "skills",
          tone: "green",
        }}
      />
      <Card span={7} icon="bolt" eyebrow="Add">
        {skillScope === "user" ? (
          <label>
            <Checkbox
              checked={skills.skillCommands.user}
              disabled={!native || skillBusy}
              onChange={(event) =>
                skillCommands(event.target.checked ? "enabled" : "disabled").catch((error) =>
                  runtime.notice("Pi", String(error)),
                )
              }
            />
            {t("Show /skill:name commands in the command menu")}
          </label>
        ) : (
          <label>
            {t("Show /skill:name commands in the command menu")}
            <Select
              label={t("Show /skill:name commands in the command menu")}
              value={skills.skillCommands.project}
              disabled={!native || skillBusy}
              onChange={(value) =>
                skillCommands(value).catch((error) => runtime.notice("Pi", String(error)))
              }
              options={[
                { value: "inherit" as const, label: t("Inherit") },
                { value: "enabled" as const, label: t("Enabled") },
                { value: "disabled" as const, label: t("Disabled") },
              ]}
            />
          </label>
        )}
        <form
          className={componentClass(managementStyles, "install-form")}
          onSubmit={(event) => {
            event.preventDefault();
            skillAction("add", skillPath.trim()).catch((error) =>
              runtime.notice("Pi", String(error)),
            );
          }}
        >
          <label>
            {t("Skill file or directory")}
            <input
              value={skillPath}
              maxLength={1024}
              placeholder="/path/to/skill or /path/to/SKILL.md"
              onChange={(event) => setSkillPath(event.target.value)}
            />
          </label>
          <label>
            {t("Skill scope")}
            <Select
              label={t("Skill scope")}
              value={skillScope}
              onChange={setSkillScope}
              options={[
                { value: "user" as const, label: t("User") },
                ...(projectId ? [{ value: "project" as const, label: t("Project") }] : []),
              ]}
            />
          </label>
          <button type="submit" disabled={!native || skillBusy || !skillPath.trim()}>
            {t("Add skill")}
          </button>
        </form>
      </Card>
      <Card
        span={5}
        icon="folder"
        title={t("Additional skill paths")}
        headingId="skill-paths-heading"
      >
        {!skills.paths[skillScope].length && (
          <EmptyState icon="folder">{t("No additional skill paths.")}</EmptyState>
        )}
        {skills.paths[skillScope].map((path) => (
          <article className={componentClass(managementStyles, "plugin-card")} key={path}>
            <code>{path}</code>
            <button
              disabled={skillBusy}
              onClick={() =>
                skillAction("remove", path).catch((error) => runtime.notice("Pi", String(error)))
              }
            >
              {t("Remove")}
            </button>
          </article>
        ))}
      </Card>
      <Card icon="bolt" title={t("Installed skills")} headingId="installed-skills-heading">
        {!skills.skills.filter((skill) => skillScope === "project" || skill.scope === "user")
          .length && <EmptyState icon="bolt">{t("No Pi skills detected.")}</EmptyState>}
        <ul className={styles.skillList} aria-labelledby="installed-skills-heading">
          {skills.skills
            .filter((skill) => skillScope === "project" || skill.scope === "user")
            .map((skill) => (
              <li
                className={`${styles.skillRow} ${skillScope === "project" ? styles.projectRow : ""}`}
                key={skill.path}
              >
                <span className={styles.skillIcon} aria-hidden="true">
                  <Icon name="bolt" size={24} />
                </span>
                <div className={styles.skillDetails}>
                  <div className={styles.skillTitle}>
                    <strong>{skill.name}</strong>
                    <span>{t(skill.scope === "project" ? "Project" : "User")}</span>
                    {skillScope === "project" && (
                      <span>{t(skill.enabled ? "Enabled" : "Disabled")}</span>
                    )}
                  </div>
                  <p className={styles.skillPath} title={skill.path}>
                    <code>{skill.path}</code>
                  </p>
                  {skill.source && (
                    <p className={styles.skillSource} title={skill.source}>
                      {skill.source}
                    </p>
                  )}
                </div>
                {skillScope === "project" ? (
                  <label className={styles.projectOverride}>
                    {t("Project override")}
                    <Select
                      compact
                      label={`${t("Project override")} ${skill.name}`}
                      value={skill.projectOverride ?? "inherit"}
                      disabled={skillBusy}
                      onChange={(value) =>
                        skillOverride(skill, value).catch((error) =>
                          runtime.notice("Pi", String(error)),
                        )
                      }
                      options={[
                        { value: "inherit" as const, label: t("Inherit") },
                        { value: "load" as const, label: t("Load") },
                        { value: "unload" as const, label: t("Unload") },
                      ]}
                    />
                  </label>
                ) : (
                  <button
                    type="button"
                    className={styles.skillSwitch}
                    role="switch"
                    aria-checked={skill.userEnabled}
                    aria-label={skill.name}
                    title={`${t(skill.userEnabled ? "Disable" : "Enable")} ${skill.name}`}
                    disabled={skillBusy}
                    onClick={() =>
                      skillToggle(skill).catch((error) => runtime.notice("Pi", String(error)))
                    }
                  >
                    <span className={styles.switchTrack} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
        </ul>
      </Card>
    </main>
  );
}
