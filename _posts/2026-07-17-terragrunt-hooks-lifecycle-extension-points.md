---
title: "Terragrunt Hooks: Lifecycle Extension Points"
description: "How to use before_hook, after_hook, and error_hook in Terragrunt: syntax, execution order, failure handling, and the criteria for choosing between a hook, a pipeline, or engine-native features."
date: 2026-07-17 19:00:00 +0000
lang: en
permalink: /en/posts/terragrunt-hooks-lifecycle-extension-points/
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Hooks, CI/CD, IaC, DevOps, Automation]
icons: [terragrunt, terraform, opentofu]
---

## Introduction

Pretty much every team that works with Terragrunt eventually ends up building a script around it.

It usually starts small: a lint check before the plan. Then comes the kubeconfig update, a notification in the team channel, cleanup of a temporary file. At some point nobody calls Terragrunt directly anymore — there's always a wrapper that needs to run first.

The trouble with this pattern is that all that logic lives outside the configuration. Nobody inherits it, it doesn't travel with the unit, and it vanishes the moment someone runs the command by hand.

That's the exact problem hooks solve: they bring these steps back into the configuration file itself, where they get versioned and inherited like any other attribute.

## The Three Types

Declared inside the `terraform` block, hooks come in three flavors:

- **`before_hook`** fires before the call to OpenTofu or Terraform.
- **`after_hook`** fires after it.
- **`error_hook`** kicks in when an error occurs whose message matches a pattern you define.

A minimal example already makes the structure clear:

```hcl
terraform {
  before_hook "start_notice" {
    commands = ["apply", "plan"]
    execute  = ["echo", "Starting execution"]
  }

  after_hook "end_notice" {
    commands     = ["apply", "plan"]
    execute      = ["echo", "Execution finished"]
    run_on_error = true
  }
}
```

Two attributes are required: `commands`, which lists which commands the hook targets, and `execute`, which takes the command and its arguments as a list.

## The Attributes That Actually Matter

Beyond the two required ones, four optional attributes make a real difference in practice:

- **`working_dir`** controls where the hook runs. The default varies: for most hooks it's the module directory, which sits inside the cache when you use `source`. This detail tends to surprise anyone who expected to be inside the unit's own directory.
- **`run_on_error`** forces the hook to run even after something failed earlier. It defaults to off.
- **`suppress_stdout`** silences the command's output — useful when some script needs to parse the engine's output cleanly, and any extra text would break that parsing.
- **`if`** lets the hook skip execution when the expression evaluates to false.

## before_hook: Validation and Preparation

The most common use is making sure something happens before any execution — validating code, for instance:

```hcl
terraform {
  before_hook "tflint" {
    commands = ["plan", "apply"]
    execute  = ["tflint", "--minimum-failure-severity=error"]
  }
}
```

tflint has native support as a hook, which makes this integration straightforward.

Another frequent use is setting up the environment for what comes next:

```hcl
terraform {
  before_hook "kubeconfig" {
    commands = ["plan", "apply"]
    execute = [
      "aws", "eks", "update-kubeconfig",
      "--region", "us-east-1",
      "--name", "production-cluster"
    ]
  }
}
```

This is where the advantage over an external script becomes visible: declared in the root configuration, this step gets inherited by every unit that needs it, with nobody having to remember to add it.

## after_hook: Cleanup and Notification

Once execution finishes, the two typical scenarios are notifying someone and cleaning something up. What separates them is `run_on_error`:

```hcl
terraform {
  after_hook "notify_success" {
    commands     = ["apply"]
    execute      = ["bash", "-c", "./scripts/notify.sh success"]
    run_on_error = false
  }

  after_hook "cleanup" {
    commands     = ["apply"]
    execute      = ["bash", "-c", "rm -f /tmp/terragrunt-lock"]
    run_on_error = true
  }
}
```

Notifying only makes sense if things went well. Cleanup needs to happen regardless. That's exactly the distinction the attribute expresses.

