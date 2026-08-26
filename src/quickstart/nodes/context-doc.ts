/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Context-doc writer: a tmp markdown file that hands the run's outcome to an
 * agent. Contains endpoints and ids but NO credentials — it references the
 * config context by name, and the keys stay in the OS keychain. Never written
 * to ~/.elastic/, the user's repo, or AGENTS.md; the OS reaps the tmp dir.
 * The terminal scrollback is the durable record, so the essentials are also
 * printed by the caller.
 */

import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  LINKS,
  QUICKSTART_SCHEMA_VERSION,
  SEMANTIC_FIELD,
  LEXICAL_FIELD,
} from "../constants.ts";
import { projectCommandGroup, type QuickstartState } from "../types.ts";

/** Writes the context doc (dir 0700, file 0600) and returns its path. */
export async function writeContextDoc(state: QuickstartState): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "elastic-quickstart-"));
  await chmod(dir, 0o700);
  const path = join(dir, "context.md");
  await writeFile(path, renderContextDoc(state), {
    encoding: "utf-8",
    mode: 0o600,
  });
  return path;
}

/** Renders the full document: YAML frontmatter + agent-facing markdown. */
export function renderContextDoc(state: QuickstartState): string {
  const frontmatter = {
    schema_version: QUICKSTART_SCHEMA_VERSION,
    generated_by: "elastic quickstart",
    context: state.projectContextName ?? null,
    project: {
      type: state.projectType ?? null,
      id: state.projectId ?? null,
      name: state.projectName ?? null,
      region: state.regionId ?? null,
    },
    endpoints: {
      elasticsearch: state.endpoints?.elasticsearch ?? null,
      kibana: state.endpoints?.kibana ?? null,
    },
    index: state.indexName ?? null,
    docs_indexed: state.docsIndexed ?? null,
    created: ["serverless project", "config context", "sample index"],
  };

  const ctx = state.projectContextName ?? "<context>";
  const index = state.indexName ?? "books";
  const demo =
    state.demoQuery ??
    state.comparison?.query ??
    "a story about a girl growing up";
  const group = projectCommandGroup(state.projectType ?? "vectordb");

  const body = `# Elastic quickstart — handoff context

The user just completed \`elastic quickstart\`. A serverless ${state.projectType === "elasticsearch" ? "Search (vector-optimized)" : "Vector DB"} project
is running with sample data indexed. Continue building their search application from here.

## What exists now

- **Project**: ${state.projectName ?? ""} (\`${state.projectId ?? ""}\`, region \`${state.regionId ?? ""}\`)
- **Config context**: \`${ctx}\` — holds the project endpoints and ${
    state.esApiKeyMinted === true
      ? "an Elasticsearch API key"
      : "its credentials"
  },
  stored in the OS keychain and resolved by the \`elastic\` CLI. Run any command with
  \`elastic --use-context ${ctx} …\`; never copy the credentials out of the config.
- **Sample index**: \`${index}\` — books with \`${LEXICAL_FIELD}\` (text) copied into \`${SEMANTIC_FIELD}\`
  (\`semantic_text\`). Embeddings are generated at ingest by the default EIS inference endpoint —
  no model setup, and it is multilingual. Only the semantic field was declared; every other field
  was dynamically mapped.

## Commands that already work

\`\`\`sh
elastic status --use-context ${ctx}
elastic es search --index ${index} --use-context ${ctx} --input-file query.json --json
elastic es indices get-mapping --index ${index} --use-context ${ctx} --json
\`\`\`

## The queries just demonstrated

Keyword (BM25) — needs the words to match:

\`\`\`json
{ "query": { "match": { "${LEXICAL_FIELD}": { "query": "${demo}" } } } }
\`\`\`

Semantic — matches meaning:

\`\`\`json
{ "query": { "semantic": { "field": "${SEMANTIC_FIELD}", "query": "${demo}" } } }
\`\`\`

Hybrid search combines semantic and keyword matching — see ${LINKS.docsQuickstart}.

## Suggested next steps

1. Install the elasticsearch agent skills: \`npx skills add elastic/agent-skills\` and
  continue with the elasticsearch-onboarding skill.
2. Try hybrid retrieval (RRF over the two queries above).
3. Aggregate with ES|QL (e.g. books per decade) — not covered here on purpose.
4. Point a real application at the project: the CLI context already authenticates every
   \`elastic\` command. For an app's own configuration, mint that app a dedicated key
   (\`elastic es security create-api-key --name <app> --use-context ${ctx}\`) rather than
   reusing or extracting this context's key.
5. Run the Elastic Bookshop reference app against this project: ${LINKS.referenceApp}
   (its .env wants \`ELASTICSEARCH_URL\`, \`ELASTIC_API_KEY\`, optional \`KIBANA_URL\`).

## Links

- Continue the journey (docs quickstart): ${LINKS.docsQuickstart}
- For agents (Elasticsearch onboarding skill): ${LINKS.agentSkill}
- Vector search fundamentals: ${LINKS.vectorSearch}
- EIS embedding models: ${LINKS.eisModels}
- semantic_text reference: ${LINKS.semanticText}
- Ranking & reranking: ${LINKS.ranking}

## Cost awareness

Serverless projects bill by usage (ingest, retention, search power). This is a trial project and
disposable: delete it with
\`elastic cloud serverless projects ${group} delete --id ${state.projectId ?? "<id>"} --use-context ${state.cloudContextName ?? "<cloud-context>"}\`
or from the Cloud console. Billing dimensions: ${LINKS.billing}
`;

  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${body}`;
}
