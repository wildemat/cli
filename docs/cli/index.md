---
description: Use the Elastic CLI to interact with the Elastic Stack and Elastic Cloud from the command line.
applies_to:
  stack: preview
  serverless: preview
type: overview
---

The Elastic CLI (`elastic`) lets you manage Elasticsearch, Kibana, and Elastic Cloud resources from the command line. It supports both self-managed Elastic Stack deployments and Elastic Serverless projects.

Use the CLI to:
- Connect to multiple clusters or projects using named contexts
- Manage Elastic Cloud Hosted deployments and Serverless projects
- Automate operations in CI/CD pipelines and LLM agent workflows

To get started, see [Install the Elastic CLI](./installation.md) and [Configure the Elastic CLI](./configuration.md).

## Quickstart

New to Elastic? `elastic quickstart` takes you from nothing to a working
Vector DB serverless project with sample data indexed and a live comparison
of keyword (BM25) versus semantic search, then hands off to your coding agent
or Kibana:

```sh
npx @elastic/cli quickstart
```

At a TTY the command runs interactively. Without a TTY (or with `--json`) it
emits a self-describing runbook for coding agents, which then run the
underlying `elastic` commands directly.
