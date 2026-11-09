---
title: "Goodbye Static Access Keys: Generating Temporary AWS Credentials with Vault"
description: "How to use Vault's AWS secrets engine to generate credentials on demand: configuring the root credential, the iam_user and assumed_role types, leases, revocation, and what changes in multi-account environments."
date: 2026-09-11 19:00:00 +0000
lang: en
permalink: /en/posts/goodbye-static-access-keys-generating-temporary-aws-credentials-with-vault/
categories: [DevSecOps, Security, Vault]
tags: [Vault, AWS, IAM, STS, Dynamic Credentials, DevSecOps]
icons: [vault]
---

## Introduction

AWS access keys published in public repositories are actively hunted by bots. AWS itself runs scans that detect these exposures and apply restrictions to the key, precisely because the interval between publication and the first attempt to use it tends to be short.

The public leak scenario is the most visible, but not the most common. More frequent is the key that lives for years in a pipeline's configuration, copied to the local files of a few engineers, with permissions that grew every time someone needed something new.

Vault's AWS secrets engine attacks the problem at the root. Instead of a permanent key existing for each consumer, each request generates a new credential, with specific permissions and an expiry.

## The Model

The structure is simple. Vault holds a single credential with permission to create others. Each consumer, when asking for access, receives a credential generated at that moment, valid for a defined period and tied to a lease.

When the lease expires or is revoked, Vault removes the credential in AWS, for the types that allow that removal. Consumers never touch the root credential, and no credential handed to them outlives what is necessary.

## The Root Credential

The first step is to enable the engine and provide the credential Vault will use:

```bash
vault secrets enable aws

vault write aws/config/root \
    access_key="AKIA..." \
    secret_key="..." \
    region="us-east-1"
```

This credential should belong to an IAM user dedicated to Vault, with permissions limited to what is needed to generate the credentials for the configured roles. The documentation also requires that this be the only access key of that user.

Once configured, the next step is to make sure nobody else knows this key:

```bash
vault write -f aws/config/rotate-root
```

Vault generates a new key, deletes the previous one, and becomes the sole holder. Right after the rotation, subsequent calls may fail for a few seconds while AWS propagates the change.

In the Enterprise edition, there is also workload identity federation, which lets Vault authenticate to AWS without any static key, through an identity token trusted by IAM. It is the path to eliminating even this last credential.

## The Credential Types

Each role configured in the engine defines a credential type. There are four:

- **iam_user** creates a real IAM user, with its own keys.
- **assumed_role** assumes an existing IAM role and returns temporary STS credentials.
- **federation_token** generates temporary federation credentials from the Vault user.
- **session_token** generates a session token for the Vault user itself.

The first two cover most use cases.

## iam_user

With this type, Vault creates an IAM user for each request and removes it when the lease ends. Permissions are defined by managed policies or by an inline policy document:

```bash
vault write aws/roles/s3-read \
    credential_type="iam_user" \
    policy_arns="arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
```

```bash
vault read aws/creds/s3-read
```

The response brings the access key, the secret key, and the lease identifier.

The advantage is real revocation. When the lease ends, the user ceases to exist, and any later use of the credential fails immediately.

The drawback is latency. Newly created IAM users can take a few seconds to be recognized in all regions, and an application that tries to use the credential immediately may get transient authorization errors. Clients that consume this type of credential need to allow for a short wait or retries.

## assumed_role

With this type, Vault creates nothing in IAM. It assumes an existing role and returns temporary credentials:

```bash
vault write aws/roles/production-deploy \
    credential_type="assumed_role" \
    role_arns="arn:aws:iam::222233334444:role/vault-deploy" \
    default_sts_ttl="15m" \
    max_sts_ttl="1h"
```

```bash
vault read aws/sts/production-deploy
```

For it to work, the target role needs a trust policy that lets Vault's identity assume it. Permission is defined by the role in AWS, not by Vault, which keeps authority over what can be done in each account with whoever administers that account.

This is the right type for multi-account environments. Vault sits in a central account and each target account exposes a role trusting it. Adding a new account means adding a role in Vault and a trust relationship in the account, with no new key to distribute.

The same role can accept more than one target ARN. In that case, the consumer indicates which one to assume at request time.

## The Revocation Detail

Here is the difference between the two types that weighs most in incident response.

Temporary STS credentials cannot be revoked individually in AWS. They are valid until the end of the period for which they were issued. When Vault ends the lease of an assumed_role credential, it stops renewing it, but the credential already handed out stays valid until it expires.

In practice, this changes the role of the expiry. For iam_user, the expiry is a convenience, because revocation is available. For assumed_role, the expiry is the control itself. Fifteen minutes of validity means, in the worst case, fifteen minutes of exposure of a leaked credential.

For that reason, TTL values for STS credentials should be sized by the time of the longest task that consumes them, not by comfort.

## Consuming in Infrastructure Pipelines

The most common pattern in infrastructure as code is for the pipeline to obtain the credential before running the plan. With Terragrunt, this fits the per-unit authentication command, described in [Dynamic Multi-Account Authentication: The End of Static Credentials in Terragrunt](/en/posts/dynamic-multi-account-authentication-the-end-of-static-credentials-in-terragrunt/):

```bash
#!/bin/bash
set -euo pipefail

CREDS=$(vault read -format=json aws/sts/production-deploy)

jq -n \
  --arg ak "$(jq -r '.data.access_key' <<< "$CREDS")" \
  --arg sk "$(jq -r '.data.secret_key' <<< "$CREDS")" \
  --arg st "$(jq -r '.data.security_token' <<< "$CREDS")" \
  '{
    awsCredentials: {
      ACCESS_KEY_ID: $ak,
      SECRET_ACCESS_KEY: $sk,
      SESSION_TOKEN: $st
    }
  }'
```

Combined with the pipeline authenticating to Vault via JWT, the whole flow happens without any AWS key stored anywhere. The CI platform attests the run, Vault issues a short-lived token, and that token obtains fifteen-minute credentials for the target account.

## Conclusion

A permanent access key is a decision made once and kept out of inertia. It is created to solve a one-off need and outlives that need, the project that motivated it, and, often, the person who created it.

Vault's AWS engine inverts that logic. The credential stops being a resource that exists and becomes an event that happens, with a beginning, scope, and end defined at the moment of the request.

The most visible effect is in incident response. Faced with a leak, the question stops being where else this key was copied and who will break when it is rotated. It becomes how long until it expires, a question with an exact answer, recorded in the lease.
