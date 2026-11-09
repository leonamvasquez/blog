---
title: "Vault in Practice: Architecture, Secrets Engines, Auth Methods, and Policies"
description: "How HashiCorp Vault works under the hood: the cryptographic barrier, the path-based model, secrets engines, auth methods, tokens, policies, and leases, with command-line examples."
date: 2026-08-21 19:00:00 +0000
lang: en
permalink: /en/posts/vault-in-practice-architecture-secrets-engines-auth-methods-and-policies/
categories: [DevSecOps, Security, Vault]
tags: [Vault, HashiCorp, Secrets, Policies, DevSecOps, Security]
icons: [vault]
---

## Introduction

Ask someone to describe Vault in one sentence and the answer is usually some variation of "a safe place to store passwords." The description is right, but it covers only the simplest part of what the tool does.

Storing values is the starting point. What makes Vault relevant is the ability to generate credentials at the moment someone asks, with an expiry, and to decide who can ask for what based on identity, not on possession of a password.

To use these capabilities well, you need to understand the pieces that make up the tool and how they fit together. There are few of them, and almost everything else derives from them.

## What Vault Is

Vault is a secrets and identity management system for machines and people. It stores sensitive values, generates dynamic credentials for other systems, offers encryption as a service, and controls access to all of it through policies.

A note on context, for those following the OpenTofu series: in 2023, Vault also moved from the MPL 2.0 license to BSL 1.1, in the same change that hit Terraform. The reaction followed a similar path. OpenBao, an open source fork under MPL 2.0, is maintained under the Open Source Security Foundation, part of the Linux Foundation, and keeps API compatibility with Vault in a good share of use cases.

The concepts in this article apply to both projects. The examples use the Vault CLI.

## The Barrier and the Storage

Vault's most important architectural decision is to treat storage as untrusted.

Every piece of data Vault writes first passes through a layer called the **barrier**, which encrypts it. The storage backend, whether the Raft built into Vault itself or another supported one, receives only encrypted data. Whoever has direct access to the disk or database where Vault writes cannot read anything.

The consequence is that Vault starts in a state called **sealed**. It knows where the data is, but does not have the key to decrypt it. Until it is unsealed, it does not respond to any request that depends on that data.

The sealing and unsealing process is complex enough for an article of its own, and it is the topic of the next text in this series.

## Everything Is a Path

The second central idea is that every interaction with Vault happens through paths, in the style of a filesystem.

Reading a secret, generating a credential, configuring an authentication method, writing a policy: all of these operations are reads and writes on paths. The CLI, the HTTP API, and the client libraries are different ways of doing the same thing.

This model looks like an interface detail, but it underpins the permission system. Since everything is a path, controlling access comes down to saying who can do what on which paths.

## Secrets Engines

**Secrets engines** are the components that actually store, generate, or transform data. Each one is mounted at a path, and everything that arrives at that path is handled by it.

The simplest is the key-value engine, which stores static data with version history:

```bash
vault secrets enable -path=secret kv-v2

vault kv put secret/app/config db_host=db.internal db_port=5432
vault kv get secret/app/config
```

The others are more interesting. The AWS engine generates temporary IAM credentials. The database engine creates users with an expiry. Transit encrypts and decrypts data without ever exposing the key. PKI issues certificates.

What the dynamic engines have in common is that the secret does not exist before the request. It is created when someone needs it, and destroyed when the time runs out. The two final articles in this series cover these cases in detail, with AWS and with databases.

## Auth Methods

Before accessing any engine, the client needs to identify itself. **Auth methods** are the components that verify that identity.

Each method trusts a different source. One accepts a username and password. Another validates a token issued by Kubernetes for a service account. Another accepts an OIDC token from a corporate identity provider or a CI platform.

```bash
vault auth enable userpass

vault write auth/userpass/users/leonam \
    password="change-this-password" \
    token_policies="app-read"
```

Regardless of the method, the result of authentication is always the same: a token. The method only defines how identity is proven. Choosing the right method for each type of client is the topic of the third article in this series.

## Tokens

The token is Vault's currency of access. Every authenticated request carries one, and it is from the token that Vault finds out which policies apply.

Tokens have an expiry and can be renewed up to a maximum limit. When they expire, everything generated from them can be revoked in cascade, which gives the administrator a way to end all access granted to a client at once.

There is one special token, the **root token**, created at initialization, which ignores all policies. It is meant for the initial setup. Once that stage is complete, the recommended practice is to revoke it and generate a new one only when needed, through a procedure that requires the participation of those who hold the keys.

## Policies

**Policies** are the authorization mechanism. They are written in HCL and associate paths with capabilities:

```hcl
# app-read.hcl
path "secret/data/app/*" {
  capabilities = ["read"]
}

path "secret/metadata/app/*" {
  capabilities = ["list"]
}
```

```bash
vault policy write app-read app-read.hcl
```

The available capabilities cover the possible operations: create, read, update, patch, delete, and list, plus a privileged capability for administrative paths and an explicit deny, which prevails over any other.

The default behavior is to deny. A token can only do what one of its policies explicitly allows.

Notice the paths in the example. The key-value engine in version 2 separates data from metadata into different paths, with the `data/` and `metadata/` prefixes. The `vault kv get secret/app/config` command hides this detail, but the policy has to account for it. A policy written for `secret/app/*` grants access to nothing, and this is usually the first mistake of anyone starting to write policies.

## Leases

The last concept closes the cycle. Every dynamic credential comes with a **lease**, a contract with its own identifier and an expiry.

```bash
vault lease renew <lease_id>
vault lease revoke <lease_id>
```

The lease allows three things. The client can renew it while it still needs the credential. The administrator can revoke it at any time, which destroys the credential at its source. And, if nobody does anything, it expires and the credential ceases to exist.

This mechanism is what gives the dynamic credential the properties a static secret lacks: expiry, traceability, and revocation.

## Conclusion

Vault's model boils down to a sequence: a client proves who it is through an auth method, receives a token, and the policies attached to that token determine what it can do on the paths where secrets engines are mounted. Dynamic credentials are born with a lease, and the lease decides when they die.

Each of these pieces is simple on its own. The strength of the whole lies in the separation between them. How identity is proven does not depend on where the secret is, permission does not depend on how it is generated, and validity does not depend on someone remembering to change a password.

That separation is what allows the tool to grow from a repository of values into an identity layer for the infrastructure, and it is for this second reading that it is worth studying.
