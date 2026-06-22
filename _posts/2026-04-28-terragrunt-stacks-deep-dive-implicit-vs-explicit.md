---
title: "Terragrunt Stacks Deep Dive: Implicit vs. Explicit (and When to Use Each)"
description: "A technical deep dive into Terragrunt Stacks architecture: the distinction between implicit and explicit stacks, the anatomy of terragrunt.stack.hcl, value injection, composition via nested stacks, and the on-demand generation model."
date: 2026-04-28 19:00:00 +0000
lang: en
permalink: /en/posts/terragrunt-stacks-deep-dive-implicit-vs-explicit/
categories: [Terraform, Platform Engineering, IaC]
tags: [Terragrunt, Terragrunt Stacks, IaC, DRY, Platform Engineering]
icons: [terraform, terragrunt]
---

## Introduction

There is a recurring misconception that **Terragrunt Stacks** constitute merely a conceptual renaming of the already-established practice of grouping multiple units in a directory tree. This is an oversimplification that ignores the most significant architectural change introduced in Terragrunt 1.0.

The confusion is understandable because the term "stack" describes two distinct realities within the tool. One is implicit, derived from the filesystem structure. The other is explicit, declared, and generated on demand. The difference between them is not semantic but operational: it defines whether your infrastructure is versionable as an artifact or remains hostage to folder layout.

This article dissects the anatomy of Terragrunt Stacks, contrasts the implicit model with the explicit, details the value injection flow via `terragrunt.stack.hcl`, and establishes the decision criterion for adopting each approach.

## The Fundamental Dichotomy: Implicit vs. Explicit

Before any code, we must establish the distinction that structures the rest of this article. A **stack**, in Terragrunt, is a collection of units treated as a single logical orchestration unit. This collection can be defined in two ways.

1. **Implicit stack.** Any parent directory containing units in its subdirectories. It is the legacy and default behavior. Here, the folder structure *is* the source of truth. When executing `terragrunt run --all` at the root, Terragrunt traverses this tree and treats it as a stack.
2. **Explicit stack.** A collection declared in a `terragrunt.stack.hcl` file, describing which units to instantiate, from which source to fetch them, and which values to inject. Units do not reside in the repository; they are generated on demand.

The implicit stack is transparent but rigid. Moving a directory breaks `include` and `dependency` references, and the collection of infrastructure cannot be versioned atomically. The explicit stack inverts this logic: the definition of the collection becomes versioned code, and the directory tree becomes a generated and disposable artifact.

## The Anatomy of `terragrunt.stack.hcl`

The `terragrunt.stack.hcl` file is the heart of the explicit model. It is fundamentally composed of `unit` blocks and, optionally, `stack` blocks (which we will cover in the composition section).

Each `unit` block declares an infrastructure instance to be materialized:

```hcl
# live/prod/terragrunt.stack.hcl

unit "vpc" {
  source = "git::git@github.com:your-org/catalog.git//units/vpc?ref=v2.3.0"
  path   = "vpc"

  values = {
    cidr_block = "10.0.0.0/16"
    azs        = ["us-east-1a", "us-east-1b"]
  }
}

unit "database" {
  source = "git::git@github.com:your-org/catalog.git//units/database?ref=v2.3.0"
  path   = "database"

  values = {
    engine_version = "16.3"
    multi_az       = true
  }
}
```

Three attributes define each unit:

- **`source`:** the origin of the unit. The use of a versioned reference (`?ref=v2.3.0`) is what gives the collection the ability to be updated explicitly and reversibly.
- **`path`:** the relative path where the unit will be generated within the `.terragrunt-stack` directory.
- **`values`:** the map of values injected into the unit at generation time.

The absence of any `terragrunt.hcl` in the production directory is intentional. What exists is the description of the collection; the collection itself is generated.

## The Value Flow: `values` and `terragrunt.values.hcl`

The `values` attribute is the mechanism that solves the duplication problem. It allows instantiating the same `source` with distinct parameters per environment, without replicating files.

During generation, Terragrunt materializes the content of the `values` block into a `terragrunt.values.hcl` file, deposited in the unit's directory. The unit definition, in turn, consumes this data through the `values` object:

