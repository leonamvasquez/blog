---
title: "Terragrunt as a Runtime Manager: Pinning Terraform Versions"
description: "How to use Terragrunt to control which Terraform version runs your infrastructure: version constraints, generating the required_version block, CI pinning, and gradual rollout across units."
date: 2026-07-10 19:00:00 +0000
lang: en
permalink: /en/posts/terragrunt-as-a-runtime-manager-pinning-opentofu-and-terraform-versions/
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Terraform, CI/CD, Versioning, IaC]
icons: [terragrunt, terraform, opentofu]
---

## Introduction

Two runs of the same configuration can produce different plans without a single line of code changing. All it takes is a difference in the Terraform version used to generate each plan.

The scenario repeats itself in a familiar shape across teams that operate infrastructure: a configuration starts using a newly released language feature, gets tested locally with success, and moves on to review. The merge kicks off the pipeline, and the pipeline fails, because the CI runner is on an older Terraform version that doesn't recognize the syntax being used.

The root cause is always the same: nothing guaranteed that the local machine and the CI runner were running the same version. In repositories that use Terragrunt, that guarantee can and should be declared in the code itself.

## What the Runtime Needs to Guarantee

Worth organizing the problem before solving it, since it has two distinct questions that tend to get treated as one:

1. **Which Terraform version is acceptable?** A defined range, not whatever happens to be installed on each machine.
2. **Who installs and pins that version?** The local machine and the CI runner need to agree, without relying on memory or an outdated README.

Terragrunt offers a declarative answer to the first question. The second depends on your CI pipeline, but gains a safety net once the first one is already configured.

## Constraining the Terraform Version

Terragrunt lets you declare the accepted range directly at the root of the configuration:

```hcl
# root.hcl
terragrunt_version_constraint = ">= 1.0.0, < 2.0.0"
terraform_version_constraint  = ">= 1.11.0, < 2.0.0"
```

When someone runs outside that range, the command fails before any operation, with a message pointing at both the installed and the required version. That's a cheap failure, upfront, instead of divergent behavior discovered only after a failed `apply`.

To confirm which version is actually in use, without guessing:

```bash
terragrunt info print
```

The corresponding field in the output shows the Terraform version that will be called. That command resolves most environment questions in a few seconds.

## The Constraint Terraform Itself Sees

There's still a second check, done by Terraform itself through the `required_version` block. Since it lives inside the infrastructure code, it tends to end up duplicated across dozens of modules.

Terragrunt's generate block solves that from the root:

```hcl
# root.hcl
generate "versions" {
  path      = "versions.tf"
  if_exists = "overwrite"

  contents = <<EOF
terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.30"
    }
  }
}
EOF
}
```

With this, the accepted range gets defined in a single place and propagated to every unit. Changing the version policy becomes a one-line change, instead of a find-and-replace across dozens of files.

## Installing and Pinning in CI

The previous layers validate. This one installs.

The official action lets you pin the Terraform version directly in the workflow:

```yaml
- name: Install Terragrunt and Terraform
  uses: gruntwork-io/terragrunt-action@v3
  with:
    tg_version: "1.0.2"
    tf_version: "1.11.6"
```

There's also the option of declaring the tool in a dedicated version-management file, committed alongside the repository. When it's present, the action uses it as the source of the version, which makes the local machine and the runner read the exact same declaration, instead of duplicating the number in two different places.

That's the configuration that cuts down environment drift the most, since it removes the duplication between what's in the workflow and what's on the workstation.

## Gradual Version Rollout

There's a less obvious use for these configurations, and it's the most valuable one in large repositories.

Since version constraints can be overridden in a specific unit, independent of what the root defines, you can test a new Terraform version on one low-risk unit before rolling the change out to the rest of the repository. If something breaks, rolling back is removing one line, and no other unit was affected.

This is the point that tends to go unnoticed: keeping orchestration separate from execution isn't an aesthetic preference, it's what makes testing a version upgrade an incremental, reversible operation, instead of betting everything at once.

## Things to Watch

One point deserves attention when adopting these constraints: they validate the declared version, not the content of the plan. Two versions within the same range can still behave differently around newly released features or documented behavior changes in the changelog. Version constraints drastically reduce the surface for drift, but they don't replace reading the changelog before moving the upper bound of the accepted range.

## Conclusion

Version constraints look like bureaucracy right up until the day a different plan gets applied because of a different version. After that, they start looking like the bare minimum.

What these configurations do, combined, is turn the runtime into part of the versioned configuration. The question of what's installed on whoever's machine ran the command stops existing, because the answer lives in the repository, subject to review like any other architectural decision.

This change has a side effect that might be the most important part: it turns a version upgrade into a reversible technical operation, not a leap of faith. Once Terragrunt can declare which range to accept and where to install it from, bumping a version stops being an irreversible infrastructure decision and becomes a configuration line you can test on one unit and undo the next day.
