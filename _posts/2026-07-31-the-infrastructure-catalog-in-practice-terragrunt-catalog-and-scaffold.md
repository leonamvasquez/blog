---
title: "The Infrastructure Catalog in Practice: terragrunt catalog and scaffold"
description: "How to use Terragrunt's catalog and scaffold commands to discover internal modules and generate units from templates, turning your module repository into a browsable catalog."
date: 2026-07-31 19:00:00 +0000
lang: en
permalink: /en/posts/the-infrastructure-catalog-in-practice-terragrunt-catalog-and-scaffold/
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Catalog, Scaffold, Platform Engineering, IaC, DevOps]
icons: [terragrunt, terraform, opentofu]
---

## Introduction

Think about how a new unit shows up in your repository. Most of the time, someone opens the neighbor's folder, copies everything, throws away what doesn't apply, and tweaks the rest by hand.

It works, and it's fast. But it's also the most common way to spread defects. The module sits on an old version because the source folder hadn't been touched in months. A dependency gets forgotten and only surfaces on the first error. The conventions the team agreed on last year never reach the new unit, since the copied folder predates them.

Terragrunt provides two commands to replace that habit: one shows which modules exist, the other generates the unit from a template.

## The Two Commands

Each command handles one stage.

`catalog` is for discovery. It tells you which modules the organization maintains and what each one is for, without having to open repositories in the browser.

`scaffold` is for generation. It writes the unit's configuration file already filled in, with the right source and the list of the module's parameters.

The two fit together in sequence: you browse the catalog, pick a module, and ask for generation.

## The catalog Block

Configuration is simple. At the root of the repository, a block says where the modules live:

```hcl
# terragrunt.hcl at the root of infrastructure-live
catalog {
  urls = [
    "https://github.com/myorg/infrastructure-modules",
    "https://github.com/myorg/data-modules",
  ]
}
```

The `urls` attribute holds the list of repositories Terragrunt will scan. Each repository is expected to keep its modules in a dedicated folder, following the usual convention for this kind of project.

Because the block sits at the root, it applies to that directory and everything below it. Anyone working in the repository therefore sees the same catalog.

## Browsing the Catalog

With the block in place, just run the command with no arguments:

```bash
terragrunt catalog
```

Terragrunt clones the repositories and opens a terminal interface listing the modules it found. When there are many repositories, the first run takes longer. Later runs are fast, because the clones are kept in cache.

A few keys are all you need to move around:

- **Arrow keys** move through the list of modules.
- **Enter** opens the documentation for the selected module.
- **Slash** starts a typed search.
- **S** generates the unit from the selected module.

You can also point at a specific repository, without relying on the block:

```bash
terragrunt catalog https://github.com/myorg/infrastructure-modules
```

The value of this is less obvious than it looks. In an organization with dozens of internal modules, someone who just joined rarely asks how Terragrunt works. The question is usually what already exists, and the catalog answers that without leaving the terminal.

## Generating the Unit with scaffold

The command also works on its own, without going through the interface:

```bash
terragrunt scaffold https://github.com/myorg/infrastructure-modules//modules/vpc
```

It writes a configuration file into the current directory, with three things already taken care of.

First, the source is filled in with the module URL and the latest tag, which removes the problem of a version inherited through copying. Second, the root configuration is included through the standard lookup in the directories above. Third, the inputs block lists all of the module's parameters, split between required and optional.

The required ones appear ready for you to fill in, with a marker showing what's missing. The optional ones arrive commented out, with a description and type, and you only uncomment what you'll use.

The nature of the task changes. Instead of reading the module's code to find out what it accepts, you get the ready-made list and only decide what to fill in.

## Custom Templates

The default output is reasonable, but it rarely reflects your team's conventions. That's what templates are for.

Terragrunt uses Gruntwork's own templating tool, and detection is automatic: if the module directory has a folder reserved for that purpose, it becomes the template.

The structure has two parts. A configuration file declares the variables that will be asked of whoever generates the unit:

```yaml
# .boilerplate/boilerplate.yml
variables:
  - name: TeamName
    description: Team responsible for this resource
    type: string
```

The template files, written as Go templates, can be anything you want to generate alongside:

{% raw %}
```hcl
# .boilerplate/terragrunt.hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "{{ .sourceUrl }}"
}

inputs = {
  team = "{{ .TeamName }}"

{{ range $var := .requiredVariables }}
  {{ $var.Name }} = null # TODO: fill in
{{ end }}
}
```
{% endraw %}

Besides the variables you define yourself, the template receives the source URL and the list of the module's parameters, already split between required and optional.

You can also pass a template explicitly, as the command's second argument. That way the team standard applies to any module, even third-party ones.

## What This Enables

This is the point that matters to anyone thinking about platforms, and not only to people who use Terragrunt.

In a template, conventions stop being documentation and become an executable standard. Required tags, naming rules, validation hooks, support files every component needs: all of it can live in the template and be applied to every unit created.

Unlike a best-practices guide, nobody has to remember anything here. The easiest path already produces the correct result, which is the core idea of a paved road.

There is also a connection to Stacks, covered in [Terragrunt Stacks Deep Dive: Implicit vs. Explicit](/en/posts/terragrunt-stacks-deep-dive-implicit-vs-explicit/). In that article, the catalog was a concept: a versioned collection of units. Here it gets the tooling to discover and generate.

## Conclusion

What these two commands tackle is not a technical limitation. It's a problem of discovery and repetition.

Infrastructure teams tend to know more than they can pass on. The right module exists, the convention has been agreed, someone has already solved that case. But the information doesn't reach the person who needs it at the moment they need it, and the result is a copy of the neighbor's folder.

Turning that knowledge into a browsable catalog and an executable template has less to do with typing less and more to do with shortening the distance between what the team knows and what it can apply consistently. In large organizations, that distance weighs more on infrastructure quality than technical mastery of any single tool.
