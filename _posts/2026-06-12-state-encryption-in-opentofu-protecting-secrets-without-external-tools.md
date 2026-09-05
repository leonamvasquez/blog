---
title: "State Encryption in OpenTofu: Protecting Secrets Without External Tools"
description: "How native state and plan encryption works in OpenTofu: the anatomy of the encryption block, the available key providers, migrating an existing state, and the care needed around key rotation."
date: 2026-06-12 19:00:00 +0000
lang: en
permalink: /en/posts/state-encryption-in-opentofu-protecting-secrets-without-external-tools/
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, State, Security, DevSecOps, Encryption, IaC]
icons: [opentofu]
---

## Introduction

Create a database with Terraform, set the password through a variable, then open the state file, and there's the password, completely hardcoded, right next to everything else the tool knows about your infrastructure.

That's not really a problem, in a way. To compare what exists against what was declared, the tool has to keep track of the values it actually applied. The problem is practically nobody treats that file with the care it demands.

The usual answer is to encrypt the bucket where state lives. It helps, but it only covers part of the problem, and understanding that gap is where your infra starts to become even minimally secure.

OpenTofu took a different path, and it's now the feature that sets it apart from Terraform the most: encryption happens inside the tool itself, before the data ever leaves your machine.

## Why Encrypting the Bucket Isn't Enough

When you turn on server-side encryption on a bucket, the provider encrypts the file when writing it to disk and decrypts it on delivery. Protection exists, but with a defined scope: it covers data at rest on the provider's infrastructure.

Outside that scope, several exposures remain:

- Anyone with read permission on the bucket gets the file already decrypted.
- State travels and gets handled in plain text on your workstation and on the CI runner.
- Local copies, plan files, and automated backups all keep the same readable content.
- A leak of bucket access credentials hands over the entire content, since decryption is transparent to anyone with permission.

Native encryption moves the point where data gets encrypted. It leaves the tool already protected, and the backend never sees the plain-text content. Without the key, the file is useless, even to someone who manages to download it.

## The Anatomy of the encryption Block

The configuration lives inside the `terraform` block, in its own `encryption` block, made of three elements.

The **key provider** defines where the key comes from. The **method** defines the algorithm that uses that key. The `state` and `plan` blocks connect the method to what you want to protect.

The minimal example, using passphrase derivation:

```hcl
variable "passphrase" {
  type      = string
  sensitive = true
}

terraform {
  encryption {
    key_provider "pbkdf2" "primary_key" {
      passphrase = var.passphrase
    }

    method "aes_gcm" "default_method" {
      keys = key_provider.pbkdf2.primary_key
    }

    state {
      method = method.aes_gcm.default_method
    }
  }
}
```

There's a practical requirement to respect: the passphrase needs at least 16 characters.

## The Available Key Providers

Choosing the key provider sets the operational security model. The options span from local use to managed services:

- **PBKDF2.** Derives the key from a passphrase, locally. It's the simplest to configure and doesn't depend on an external service.
- **AWS KMS**, **GCP KMS**, and **Azure Key Vault.** Delegate key management to the provider's managed service.
- **OpenBao.** Integration with the open-source secrets vault.
- **External.** Lets you get the key from an external program, for cases the others don't cover.

For production, managed services are preferable, mainly for automatic rotation. The KMS configuration follows the same structure:

```hcl
terraform {
  encryption {
    key_provider "aws_kms" "prod_key" {
      kms_key_id = "arn:aws:kms:us-east-1:111122223333:key/abcd-1234"
      key_spec   = "AES_256"
      region     = "us-east-1"
    }

    method "aes_gcm" "prod_method" {
      keys = key_provider.aws_kms.prod_key
    }

    state {
      method   = method.aes_gcm.prod_method
      enforced = true
    }
  }
}
```

The `enforced` attribute is worth calling out. Turned on, it makes OpenTofu refuse to write or read unencrypted data, which rules out anyone accidentally disabling the protection.

## Migrating an Existing State

This is the part that usually raises questions. If your state already exists and sits in plain text, the tool can't just switch to decrypting it, because there's nothing encrypted there to begin with.

The mechanism that solves this is the `fallback` block, which works as a second read method. If the primary method fails, OpenTofu tries the alternate one.

The migration gets declared like this:

```hcl
terraform {
  encryption {
    method "unencrypted" "migration" {}

    key_provider "pbkdf2" "primary_key" {
      passphrase = var.passphrase
    }

    method "aes_gcm" "default_method" {
      keys = key_provider.pbkdf2.primary_key
    }

    state {
      method = method.aes_gcm.default_method

      fallback {
        method = method.unencrypted.migration
      }
    }
  }
}
```

Reading goes through the alternate method, which interprets the file as plain text. Writing goes through the primary method, already encrypted. One single command makes the transition:

```bash
tofu apply
```

Once the migration is done, remove the `fallback` block and the unencrypted method, and consider turning on `enforced`. As long as the fallback exists, the tool keeps accepting plain-text state.

To confirm the result, download the file from the backend and check its format. It should stop being readable JSON.

## Protecting the Plan Too

One detail that goes unnoticed: the plan file carries the same sensitive values as the state, since it describes exactly what's about to be applied.

If you save plans to a file, common in pipelines that split validation from apply, protect them with the same configuration:

```hcl
    plan {
      method   = method.aes_gcm.default_method
      enforced = true
    }
```

There's also the `remote_state_data_sources` block, for when one configuration reads another's encrypted state. Without it, cross-project reads fail.

## The Way Back

Rolling back uses the same mechanism, reversed. You declare the unencrypted method as primary and the encrypted one as the alternate:

```hcl
    state {
      method   = method.unencrypted.migration
      enforced = false

      fallback {
        method = method.aes_gcm.default_method
      }
    }
```

Reading decrypts, writing goes out in plain text. The same technique works for switching key providers: roll back to plain text and re-encrypt with the new key, or point the fallback at the old provider while the primary already uses the new one.

Knowing there's a way back is what makes it reasonable to adopt encryption on environments already running in production.

## Rotation and the Key-Saturation Problem

This is the technical warning the documentation raises that rarely shows up in tutorials.

The algorithm used is secure and industry-standard, but it suffers from key saturation: prolonged use of the same static key degrades the protection over time.

Two strategies fix this:

- Use a derivation-based provider, with a long, complex passphrase.
- Use a managed key service with automatic rotation configured.

Short, static keys are the worst-case scenario. They give a sense of protection without actually delivering it.

## Operational Concerns

Three points that deserve a conscious decision before adoption.

**Lose the key, lose the state.** There's no recovery. Your backup procedure needs to include the key, not just the encrypted file.

**The passphrase shouldn't live in the code.** The configuration can be supplied through its own environment variable, which keeps the passphrase out of the repository and lets you reuse the same definition across environments.

**The whole team needs the key.** Everyone who runs the tool, including the CI runner, needs access. That turns key distribution into a secrets-management problem you now have to solve.

## Conclusion

Native state encryption fixes a long-standing inconsistency in Infrastructure as Code. We spent years treating state as a configuration file, when it was always a secrets repository.

The genuine gain is a shift in the trust boundary. You stop trusting the backend, the bucket's permissions, and whoever has access to them, and start trusting only whoever holds the key. That's a smaller surface, and an easier one to audit.

The cost is real too, and worth stating plainly: you trade one problem for another. Readable state goes away, and in comes the responsibility of managing, distributing, and rotating a key your entire infrastructure history depends on. It's a worthwhile trade, but only when that management gets the same rigor the state's own protection used to demand.
