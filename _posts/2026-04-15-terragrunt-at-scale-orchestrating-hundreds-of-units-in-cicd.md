---
title: "Terragrunt at Scale: Orchestrating Hundreds of Units in CI/CD with run --all and Drift Detection"
description: "Learn how to orchestrate hundreds of Terragrunt units in a scalable CI/CD pipeline, executing only the affected delta with --filter-affected, generating structured execution reports, and implementing continuous Configuration Drift detection via GitOps."
date: 2026-04-15 19:00:00 +0000
lang: en
permalink: /en/posts/terragrunt-at-scale-orchestrating-hundreds-of-units-in-cicd/
categories: [Terraform, Platform Engineering, SRE]
tags: [Terragrunt, CI/CD, Drift Detection, GitOps, IaC, Platform Engineering]
icons: [terraform, terragrunt]
---

## Introduction

There is a widespread misconception that simply adopting Terragrunt as an orchestration layer over OpenTofu/Terraform automatically makes the CI/CD pipeline scalable. In operational reality, the opposite often occurs.

As the infrastructure repository evolves from dozens to hundreds of **units** (a unit is a directory containing a single `terragrunt.hcl`, with its own state and lifecycle), the naive pipeline begins executing `terragrunt run --all plan` over the entire graph on every Pull Request. The result is a slow, costly, and paradoxically more risky pipeline.

This article dissects the execution architecture of `run --all` in Terragrunt 1.0 and establishes the engineering patterns necessary to build pipelines that operate on the **delta** (only the set of units actually altered), produce structured telemetry, and incorporate continuous **Configuration Drift** detection (Drift: when the actual state provisioned in the cloud no longer matches the declared code).

## The Scale Problem: The Cost of the Complete Graph

Before optimizing, we must understand the origin of the cost. Terragrunt models the relationships between units as a **DAG** (Directed Acyclic Graph), constructed from `dependency` blocks.

In a pipeline that invokes `run --all` without any restriction, Terragrunt traverses this entire graph. For a large-scale repository, this imposes three structural penalties:

1. **Execution latency.** Each unit triggers an `init` and `plan` process, authenticating with the cloud provider. Hundreds of units transform a job of minutes into an operation of dozens of minutes.
2. **Computational and API cost.** Full state re-evaluation on every commit consumes cloud provider API quotas and runner time unnecessarily.
3. **Expanded blast radius.** An `apply` spanning the entire graph (instead of the delta) increases the **blast radius** of any change, even if the actual modification was point-specific.

Maturity in Platform Engineering demands that the pipeline reflect the incremental nature of changes. You did not modify three hundred units; you modified three.

## The Anatomy of `run --all` in Terragrunt 1.0

In Terragrunt 1.0, orchestration of multiple units was consolidated under the `run --all` command, replacing the older `run-all`. The command preserves Terragrunt's fundamental guarantee: execution strictly respects the topological order of the dependency DAG.

The canonical invocation in an automation environment assumes the following form:

```bash
# Executes the command on all units, in dependency order,
# without interactive prompts and with controlled parallelism.
terragrunt run --all apply \
  --non-interactive \
  --parallelism 10
```

The parameters relevant to the CI/CD context are:

- **`--non-interactive`:** suppresses any confirmation requests. It is mandatory in non-interactive runners, at the risk of the job hanging indefinitely.
- **`--parallelism`:** defines the degree of concurrency between independent units. Higher values accelerate execution, but increase pressure on the cloud provider API.

The command, by itself, resolves the execution order. What it does not resolve, in its basic form, is the scope. For that, we turn to the filtering layer.

## Delta Filtering: `--filter` and `--filter-affected`

The filter system is probably the most underutilized feature of Terragrunt. It restricts the execution queue to a specific subset of units, and it is the mechanism that enables the real scalability of the pipeline.

Two modes of operation account for the vast majority of use cases:

```bash
# 1. Executes only the units changed relative to the default branch.
#    Ideal for Pull Request validation.
terragrunt run --all plan --filter-affected

# 2. Restricts execution to a specific path via glob.
#    Ideal for isolating an entire environment.
terragrunt run --all apply --filter './live/prod/**'
```

The `--filter-affected` flag computes the set of modified units by comparing the current state against the repository's default branch. For this reason, the pipeline checkout must retrieve the complete Git history, not just the latest commit. Without this, the delta calculation is imprecise.

In production repositories, the adoption of this filtering is what differentiates a pipeline that runs in four minutes from one that runs in forty.

## Execution Telemetry: Structured Reports

