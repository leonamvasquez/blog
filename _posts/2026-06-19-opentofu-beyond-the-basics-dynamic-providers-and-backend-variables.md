---
title: "OpenTofu Beyond the Basics: Dynamic Providers and Backend Variables"
description: "How early variable evaluation and for_each in provider blocks work in OpenTofu: syntax, limits, the multi-region case without duplication, and what it changes in the relationship with Terragrunt."
date: 2026-06-19 19:00:00 +0000
lang: en
permalink: /en/posts/opentofu-beyond-the-basics-dynamic-providers-and-backend-variables/
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, Terraform, Providers, Backend, IaC, DevOps]
icons: [opentofu]
---

## Introduction

Two limitations followed Terraform through almost its entire existence, and anyone who's operated infrastructure at scale has run into both.

The first shows up when you try to use a variable in the backend configuration and get an error saying that value needs to be literal. The second shows up when you need to provision the same infrastructure across eight regions and end up copying the same `provider` block eight times, changing one line in each.

These two restrictions explain a good chunk of why orchestration tools exist around Terraform in the first place. OpenTofu removed both, and this article shows how.

## Why the Restriction Existed

Worth understanding the cause, since it explains the limits that remain.

`init` runs before any configuration evaluation. That's the moment the tool needs to know where state lives and where to download modules from, and at that point it hasn't processed any expression, variable, or dependency yet.

The traditional workaround was requiring literal values at those points. Anyone who needed flexibility fell back on partial backend files, scripts that generated configuration, or an external orchestration layer.

OpenTofu solved this with what it calls **early evaluation**: a step that processes variables and locals before everything else, as long as they don't depend on anything that only exists later.

## Variables in the Backend and in Modules

Starting with version 1.8, variables and locals work in backend configuration, module source, and encryption configuration.

The most useful case is a backend parameterized by environment:

```hcl
variable "project" {
  type    = string
  default = "myapp"
}

variable "environment" {
  type = string
}

variable "region" {
  type    = string
  default = "us-east-1"
}

locals {
  state_bucket = "${var.project}-state-${var.region}"
  state_key    = "${var.environment}/${var.project}/terraform.tfstate"
}

terraform {
  backend "s3" {
    bucket  = local.state_bucket
    key     = local.state_key
    region  = var.region
    encrypt = true
  }
}
```

The same applies to a module's source, which lets you pin the version through a variable:

```hcl
variable "vpc_version" {
  type    = string
  default = "5.4.0"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = var.vpc_version

  name = "production"
  cidr = "10.0.0.0/16"
}
```

One practical pattern this opens up is toggling between a local module and a registry module during development:

```hcl
locals {
  vpc_source = var.use_local_module ? "./modules/vpc" : "terraform-aws-modules/vpc/aws"
}
```

For this to work, `init` now consumes the variables file and accepts the matching command-line flags:

```bash
tofu init -var="environment=production"
tofu init -var-file=production.tfvars
```

### The limit that remains

Early evaluation isn't magic. It only resolves what can be known before any execution.

Variables and locals work. References to resources, data sources, or module outputs don't. If the value depends on something the tool only discovers during the plan, it stays unavailable at that point.

In practice, that's a reasonable restriction. The state bucket name rarely depends on an already-provisioned resource.

## Dynamic Providers with for_each

The second limitation fell in version 1.9, with the ability to iterate `provider` blocks.

The classic scenario is multi-region. Before, you'd declare one block per region. Now, you declare just one:

```hcl
variable "regions" {
  type = map(object({
    cidr = string
  }))

  default = {
    us-east-1 = { cidr = "10.0.0.0/16" }
    eu-west-1 = { cidr = "10.1.0.0/16" }
    sa-east-1 = { cidr = "10.2.0.0/16" }
  }
}

provider "aws" {
  alias    = "by_region"
  for_each = var.regions

  region = each.key
}
```

To use these instances, the module receives the matching instance through the providers map:

```hcl
module "regional_vpc" {
  source = "./modules/vpc"

  for_each = { for region, config in var.regions : region => config }

  providers = {
    aws = aws.by_region[each.key]
  }

  name = "vpc-${each.key}"
  cidr = each.value.cidr
}
```

Adding a region becomes just adding an entry to the map. The code doesn't grow.

### Three restrictions worth knowing

The first: the `provider` block needs a static `alias`. It identifies the configuration, which is why the reference in the module is fixed, with the instance chosen dynamically through brackets.

The second: the provider's `for_each` expression has to be resolvable at the early evaluation step. Variables and locals work, data sources and resources don't.

The third is the subtlest, and the one that usually causes errors. **The `for_each` expression of the module or resource has to differ from the one used in the provider**, even if both produce the identical map. That's why, in the example above, the module uses a comprehension over the variable instead of just repeating `var.regions`.

The reason is destroy ordering. The tool needs to guarantee that provider instances outlive the resources that depend on them during a `destroy`. Distinct expressions make it possible to establish that order.

## What This Changes in the Relationship with Terragrunt

An honest observation is due here, because these two features hit exactly some of the historical reasons for adopting an orchestration layer.

An environment-parameterized backend and a module source versioned by variable were, for years, direct arguments in favor of Terragrunt. Today OpenTofu itself resolves both cases.

That doesn't make orchestration unnecessary. Terragrunt still delivers what the base tool doesn't: per-unit state isolation, a dependency graph between components, batch execution across dozens of units, and filtering by what actually changed.

What changed is the boundary. Small and medium projects that adopted Terragrunt just to parameterize the backend can today solve that in the tool itself. Projects with many interdependent units keep benefiting from the orchestration layer.

Reassessing that boundary periodically is healthier than assuming a decision made two years ago is still valid.

## Things to Watch

Three points worth a deliberate look before jumping in.

**Backend variables affect whoever runs the tool.** If the bucket name depends on a variable, whoever runs the tool needs to supply it at `init` too. Document that, or the next person on the team will lose time figuring it out.

**Sensitive values are blocked in module sources.** Starting with 1.9, the tool prevents values marked sensitive from appearing in module paths, since they'd be visible during initialization.

**Flexibility comes with a clarity cost.** A module source defined by a conditional expression is powerful, and also harder to trace. Use it when it solves a real problem, not just because it's now possible.

## Conclusion

These two features have something in common: they hand back to the base tool things the community used to solve from the outside, with scripts, partial files, and extra layers.

Worth noting this advantage isn't permanent. Terraform has been closing part of that gap in its recent releases, and that's expected to continue. The difference between the two projects is a moving picture, not a final state.

What stays constant is the criterion for evaluating either tool: less the list of features exclusive to each version, and more the question of which external layers you keep today only because the tool couldn't handle it. Every time one of those stops being necessary, there's less code left to maintain, and that's what actually counts at the end of a year of operations.
