---
title: "Distributing OpenTofu Modules as OCI Artifacts"
description: "How to use OCI registries to distribute modules and providers in OpenTofu: the new oci:// source, the provider mirror, registry authentication, and when this approach pays off."
date: 2026-07-03 19:00:00 +0000
lang: en
permalink: /en/posts/distributing-opentofu-modules-as-oci-artifacts/
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, OCI, Modules, Registry, Supply Chain, IaC]
icons: [opentofu]
---

## Introduction

Ask any team where their infrastructure modules live, and the answer is almost always the same: in a Git repository, referenced by a tag.

It's such a common pattern that it rarely gets questioned. And it works, until you need to run the tool in an environment with no public internet access, or explain why the CI runner needs an SSH key with read access to a bunch of repositories.

OpenTofu 1.10 opened up another path, one that reuses infrastructure most organizations already maintain: the container registry.

## The Trouble with Git as a Registry

Worth naming the problem before the solution, since not every team feels these pains at the same intensity.

Using Git as a distribution mechanism brings some well-known friction:

- **Authentication.** Every runner needs credentials with read access to module repositories, which tends to turn into SSH keys scattered across pipelines.
- **Tags are mutable.** Nothing stops someone from moving a tag to a different commit. The version you tested might not be the version you applied.
- **Isolated environments.** On networks with no outbound internet, replicating Git repositories is extra work.
- **Provenance.** There's no standard signing and verification mechanism built into the flow.

None of this friction is a dealbreaker on its own. Together, though, it explains why larger organizations end up building their own distribution layers.

## What Changes with OCI

The acronym OCI comes from Open Container Initiative, the standard behind container images. The key point is that an OCI registry doesn't only store images: it stores generic artifacts, and an infrastructure module can be one of them.

The practical advantage is you already have this infrastructure. ECR, Harbor, GHCR, ACR, GCR, or any registry compatible with version 1.1.0 of the distribution protocol will do, with access control, replication, and auditing already configured.

There's an important asymmetry between the two use cases, and it tends to get misunderstood:

- **For modules**, the OCI registry is a **primary source**. You reference the module directly through it.
- **For providers**, the OCI registry is only a **mirror**. The declared source stays the traditional address, and installation gets redirected through configuration.

## Modules: the oci:// Source

On the module side, the change is a new kind of source address:

```hcl
module "vpc" {
  source = "oci://example.com/modules/vpc/aws"

  name = "production"
  cidr = "10.0.0.0/16"
}
```

The address identifies the registry domain, the repository name, and the desired version, which can be indicated by tag or by the manifest's digest.

Using the digest is what solves the mutability mentioned above. A tag can get repointed; a digest is the cryptographic hash of the content, and pointing at it means pointing at exactly that artifact, always.

For environments with strict reproducibility requirements, that's the difference that matters most compared to a Git-based flow.

## Providers: Mirror Only

On the provider side, the model is different. The configuration doesn't live in the infrastructure code, it lives in the tool's own configuration:

```hcl
# ~/.tofurc
provider_installation {
  oci_mirror {
    repository_template = "example.com/opentofu-providers/${namespace}/${type}"
    include             = ["registry.opentofu.org/*/*"]
  }
}
```

The resolution model works like this: the provider's source address gets broken into parts, and those parts fill in the template to form the repository address on the registry.

A provider declared as `hashicorp/tls` matches the full address in the official registry, which satisfies the rule above. It then gets installed from the corresponding repository on your registry, with `hashicorp` as the namespace and `tls` as the type.

To restrict the mirror to a specific set and keep the rest coming from the traditional source, combine it with a matching exclusion:

```hcl
provider_installation {
  oci_mirror {
    repository_template = "registry.example.com/providers/${namespace}/${type}"
    include             = ["registry.example.com/myorg/*"]
  }

  direct {
    exclude = ["registry.example.com/myorg/*"]
  }
}
```

The infrastructure code stays untouched. Anyone who clones the repository without this configuration keeps downloading providers from the default source, which preserves portability.

## Authentication

This is the point where the integration pays for itself. The tool reuses the credentials you already have for the registry.

There are two paths. The first is automatic credential discovery in the format used by container tooling, which usually means an already-authenticated session is enough. The second is explicit declaration in the tool's configuration, for cases where you want control over which credential applies to which registry.

In pipelines, this normally eliminates an entire step. The runner already authenticates to the registry for other purposes, and that same authentication serves module and provider installation.

## Publishing a Module

Publishing uses standard OCI ecosystem tooling, typically the command-line tool for generic artifacts:

```bash
# Package the module
zip -r vpc-module.zip ./modules/vpc

# Push it to the registry as an artifact
oras push example.com/modules/vpc/aws:v1.4.0 vpc-module.zip
```

The artifact needs to follow the format the tool expects, including the correct media type in the manifest. Check the documentation on module packages in OCI registries before setting up your publishing pipeline, since that detail decides whether the tool recognizes the artifact.

Once the pipeline is working, publishing a module becomes just another build step, equivalent to publishing an image.

## When This Pays Off

To be direct, this approach isn't for everyone.

**It makes sense when:**

- You operate in an internet-isolated environment and already replicate the container registry.
- The organization has provenance requirements and wants to sign and verify infrastructure artifacts the way it does images.
- There's a large volume of internal modules and access management through Git has become a problem.
- You want real version immutability, with digest-based references.

**It doesn't make sense when:**

- The team is small, the modules are few, and the Git flow works fine.
- There's no OCI registry already running, since introducing one just for this adds more complexity than it removes.

One methodological note: even when it makes sense, migrate incrementally. Start by publishing one stable, widely-used module, validate the full publish-and-consume flow, and only then move the rest.

## Conclusion

What this integration does, at bottom, is stop treating infrastructure as a special case.

Container images have a registry, digest-based versioning, access control, replication, signing, and verification. Infrastructure modules, historically, had a Git repository and a tagging convention. Two artifact categories with nearly identical needs, solved in very different ways.

Bringing them closer together means investments made in the software supply chain now also apply to infrastructure, with no parallel tooling. For organizations that take provenance seriously, that's a bigger win than the simple convenience of reusing an existing registry.