## error_hook: Reacting to Specific Failures

The third type is the richest and, at the same time, the most overlooked. It only fires when the error message matches one of the declared patterns:

```hcl
terraform {
  error_hook "access_denied" {
    commands  = ["plan", "apply"]
    on_errors = ["AccessDenied", "UnauthorizedOperation"]
    execute   = ["bash", "-c", "./scripts/diagnose-permissions.sh"]
  }

  error_hook "capture_diagnostics" {
    commands  = ["apply"]
    on_errors = [".*"]
    execute   = ["bash", "-c", "./scripts/collect-context.sh"]
  }
}
```

`on_errors` works with regular expressions. A pattern that matches anything acts as a general safety net, while more specific patterns let you react differently depending on the cause.

Two behavioral details are worth keeping in mind. Error hooks only run after the before and after hooks have already executed. And if you need to catch failures during the download of a module referenced via `source`, the right command to include in the list is the init command that pulls from the module — the error, in that case, happens before normal execution even starts.

## Execution Order and Early Termination

When more than one hook targets the same command, execution order follows declaration order. That lets you chain steps predictably.

One behavior in particular deserves attention, because it's what gives hooks their value as a quality gate: **when a `before_hook` fails, execution stops right there**. The engine is never even called, and subsequent hooks without `run_on_error` are skipped too.

In practice, a validation hook ends up acting as a gatekeeper. If the lint fails, nothing gets applied.

## Conditional Hooks

Since hooks are part of the configuration, they have normal access to variables and locals. That opens the door to different behavior per environment:

```hcl
locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals.environment
}

terraform {
  before_hook "production_approval" {
    commands = ["apply"]
    execute  = ["bash", "-c", "./scripts/check-change-window.sh"]
    if       = local.env == "prod"
  }
}
```

This is one area where an external script simply can't compete: the condition sits right next to the configuration it governs, fully explicit.

## Hook, Pipeline, or Engine-Native Feature

With three possible places to host automation, it helps to have a clear rule for choosing between them.

**Reach for a hook when** the step needs to run every time that unit executes, no matter who triggered the command. Environment setup, code validation, and diagnostic collection fit this profile well.

**Reach for a pipeline when** the step belongs to the delivery process, not to the unit itself. Manual approval, artifact publishing, and gating over protected environments live better in the pipeline.

**Reach for an engine-native feature when** the action is part of the resource's own lifecycle and the plan needs to be aware of it. Worth noting that Terraform has started offering its own mechanisms for this kind of action, covered in [Terraform Actions Explained](https://leonam.io/en/posts/terraform-actions-explained-engineering-guide-future-iac/).

The question that separates the three is straightforward: does this step belong to the unit, to the delivery process, or to the resource?

## Things to Watch For

Three things worth checking before adopting this in production.

**Hooks multiply during batch runs.** A hook declared at the root runs once per unit. In a `run --all` over fifty units, that lint command fires fifty times. Weigh the cost before putting anything heavy at the root.

**The working directory is rarely what you'd expect.** When `source` is used, the module gets copied into a cache directory, and that's where the hook runs by default. If the script depends on files from the unit itself, set `working_dir` explicitly.

**Recent features may still be maturing.** There are capabilities still evolving in this area — context variables exposed to hooks, a way to selectively disable them at runtime. Check the current state on your version before relying on them in production.

## Conclusion

Hooks don't add any capability that didn't already exist. Anything they do, a script wrapped around Terragrunt could also do.

What changes is where that logic lives. Inside the configuration, it's inherited through the unit hierarchy, travels with the code through Pull Request reviews, and behaves the same for everyone — including whoever runs the command straight from the terminal without knowing a wrapper used to be involved.

It's the kind of change that looks small on the day you make it and only shows its value months later, when someone new joins the team and manages to operate the infrastructure without having to figure out which script they were supposed to call.
