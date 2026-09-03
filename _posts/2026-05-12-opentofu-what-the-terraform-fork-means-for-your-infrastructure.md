---
title: "OpenTofu: What the Terraform Fork Means for Your Infrastructure"
description: "Understand why OpenTofu exists, what drove Terraform's 2023 license change, what remains compatible between the two projects, and which technical criteria should guide your decision."
date: 2026-05-12 19:00:00 +0000
lang: en
permalink: /en/posts/opentofu-what-the-terraform-fork-means-for-your-infrastructure/
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, Terraform, IaC, Open Source, Licensing, DevOps]
icons: [opentofu]
---

## Introduction

A common misreading treats OpenTofu as an ideological reaction to Terraform, a volunteer project with no real weight for anyone running infrastructure in production. That reading is understandable, since the project's origin really is a licensing dispute. The problem is that it stops there and ignores everything that came after.

Nearly three years after the fork, OpenTofu sits under the Linux Foundation, joined the CNCF, and now ships features Terraform simply doesn't have. It's no longer a defensive copy; the project follows its own path.

This piece revisits what triggered the split, clarifies what still stays compatible between the two tools, points out where they've already diverged, and lays out practical criteria for deciding what fits your context. Nothing here is an obvious answer: the goal isn't to convince anyone, just to inform the decision.

## What Changed in August 2023

For nearly a decade, Terraform shipped under the **MPL 2.0** (Mozilla Public License), a permissive open-source license. Anyone, individual or company, could use, modify, and redistribute it, including building commercial products on top.

On August 10, 2023, HashiCorp switched that license to the **BUSL 1.1** (Business Source License), a change that hit Terraform and other company products alike. It's worth understanding what that means in practice.

BUSL isn't open source in the strict sense. The code stays visible and internal use remains free, but there's a core restriction: you can't offer a product or service that competes with HashiCorp's own commercial offerings.

Two consequences follow from that:

1. **Almost nothing changes for the typical end user.** A company using Terraform only to provision its own infrastructure stays compliant, no issue.
2. **For vendors, everything changes.** Platforms built on top of Terraform suddenly found themselves in legally gray territory, at the mercy of how "competition" gets interpreted.
That second group was the one that moved first, for an obvious reason: their business model lost legal footing overnight.

## From Reaction to Project: The Timeline

The community's response was fast and organized. It's worth tracing the sequence, because it explains why this fork gained traction where so many others stall.

- **August 2023.** A public manifesto calls for reverting the license. With no response from HashiCorp, the group moves forward with the fork (initially named OpenTF), branching from the last Terraform release still under MPL 2.0, the 1.5 line.
- **September 2023.** The Linux Foundation takes in the project, renamed OpenTofu. This is the turning point: governance shifts from a group of interested companies to a neutral foundation.
- **January 2024.** Version 1.6.0 ships, the first stable, production-ready release.
- **February 2025.** IBM completes its acquisition of HashiCorp for $6.4 billion. Terraform becomes part of the portfolio of a considerably larger company.
- **April 2025.** OpenTofu is accepted into the CNCF at Sandbox level, with a formal exception that let it keep the MPL 2.0 license.
A detail that often gets overlooked in these discussions: governance structure matters. A fork run by a consortium of vendors tends to reflect those vendors' interests. A project under a neutral foundation, by contrast, has public contribution rules, an independent trademark, and a roadmap no single company controls alone.

## What "Fork" Actually Means Technically

This is where most of the confusion lives, and the answer is far less dramatic than the project's origin story suggests.

OpenTofu kept Terraform's technical foundations fully intact:

- **The language.** HCL is the same. Modules, expressions, and blocks work without any changes.
- **The state format.** State files are compatible in both directions. In practice, you can point both tools at the same backend during a migration.
- **The provider protocol.** The same provider binaries work with both engines. OpenTofu's ecosystem counted more than 3,900 providers and 23,600 modules by mid-2026.
- **The command-line interface.** Commands are equivalent, what changes is just the binary you call: `tofu` instead of `terraform`.
In practice, migrating a simple project comes down to swapping the binary:

