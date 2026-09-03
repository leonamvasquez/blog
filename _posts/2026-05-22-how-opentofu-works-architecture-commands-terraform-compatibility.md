---
title: "How OpenTofu Works: Architecture, Commands, and Terraform Compatibility"
description: "Understand OpenTofu's internal architecture, the execution flow of tofu init, plan, and apply, and a precise map of what's identical, what needs attention, and what exists only in one of the two projects."
date: 2026-05-22 19:00:00 +0000
lang: en
permalink: /en/posts/how-opentofu-works-architecture-commands-terraform-compatibility/
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, Terraform, IaC, Providers, State, DevOps]
icons: [opentofu]
---

## Introduction

This article focuses on OpenTofu's internal workings: how the tool is organized under the hood, what happens on each command you run, and exactly how far compatibility with Terraform goes.

The plan is to start from how it works and only get to comparisons afterward. The idea is to understand how the tool operates, so you can decide based on that, and not on third-party opinions. The historical background of the project is covered in the earlier article in this series, [OpenTofu: What the Terraform Fork Means for Your Infrastructure](https://leonam.io/en/posts/opentofu-what-the-terraform-fork-means-for-your-infrastructure/).

## What OpenTofu Is

OpenTofu is an Infrastructure as Code tool. You describe how you want your infrastructure to look at the end of the process in configuration files, and the tool takes care of getting the real environment there. The project is maintained by the Linux Foundation, under the MPL 2.0 open-source license.

The model is declarative. You don't write the steps to create a server; you just declare that it should exist, with certain characteristics. Figuring out what needs to happen for reality to match that description is the tool's job.

Three elements underpin this:

- **The language.** HCL, where you declare what should exist.
- **State.** A record of what the tool has already provisioned and already knows about.
- **The engine.** Compares configuration with state, calculates the difference, and applies it in the right order.
Anyone who already works with Terraform recognizes this description instantly, and the reason is simple: OpenTofu came directly from Terraform's own codebase in 2023 and kept its technical foundations. Knowing where that inheritance starts and where it stops is what lets you operate the tool safely.

## The Architecture: Core and Providers

OpenTofu fully inherited Terraform's architecture model, which explains most of the compatibility you see in practice. The system splits into two layers, each with its own responsibility.

The **Core** is the main binary, written in Go. It knows nothing about specific clouds. It's responsible for:

- Interpreting the configuration written in HCL.
- Building the dependency graph between declared resources.
- Comparing the desired state with the recorded state and calculating the execution plan.
- Managing the state file and the backend where it's stored.
**Providers** are the plugins that know each specific API: AWS, Azure, Google Cloud, Kubernetes. They run as separate processes and talk to the Core through a gRPC-based protocol.

This separation is why the same provider binary serves both projects. The provider doesn't know whether it's talking to Terraform or OpenTofu, because the contract between the layers hasn't changed. If you want to dig deeper into this mechanism, it's covered in detail in [Extending Terraform: How a Provider Works, and When to Create Your Own](https://leonam.io/en/posts/extending-terraform-how-a-provider-works-when-to-create-your-own/).

## The Execution Flow

The three core commands follow exactly the same sequence of operations as Terraform. It's worth walking through it closely, since that's where the few points of divergence show up.

```bash
tofu init
tofu plan
tofu apply
```

**On initialization**, OpenTofu reads the `required_providers` block, resolves compatible versions, downloads the provider binaries, and writes the choices to the lock file. It also configures the remote backend and prepares the local working directory.

**On planning**, the Core loads the current state, asks the providers about the real situation of each resource, compares it against what the configuration declares, and builds the plan. Nothing gets executed at this stage.

**On apply**, the plan is walked through in the order set by the dependency graph, and state is updated at the end of each successful operation.

The mental model is the same as Terraform's. Anyone already running IaC doesn't need to learn anything new to get started.

## Compatibility: What's Identical

This is the core of the practical question. These elements work with zero changes:

1. **The HCL language.** Blocks, expressions, functions, and meta-arguments are the same. The configuration block is even still called `terraform`, which preserves compatibility with existing code.
2. **The file structure.** The working directory is still `.terraform`, local state is still in `terraform.tfstate`, and the lock file is still `.terraform.lock.hcl`.
3. **The state format.** State generated by Terraform can be read by OpenTofu, and the reverse holds too in default configurations.
4. **Remote backends.** S3, Azure Blob, GCS, and the rest work with the same configuration as always.
5. **Modules.** Modules published for Terraform work with no adaptation, including ones from the public registry.
6. **Providers.** The same binaries work for both projects.
In practice, a configuration written three years ago runs on OpenTofu without touching a single line. That compatibility isn't a marketing promise: it's a direct consequence of the project having been born from Terraform's own code.

## Compatibility: What Needs Attention

### The provider registry

OpenTofu maintains its own registry, and that's where providers are downloaded from by default. The provider itself stays the same; what changes is the source address.

That detail shows up in the lock file, which starts recording the new source:

```hcl
# .terraform.lock.hcl after tofu init
provider "registry.opentofu.org/hashicorp/aws" {
  version     = "5.40.0"
  constraints = "~> 5.0"
  hashes      = [
    "h1:...",
    "zh:...",
  ]
}
```

Since the recorded hashes refer to the package that was actually fetched, a lock file generated by Terraform can fail verification when used with OpenTofu. The fix is straightforward: regenerate the lock with `tofu init` and commit the result.

In pipelines running on platforms different from your workstation, it's worth generating hashes for all targets at once:

```bash
tofu providers lock \
  -platform=linux_amd64 \
  -platform=darwin_arm64
```

### The version marker in state

On the first `apply` run with OpenTofu, the field recording the tool's version in the state file gets updated. That's the only record a default configuration changes, and it doesn't block either tool from reading the state.

Still, treat it as a real change: back up state before any migration, the same way you would before any operation that modifies it.

### Protocol versions and recent features

Very recent providers can adopt protocol features that showed up first in one of the two tools. Configurations using language features released only in newer Terraform versions also need individual checking.

The practical rule is simple: the newer and more specific the feature you use, the greater the need to validate before migrating.

## What Only Exists in OpenTofu

Since 2024, the project has been shipping features with no equivalent in open-source Terraform. A summary of the main ones:

- **Native state encryption**, which removes the need for external tooling to protect sensitive data at rest.
- **Early variable evaluation**, which lets you parameterize backend configuration and module sources.
- **Provider iteration** with `for_each`, useful in multi-region and multi-account scenarios.
- **Distribution via OCI registries**, using the same standard used for container images.
- **Ephemeral values**, which never get persisted to the state file.
One coexistence detail worth noting: OpenTofu recognizes files with the `.tofu` extension, which take precedence over the equivalent `.tf` file. This lets you keep a shared configuration for both tools while isolating code that uses exclusive features in separate files.

Each of these features deserves its own treatment and will be the subject of specific articles later in this series.

## Verifying Compatibility in Practice

The right way to assess compatibility isn't reading a table, it's measuring against your own code. The procedure is short:

```bash
# 1. Preserve the current state before anything else
terraform state pull > state-backup.json

# 2. Record the plan generated by the current tool
terraform plan -no-color > terraform-plan.txt

# 3. Initialize with OpenTofu and generate the equivalent plan
tofu init
tofu plan -no-color > tofu-plan.txt

# 4. Compare the two plans
diff terraform-plan.txt tofu-plan.txt
```

What you should expect is no meaningful difference in resources created, changed, or destroyed. Output formatting differences are normal. Resources flagged for recreation are not.

This test takes a few minutes and replaces any assumption with evidence about your own codebase.

## Conclusion

OpenTofu works like Terraform because it came from Terraform and kept the boundaries that matter: the language, the state format, and the contract with providers. The divergences exist, are few and well known, and concentrate around the registry, the lock file, and the features built after the fork.

It's worth noting a practical implication of this: since Core and providers follow a stable contract, the binary that executes the plan became a swappable component of your platform. Teams that already maintain that separation can evaluate both tools side by side, with low reversal cost.
