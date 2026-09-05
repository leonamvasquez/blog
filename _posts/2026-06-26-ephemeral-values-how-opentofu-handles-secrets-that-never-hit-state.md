---
title: "Ephemeral Values: How OpenTofu Handles Secrets That Never Hit State"
description: "Understand OpenTofu's ephemeral values: the difference between sensitive and ephemeral, ephemeral variables and outputs, ephemeral resources and write-only attributes, and the contexts where each can be used."
date: 2026-06-26 19:00:00 +0000
lang: en
permalink: /en/posts/ephemeral-values-how-opentofu-handles-secrets-that-never-hit-state/
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, State, Security, DevSecOps, Secrets, IaC]
icons: [opentofu]
---

## Introduction

Marking a variable `sensitive` solves a lot less than it seems to. The value stops showing up in terminal output, but it still ends up written to the state file, in plain text, available to anyone who manages to open it.

The confusion is common and makes sense. The word suggests protection, when in reality all it does is hide the value from display.

OpenTofu 1.11 brought a different kind of answer to this problem. Instead of hiding the value after it's written, it lets certain data never get written at all. That's ephemeral values: they exist only in memory, for the duration of a single run.

## Sensitive vs. Ephemeral: the Difference

Worth nailing down the distinction before any code, since it organizes everything else.

A value marked `sensitive` gets persisted normally in state and plan files. The marking only changes how it's displayed, swapping the content for a placeholder in command output.

An ephemeral value isn't persisted. It lives in memory during the execution phase and disappears at the end. It doesn't go into the state snapshot or the plan file.

These are complementary mechanisms, not competing ones. One protects against visual exposure, the other against persistence.

## Ephemeral Variables

The declaration is straightforward, with its own attribute:

```hcl
variable "access_key" {
  type      = string
  ephemeral = true
  sensitive = true
}

variable "secret_key" {
  type      = string
  ephemeral = true
  sensitive = true
}
```

The typical use is feeding a provider's configuration with temporary credentials, obtained at run time:

```hcl
provider "aws" {
  access_key = var.access_key
  secret_key = var.secret_key
}
```

The credential passes through the tool, authenticates, and leaves no trace in state.

## Ephemeral Resources

Beyond receiving values through variables, the tool can actively fetch them. The `ephemeral` block works similarly to a data source: it reads the resource, makes the result available, and closes it out once it's no longer needed.

```hcl
ephemeral "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "production/db/password"
}
```

Everything that comes back from an ephemeral resource is automatically marked ephemeral, which rules out accidentally using it in a context that would persist the value.

Worth noting a practical dependency: ephemeral resources require an updated provider to support them. Not every provider offers these types, so it's worth checking your provider's documentation before planning the adoption.

## Write-Only Attributes

This is the piece that closes the loop. Ephemeral values solve the input side of secrets, but what about when you need to **write** a secret into a resource, like a database password?

Write-only attributes exist for that. They accept a value in the configuration and pass it to the provider, but their behavior with respect to state is peculiar:

- The attribute exists only in the resource's configuration section.
- In state and in the plan, it's always recorded as null.
- The provider always returns it as null, even after receiving a real value.
- It can accept both regular and ephemeral values, unlike normal attributes, which don't accept ephemeral values.

Since the value never reaches the plan, the tool has no way of noticing it changed. The solution providers adopted is a companion version argument:

```hcl
resource "aws_ssm_parameter" "password" {
  name = "/production/db/password"
  type = "SecureString"

  value_wo         = ephemeral.aws_secretsmanager_secret_version.db_password.secret_string
  value_wo_version = 1
}
```

To rotate the secret, you bump the version number. Without that change, the tool generates no diff at all, since it can't see the content.

## Where Ephemeral Values Can Be Used

This is the part that trips up adoption the most, and the list is closed. An ephemeral value can appear in:

- Other ephemeral resources
- Ephemeral variables
- Ephemeral outputs
- Locals
- Provider configuration
- Provisioners
- Resource connection blocks
- Write-only attributes

Any use outside those contexts throws an error. In practice, that means you can't assign an ephemeral value to a regular resource argument, since that argument would get persisted. The restriction is the guarantee mechanism itself.

## Ephemeral Outputs

Outputs can be ephemeral too, with one relevant limitation: **they only work in child modules**.

```hcl
# modules/secret-reader/outputs.tf
output "credentials" {
  value     = ephemeral.aws_secretsmanager_secret_version.db_password.secret_string
  ephemeral = true
}
```

The restriction makes sense. A root module output gets recorded in state by definition, so letting it be ephemeral would create a contradiction.

The useful pattern here is encapsulating secret retrieval in a dedicated module, which exposes it through an ephemeral output for the calling module to consume in providers or write-only attributes.

## A Complete Flow

Putting the pieces together, a secret's path looks like this: an ephemeral resource fetches the credential from the vault, that credential feeds a provider's configuration or gets written through a write-only attribute, and none of it shows up in state at the end.

The contrast with the old flow is the whole point. Before, that same secret would pass through a regular variable, get used in a normal argument, and end up recorded in plain text in the state file, waiting for someone to find it.

## Things to Watch

Three points before adopting.

**It depends on the provider.** Ephemeral resources and write-only attributes need explicit provider support. The language feature exists, but without the matching provider it doesn't materialize.

**The version has to be managed.** The version argument that accompanies write-only attributes becomes your responsibility. Forgetting to bump it means the new secret simply doesn't get applied, with no visible error.

**It doesn't replace state encryption.** The two features solve different problems. Ephemeral values keep certain data from ever being written; encryption protects everything that does need to be written. State still holds identifiers, configuration, and attributes that describe your infrastructure in detail.

## Conclusion

For years, the guidance on secrets in Infrastructure as Code was essentially defensive: restrict access to state, encrypt the bucket, avoid writing what you can avoid writing. All of it started from the premise that the secret would end up in the file one way or another.

Ephemeral values change that premise. The question stops being how to protect what got written and becomes what actually needs to be written in the first place.

That's the difference between mitigating a risk and eliminating it. A secret that never reached the file can't leak through it, doesn't need precautionary rotation when someone gains access to the bucket, and doesn't show up in some old backup nobody remembers exists. It's protection that doesn't depend on anyone getting the configuration right afterward.