```bash
# Before
terraform init
terraform plan
terraform apply

# After
tofu init
tofu plan
tofu apply
```

One detail worth flagging about state: on the first `apply` run with OpenTofu, the version marker written into the state file gets updated. That's the only record a default configuration changes, and it doesn't stop the state from staying readable by either tool.

That said, the swap isn't free of validation work. Configurations relying on features exclusive to recent Terraform releases need a case-by-case check, and the usual care around plan and review still applies.

## Where the Projects Have Already Diverged

If compatibility were the whole story, the choice between them wouldn't matter much. It isn't the whole story: since 2024, OpenTofu has been shipping features with no equivalent in open-source Terraform.

The ones that matter most for operations:

1. **Native state encryption.** Landed in version 1.7, it lets you encrypt the state file without external tooling. Since state tends to hold sensitive data, this is the most significant difference from a security standpoint.
2. **Early variable evaluation.** Starting with 1.8, it became possible to use variables in backend configuration and module sources, a long-standing Terraform limitation that pushed a lot of teams toward orchestration tooling in the first place.
3. **Provider iteration.** 1.9 brought `for_each` to provider blocks, which simplifies multi-region and multi-account scenarios considerably.
4. **OCI registries.** 1.10 opened up distributing modules and providers through the same standard used for container images, relevant for network-isolated environments.
5. **Ephemeral values.** 1.11 introduced values that never get persisted to state, addressing the classic problem of secrets sitting on disk.
The 1.12 line, released in May 2026, followed the same pattern, with operational improvements like dynamic protection against resource destruction.

The reverse also happens. HashiCorp keeps building its own features, some tied to its commercial platform, that OpenTofu has explicitly chosen not to replicate. The two projects aren't converging, and assuming they'll one day become identical again is a planning mistake.

## What This Means for Your Infrastructure

Translating all of this into decision criteria, three scenarios cover most cases.

**You use Terraform internally and don't resell infrastructure.**
Legally, BUSL doesn't touch you, and you can stay put without issue. The question that's left is technical: does any OpenTofu-exclusive feature solve a problem you actually have today? State encryption and ephemeral values tend to be the arguments that carry the most weight.

**You build products or services on top of the tool.**
Here the analysis changes entirely. BUSL's restriction hits your business model directly, and it's no coincidence that the main managed IaC platforms have adopted OpenTofu as their default.

**You depend on HashiCorp-specific features.**
If your workflow is tied into the company's commercial platform, OpenTofu isn't a drop-in replacement. Migrating would also mean replacing those integrations, a much larger-scope project.

There's also a dimension beyond the technical: licensing predictability. A tool under a neutral foundation offers a guarantee a tool under corporate control can't: the terms of use won't change by anyone's unilateral decision. For infrastructure with a lifecycle measured in years, that's a legitimate factor to weigh.

## The Impact on Platform Engineering

Beyond the choice between two tools, this episode left an architectural lesson worth keeping.

Teams that had already separated the orchestration layer from the execution layer went through the change with little effort. Terragrunt users, for instance, only needed to point orchestration at a different binary, without rewriting their environment structure. Teams that had everything glued to a single vendor faced a real migration project.

The practical takeaway: decoupling the execution engine from the orchestration layer stopped being an aesthetic preference and became protection against vendor risk. If you haven't organized your infrastructure that way yet, the topic is covered in detail in [Managing Multiple Environments (Dev, Stage, Prod) with Terraform and Terragrunt](https://leonam.io/en/posts/managing-multiple-environments-terraform-terragrunt/).

## Conclusion

OpenTofu exists because a license change put the future of a tool underpinning thousands of organizations' infrastructure into question. It survived by finding neutral governance, and it solidified by moving past simply tracking Terraform to shipping features of its own.

Choosing between the two isn't ideological, it's contextual. It depends on your business model, on the features you actually rely on, and on how much weight licensing predictability carries in your planning.
