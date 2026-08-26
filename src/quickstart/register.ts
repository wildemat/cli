/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `elastic quickstart` — zero-flag, one-time triage from nothing to a working
 * Vector DB serverless project with sample data and a proof-of-value query.
 *
 * Two renderers over one flow: interactive (TTY) walks the tree with prompts;
 * agent mode (no TTY, or --json) emits the self-describing runbook once and
 * exits. Only global flags apply — the command itself takes none.
 */

import { defineCommand } from "../factory.ts";
import type {
  JsonValue,
  OpaqueCommandHandle,
  ParsedResult,
} from "../factory.ts";
import { resolveCloudEnv, type CloudEnv } from "./constants.ts";
import { detectMode } from "./mode.ts";
import { buildRunbook } from "./runbook.ts";
import { runCli } from "./executor.ts";
import { createPrompter, PromptCancelled } from "./prompts.ts";
import { openBrowser } from "./browser.ts";
import type { QuickstartDeps, QuickstartState } from "./types.ts";
import { QuickstartHalt } from "./types.ts";

function productionDeps(cloudEnv: CloudEnv): QuickstartDeps {
  return {
    runCli,
    prompter: createPrompter(),
    fetchFn: globalThis.fetch,
    openBrowser,
    env: process.env,
    cloudEnv,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** Summary returned (and rendered) after a completed interactive run. */
export function buildSummary(state: QuickstartState): JsonValue {
  return {
    kind: "elastic-quickstart-summary",
    project: {
      type: state.projectType ?? null,
      id: state.projectId ?? null,
      name: state.projectName ?? null,
      region: state.regionId ?? null,
    },
    context: state.projectContextName ?? null,
    endpoints: {
      elasticsearch: state.endpoints?.elasticsearch ?? null,
      kibana: state.endpoints?.kibana ?? null,
    },
    index: state.indexName ?? null,
    docs_indexed: state.docsIndexed ?? null,
    context_doc: state.contextDocPath ?? null,
    handoff: state.handoff?.choice ?? null,
  };
}

/** Human rendering of the final summary (stdout — the durable scrollback). */
export function formatSummaryText(summary: Record<string, JsonValue>): string {
  const project = summary.project as Record<string, string | null> | undefined;
  const endpoints = summary.endpoints as
    | Record<string, string | null>
    | undefined;
  const lines = [
    "Elastic quickstart — done.",
    "",
    `  Project:        ${project?.name ?? ""} (${project?.type ?? ""}, ${project?.region ?? ""})`,
    `  Context:        ${String(summary.context ?? "")} (elastic --use-context ${String(summary.context ?? "")} …)`,
    `  Elasticsearch:  ${endpoints?.elasticsearch ?? ""}`,
    `  Kibana:         ${endpoints?.kibana ?? ""}`,
    `  Sample index:   ${String(summary.index ?? "")} (${String(summary.docs_indexed ?? 0)} docs)`,
    `  Context doc for your agent:    ${String(summary.context_doc ?? "")}`,
    "",
  ];
  return lines.join("\n");
}

/** Exported for direct unit testing; registered via {@link registerQuickstartCommand}. */
export async function quickstartHandler(
  parsed: ParsedResult,
): Promise<JsonValue> {
  const jsonFlag = parsed.options["json"] === true;
  const mode = detectMode(jsonFlag);

  let cloudEnv: CloudEnv;
  try {
    cloudEnv = resolveCloudEnv(process.env);
  } catch (err) {
    return { error: { code: "bad_env", message: (err as Error).message } };
  }

  if (mode === "agent") {
    return buildRunbook(cloudEnv);
  }

  const deps = productionDeps(cloudEnv);
  const { walkFlow } = await import("./tree.ts");

  deps.prompter.intro("elastic quickstart — vector search in minutes");
  if (cloudEnv.name !== "prod") {
    deps.prompter.warn(
      `ELASTIC_ENV=${cloudEnv.name} — targeting ${cloudEnv.apiUrl}`,
    );
  }
  try {
    const state = await walkFlow(deps);
    const summary = buildSummary(state) as Record<string, JsonValue>;
    return summary;
  } catch (err) {
    if (err instanceof PromptCancelled) {
      deps.prompter.outro(
        "Cancelled — nothing else was changed. Re-run anytime: elastic quickstart",
      );
      return { kind: "elastic-quickstart-summary", cancelled: true };
    }
    if (err instanceof QuickstartHalt) {
      const steps =
        err.nextSteps.length > 0
          ? `\nNext steps:\n${err.nextSteps.map((s) => `  - ${s}`).join("\n")}`
          : "";
      return { error: { code: err.code, message: `${err.message}${steps}` } };
    }
    throw err;
  }
}

/** Builds the `elastic quickstart` command handle. */
export function registerQuickstartCommand(): OpaqueCommandHandle {
  return defineCommand({
    name: "quickstart",
    description:
      "Create a Vector DB serverless project, index sample data, and see semantic search work — then keep building with your agent or Kibana",
    handler: quickstartHandler,
    formatOutput: (result) => {
      const obj = result as Record<string, JsonValue>;
      if (obj != null && obj.kind === "elastic-quickstart-summary") {
        if (obj.cancelled === true) return "Cancelled.\n";
        return formatSummaryText(obj);
      }
      // Agent-mode runbook without --json: still machine-consumable JSON.
      return JSON.stringify(result, null, 2) + "\n";
    },
  });
}
