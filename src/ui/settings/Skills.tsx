import utilityStyles from "../primitives/Utilities.module.css";
import { componentClass } from "../componentClass.ts";
import managementStyles from "./Management.module.css";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { Runtime } from "../../core/runtime.ts";
import { Checkbox } from "../primitives/Checkbox.tsx";
import { Icon } from "../primitives/Icon.tsx";
import { Switch } from "../primitives/Switch.tsx";
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
      <h1>{t("Pi skills")}</h1>
      <p className={`settings-note ${utilityStyles.settingsNote}`}>
        {t(
          "Manage discovered user, project, and Pi package skills here. Install and update packages under Pi packages.",
        )}
      </p>
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
          <select
            value={skills.skillCommands.project}
            disabled={!native || skillBusy}
            onChange={(event) =>
              skillCommands(event.target.value as "inherit" | "enabled" | "disabled").catch(
                (error) => runtime.notice("Pi", String(error)),
              )
            }
          >
            <option value="inherit">{t("Inherit")}</option>
            <option value="enabled">{t("Enabled")}</option>
            <option value="disabled">{t("Disabled")}</option>
          </select>
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
          <select
            value={skillScope}
            onChange={(event) => setSkillScope(event.target.value as "user" | "project")}
          >
            <option value="user">{t("User")}</option>
            {!!projectId && <option value="project">{t("Project")}</option>}
          </select>
        </label>
        <button type="submit" disabled={!native || skillBusy || !skillPath.trim()}>
          {t("Add skill")}
        </button>
      </form>
      <h3>{t("Additional skill paths")}</h3>
      {!skills.paths[skillScope].length && (
        <p className="muted">{t("No additional skill paths.")}</p>
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
      <h3 id="installed-skills-heading">{t("Installed skills")}</h3>
      {!skills.skills.filter((skill) => skillScope === "project" || skill.scope === "user")
        .length && <p className="muted">{t("No Pi skills detected.")}</p>}
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
                  <select
                    aria-label={`${t("Project override")} ${skill.name}`}
                    value={skill.projectOverride ?? "inherit"}
                    disabled={skillBusy}
                    onChange={(event) =>
                      skillOverride(
                        skill,
                        event.target.value as "inherit" | "load" | "unload",
                      ).catch((error) => runtime.notice("Pi", String(error)))
                    }
                  >
                    <option value="inherit">{t("Inherit")}</option>
                    <option value="load">{t("Load")}</option>
                    <option value="unload">{t("Unload")}</option>
                  </select>
                </label>
              ) : (
                <Switch
                  checked={skill.userEnabled}
                  aria-label={skill.name}
                  title={`${t(skill.userEnabled ? "Disable" : "Enable")} ${skill.name}`}
                  disabled={skillBusy}
                  onClick={() =>
                    skillToggle(skill).catch((error) => runtime.notice("Pi", String(error)))
                  }
                />
              )}
            </li>
          ))}
      </ul>
    </main>
  );
}