A mature pipeline not only executes but reports. Terragrunt offers the generation of structured execution reports, replacing the fragile practice of parsing log lines with regular expressions.

```bash
# Generates a structured report of the execution in JSON format.
terragrunt run --all plan \
  --filter-affected \
  --non-interactive \
  --report-file run-report.json \
  --report-format json
```

The resulting artifact (`run-report.json`) is a deterministic document describing, per unit, the result of the operation. From it, the pipeline can:

- Build a consolidated summary of the deploy for publishing to the Pull Request.
- Trigger segmented notifications (for example, alert only the teams whose units failed).
- Feed platform observability dashboards with execution data.

Telemetry transforms the pipeline from a black box into an auditable system. This is the foundation upon which operational governance is built.

## The Validation Pipeline in GitHub Actions

The composition of these elements results in a two-stage pipeline: validation on Pull Request and application on merge. The following example uses Gruntwork's official action, with tool versions pinned declaratively via `mise.toml`.

```toml
# mise.toml
# Pins tool versions, ensuring parity between the engineer's local
# environment and the CI runner.
[tools]
terragrunt = "1.0.0"
opentofu   = "1.10.1"
```

```yaml
# .github/workflows/terragrunt-ci.yml
name: Terragrunt CI

on:
  pull_request:
    branches: [main]

jobs:
  plan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0   # complete history, necessary for delta calculation

      - name: Install Terragrunt and OpenTofu
        uses: gruntwork-io/terragrunt-action@v3

      - name: Plan affected units
        run: |
          terragrunt run --all plan \
            --filter-affected \
            --non-interactive \
            --report-file plan-report.json \
            --report-format json

      - name: Publish report to Pull Request
        run: ./scripts/comment-report.sh plan-report.json
```

Application, restricted to the main branch, follows the same delta principle:

```yaml
  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gruntwork-io/terragrunt-action@v3

      - name: Apply affected units
        run: |
          terragrunt run --all apply \
            --filter-affected \
            --non-interactive
```

The architectural point to retain is that the pipeline never operates on the complete graph. It operates on the real intent of each commit.

## Continuous Drift Detection as a Scheduled Job

The pipeline described validates and applies intentional changes. It does not capture, however, the changes made outside the IaC flow: manual console interventions, emergency tweaks during incidents, or legacy scripts operating *out-of-band*. That is the territory of Configuration Drift.

Drift detection should not depend on the occasional execution of a `plan` before a deploy. It should be an autonomous and scheduled job, dedicated exclusively to state reconciliation.

The technical core of this automation lies in the `-detailed-exitcode` parameter, passed to OpenTofu/Terraform. Its output behavior is the signal we interpret:

1. **Exit Code 0:** Full compliance. The actual state corresponds to the declared code.
2. **Exit Code 1:** Execution error (syntax failure or invalid credentials).
3. **Exit Code 2:** There are pending changes. In a scheduled job, with no new code, this is the unequivocal signal of Drift.

```yaml
# .github/workflows/drift-detection.yml
name: Drift Detection

on:
  schedule:
    - cron: "0 6 * * *"   # daily reconciliation at 06:00 UTC

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: gruntwork-io/terragrunt-action@v3

      - name: State reconciliation
        run: |
          terragrunt run --all plan \
            --non-interactive \
            -- -detailed-exitcode
```

When the job returns code 2, the pipeline should trigger an alert directed to the responsible team, ideally enriched with the structured execution report. In-depth treatment of remediation and prevention strategies is detailed in [The Drift Nightmare: How to Detect and Fix Manual Changes in Infrastructure](https://leonam.io/posts/the-drift-nightmare-how-to-detect-and-fix-manual-infrastructure-changes/).

## The Impact on Platform Engineering

The combination of delta filtering, structured telemetry, and continuous Drift detection transcends pipeline optimization. It redefines the organization's relationship with its infrastructure.

By restricting each execution to the real scope of change, the platform reduces the blast radius and, with it, the probability of incidents from broad, unintentional applications. By producing deterministic reports, it converts the operation into an auditable and measurable process. By reconciling the state autonomously, it ensures that the fundamental premise of IaC, code as the single source of truth, remains valid over time.

This is the maturity that distinguishes a team that merely uses Terragrunt from a team that operates it as an infrastructure governance system.

## Conclusion

Terragrunt's scalability in CI/CD does not emerge from the `run --all` command in isolation, but from the discipline of restricting it. Delta filtering, structured telemetry, and continuous Drift detection form, together, the backbone of a pipeline that scales linearly, not exponentially, with infrastructure growth.
