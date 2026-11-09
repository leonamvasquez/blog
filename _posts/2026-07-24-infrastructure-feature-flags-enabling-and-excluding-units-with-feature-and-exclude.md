---
title: "Infrastructure Feature Flags: Enabling and Excluding Units with feature and exclude"
description: "How to use Terragrunt's feature and exclude blocks to control which units run, pick environments in batch runs, and understand where exclude stops applying and no_run takes over."
date: 2026-07-24 19:00:00 +0000
lang: en
permalink: /en/posts/infrastructure-feature-flags-enabling-and-excluding-units-with-feature-and-exclude/
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Feature Flags, IaC, DevOps, Platform Engineering]
icons: [terragrunt, terraform, opentofu]
---

## Introduction

Application teams solved the problem of merging code that should not run yet years ago. It is called a feature flag: the code lands on the main branch switched off, and someone decides later when to turn it on.

In infrastructure, the more common picture is different: a long-lived branch, whole blocks commented out, or a boolean variable with conditionals scattered through the code.

Terragrunt offers its own answer, with two blocks that work together: `feature`, which declares the switch, and `exclude`, which decides what to do when it says the unit should stay out.

## The feature Block

The declaration lives in the unit configuration, and every flag must have a default value:

```hcl
feature "enable_cache" {
  default = false
}
```

The value can be overridden at run time in two ways:

```bash
# Through the command line
terragrunt --feature enable_cache=true apply

# Through an environment variable (multiple flags separated by commas)
export TG_FEATURE=enable_cache=true,environment=dev
terragrunt apply
```

The advantage over an arbitrary variable is clarity: reading the configuration, it is obvious that this is a deliberate control point and not an ordinary parameter.

The default is evaluated as an expression at run time. That makes it possible to fetch the value from an external feature flag service such as LaunchDarkly or AppConfig:

```hcl
feature "enable_cache" {
  default = run_cmd("--terragrunt-quiet", "./scripts/fetch-flag.sh", "cache")
}
```

The value can also be consumed elsewhere in the configuration, such as `inputs` and hooks:

```hcl
inputs = {
  enable_cache = feature.enable_cache.value
}
```

## The exclude Block

Declaring the switch solves half of the problem. The other half is deciding what happens when the unit should stay out, and that is where `exclude` comes in:

```hcl
exclude {
  if      = true
  actions = ["plan", "apply"]
}
```

There are four attributes:

- **`if`** takes the condition that determines whether the unit is excluded.
- **`actions`** lists the excluded actions. It accepts specific commands such as `plan` and `apply`, `all` to exclude everything, and `all_except_output` to exclude everything while keeping `output`, which matters when other units depend on this one.
- **`exclude_dependencies`** also removes the unit's dependencies from the run queue. The default is `false`.
- **`no_run`** prevents the unit from running in single-unit commands. We come back to it below, because it is the piece that is usually missing.

## Combining the Two

Together, the blocks form the pattern that matters: a unit lands in the repository switched off and only runs when someone decides it should.

```hcl
terraform {
  source = "github.com/myorg/modules//cache?ref=v1.2.0"
}

feature "enable_cache" {
  default = false
}

exclude {
  if                   = !feature.enable_cache.value
  actions              = ["all"]
  exclude_dependencies = !feature.enable_cache.value
}
```

The code is versioned, reviewed in a Pull Request, and visible to everyone. It just stays out of the run while the flag is off. That reduces the need for the long-lived branch, which is where infrastructure code tends to age while waiting for approval.

## Choosing Environments in Batch Runs

The most practical use shows up when there are many units and you only want to run a subset. Instead of memorizing paths, declare each environment as a flag. Here `dev` is on by default and the others are off:

```hcl
# dev/terragrunt.hcl
feature "dev" {
  default = true
}

exclude {
  if      = !feature.dev.value
  actions = ["all_except_output"]
}
```

```hcl
# stage/terragrunt.hcl (prod follows the same pattern)
feature "stage" {
  default = false
}

exclude {
  if      = !feature.stage.value
  actions = ["all_except_output"]
}
```

With the pattern applied to each environment, selection becomes part of the command. Since `dev` is on by default, it has to be turned off explicitly:

```bash
# Run staging only
terragrunt run --all --feature dev=false --feature stage=true plan

# Run staging and production, leaving dev out
terragrunt run --all --feature dev=false --feature stage=true --feature prod=true plan
```

Using `all_except_output` is deliberate: excluded units can still provide their outputs to the ones that remain in the queue, which avoids breaking dependencies between environments.

## Dynamic Module Versioning

Because the flag value is an ordinary expression, it can also compose the module source, with no exclusion involved:

```hcl
feature "s3_version" {
  default = "v1.0.0"
}

terraform {
  source = "git::git@github.com:myorg/modules.git//s3?ref=${feature.s3_version.value}"
}
```

Trying a new version in one environment becomes a run parameter:

```bash
terragrunt --feature s3_version=v1.1.0 apply
```

There is no need to change the code, or revert a commit if the result is not what you wanted.

## Where exclude Stops and no_run Takes Over

This is the point that causes the most confusion. `exclude` works on the **run queue**, and the queue only exists in batch runs. If someone enters a unit's directory and runs the command directly, there is no queue to filter.

For that case there is `no_run`. According to the documentation, when both `if` and `no_run` are true, it prevents the unit from running in single-unit commands, but only when the current action appears in `actions`:

```hcl
exclude {
  if      = !feature.enable_cache.value
  no_run  = true
  actions = ["plan", "apply"]
}
```

Two practical consequences:

- In `run --all`, `no_run` is ignored. `exclude` does the work there.
- Running `terragrunt plan` directly in the unit folder is blocked, but a `destroy`, which is not in `actions`, goes through. List every action that needs protection, or use `all`.

The documentation itself suggests a fitting use: units that are expensive to keep updating and should only be enabled when needed.

Neither is an access control. Anyone who can change the configuration can switch the rule off. For policy about who can apply what, the right place is the pipeline or the permissions layer. For custom logic before execution, a hook does the job, and how it works is covered in [Terragrunt Hooks: Lifecycle Extension Points](/en/posts/terragrunt-hooks-lifecycle-extension-points/).

## Caveats

**Conditions cannot see dependency outputs.** The attributes of the `exclude` block cannot reference outputs from other units. Terragrunt evaluates the block while it builds the run queue, before any dependency has run, and rejects a configuration that tries to.

**Flags accumulate debt.** A flag that was meant to be temporary and stays in the code for two years becomes a control mechanism nobody remembers the purpose of. Define when each flag will be removed in the same Pull Request that creates it.

**Exclusion shows up in the report.** When a unit is excluded, Terragrunt's run report records the reason. It is useful for auditing, and also for finding out why something did not run when you expected it to.

## Conclusion

What these blocks do is bring to infrastructure a separation that software development settled long ago: the difference between merging code and activating it.

When the two are the same thing, every new piece of code is a choice between waiting on a branch or going to production. When they separate, code can be reviewed, versioned, and merged without that meaning it runs.

Infrastructure got to this point later, for an understandable reason: turning off a feature in an application is a conditional, while turning off an infrastructure component means deciding it does not exist. That is why the answer came from the orchestration layer and not from the language.
