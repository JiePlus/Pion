import utilityStyles from "../primitives/Utilities.module.css";
import { Select } from "../primitives/Select.tsx";
import { componentClass } from "../componentClass.ts";
import managementStyles from "./Management.module.css";
import { Card, EmptyState, PageHero } from "./PageKit.tsx";
import type { Dispatch, SetStateAction } from "react";
import { native } from "../../core/host.ts";
import { t } from "../../core/i18n.ts";
import type { Runtime } from "../../core/runtime.ts";

export interface PiPackage {
  source: string;
  scope: "user" | "project";
}

interface PiPackagesProps {
  packageSource: string;
  setPackageSource: Dispatch<SetStateAction<string>>;
  packageScope: "user" | "project";
  setPackageScope: Dispatch<SetStateAction<"user" | "project">>;
  packageSources: PiPackage[];
  packageBusy: boolean;
  projectId: string;
  packageAction: (
    op: "install" | "update" | "remove",
    source: string,
    scope: "user" | "project",
  ) => Promise<void>;
  runtime: Runtime;
}

export function PiPackages({
  packageSource,
  setPackageSource,
  packageScope,
  setPackageScope,
  packageSources,
  packageBusy,
  projectId,
  packageAction,
  runtime,
}: PiPackagesProps) {
  return (
    <main className={componentClass(managementStyles, "management")}>
      <PageHero
        eyebrow="Pi packages"
        title={t("Pi packages")}
        description={t(
          "Pi packages run with your user permissions. Review their source before installing.",
        )}
        stat={{ value: packageSources.length, caption: "installed", tone: "orange" }}
      />
      <Card span={5} icon="download" eyebrow="Install">
        <form
          className={componentClass(managementStyles, "install-form")}
          onSubmit={(event) => {
            event.preventDefault();
            packageAction("install", packageSource.trim(), packageScope).catch((error) =>
              runtime.notice("Pi", String(error)),
            );
          }}
        >
          <label>
            {t("Package source")}
            <input
              value={packageSource}
              maxLength={512}
              placeholder="npm:package, git:host/repo, URL, /absolute/path"
              onChange={(event) => setPackageSource(event.target.value)}
            />
          </label>
          <label>
            {t("Install scope")}
            <Select
              label={t("Install scope")}
              value={packageScope}
              onChange={setPackageScope}
              options={[
                { value: "user" as const, label: t("User") },
                ...(projectId ? [{ value: "project" as const, label: t("Project") }] : []),
              ]}
            />
          </label>
          <button type="submit" disabled={!native || packageBusy || !packageSource.trim()}>
            {t("Install")}
          </button>
        </form>
      </Card>
      <Card
        span={7}
        icon="grid"
        title={t("Installed Pi packages")}
        headingId="installed-packages-heading"
      >
        {!packageSources.length && (
          <EmptyState icon="grid">{t("No Pi packages installed.")}</EmptyState>
        )}
        {packageSources.map((item) => (
          <article
            className={componentClass(managementStyles, "plugin-card")}
            key={`${item.scope}:${item.source}`}
          >
            <span>
              {item.source} <small>{t(item.scope === "project" ? "Project" : "User")}</small>
            </span>
            <div className={componentClass(managementStyles, "card-actions")}>
              <button
                disabled={packageBusy}
                onClick={() =>
                  packageAction("update", item.source, item.scope).catch((error) =>
                    runtime.notice("Pi", String(error)),
                  )
                }
              >
                {t("Update")}
              </button>
              <button
                disabled={packageBusy}
                onClick={() =>
                  packageAction("remove", item.source, item.scope).catch((error) =>
                    runtime.notice("Pi", String(error)),
                  )
                }
              >
                {t("Remove")}
              </button>
            </div>
          </article>
        ))}
      </Card>
    </main>
  );
}