```hcl
# catalog/units/database/terragrunt.hcl

terraform {
  source = "git::git@github.com:your-org/modules.git//rds?ref=v4.1.0"
}

inputs = {
  engine_version = values.engine_version
  multi_az       = values.multi_az
}
```

The contract is clear and explicit. The unit in the catalog declares a values interface it expects to receive, and the `terragrunt.stack.hcl` of each environment populates that interface. You define the unit once and reuse it in `dev`, `staging`, and `prod`, varying only the content of the `values` block.

This separation between the unit definition and its parameterization is what makes the model truly **DRY** (Don't Repeat Yourself: the principle of not repeating the same definition in multiple places).

## Composition at Scale: Nested Stacks and Catalogs

The explicit model is not limited to units. A `terragrunt.stack.hcl` can reference other stacks via the `stack` block, enabling hierarchical composition.

```hcl
# live/prod/terragrunt.stack.hcl

stack "networking" {
  source = "git::git@github.com:your-org/catalog.git//stacks/networking?ref=v2.3.0"
  path   = "networking"

  values = {
    environment = "prod"
  }
}
```

This mechanism enables the concept of **infrastructure catalog**: a versioned repository exposing reusable stacks (a complete network mesh, a data platform, a Kubernetes environment), consumed by different teams and environments.

The strategic advantage is governance. An update to the catalog's network stack, promoted to version `v2.4.0`, propagates to all environments in a controlled manner, with simply a reference change. The collection of infrastructure gains its own release cycle, comparable to any other software artifact.

## On-Demand Generation: The Lifecycle of `.terragrunt-stack`

With the collection defined, it must be materialized. Terragrunt exposes a set of subcommands dedicated to the lifecycle of the explicit stack:

```bash
# Materializes all units and stacks in the .terragrunt-stack directory
terragrunt stack generate

# Executes a command on the generated stack, in dependency order
terragrunt stack run plan

# Consolidates outputs from all units belonging to the stack
terragrunt stack output
```

The resulting `.terragrunt-stack` directory is a product of generation, not a source of truth. In a mature flow where the CI/CD pipeline runs `terragrunt stack generate` on its own, this directory should be excluded from version control:

```gitignore
# .gitignore
.terragrunt-stack/
```

You inspect the generated content locally before any application, ensuring that materialization produces exactly the expected units. The deterministic nature of this generation is what makes the model reliable.

## The Decision: When to Adopt Each Model

The choice between implicit and explicit is not a matter of aesthetic preference but of scale and governance. The following criterion guides the decision:

1. **Remain with implicit stacks when** the number of units is small, each unit is genuinely unique, and full transparency of the directory tree is more valuable than reducing duplication.
2. **Adopt explicit stacks when** multiple environments share the same patterns, when duplication of `terragrunt.hcl` files has become a maintenance cost, or when infrastructure needs to be versioned and distributed as a catalog.

Migration between the two models is incremental. Loose units and explicit stacks coexist in the same repository, allowing gradual adoption, environment by environment.

## The Impact on Platform Engineering

The introduction of explicit stacks represents more than a file organization optimization. It alters the paradigm of infrastructure ownership and distribution.

By converting collections of units into versioned artifacts, Platform Engineering gains the ability to treat infrastructure as an internal product. Application teams consume stacks from a curated catalog without needing to understand the implementation details of each module. The platform team, in turn, evolves these stacks centrally, with semantic versioning and controlled release cycles.

This is the transition from a file-convention-based operation to one based on versioned contracts. It is the difference between maintaining infrastructure and distributing it as a capability.

## Conclusion

Terragrunt Stacks are not a renaming. The implicit model reflects the file structure; the explicit model replaces it with a versioned, parameterizable, and composable declaration. The first approach is suitable for small, idiosyncratic repositories; the second is the path to scale, reusability, and governance.

Next step: identify in your repository a unit pattern that repeats across three or more environments. Extract it to a versioned catalog, describe it in a `terragrunt.stack.hcl`, and run `terragrunt stack generate`. The comparison of file counts before and after is the metric that justifies adopting the explicit model.
