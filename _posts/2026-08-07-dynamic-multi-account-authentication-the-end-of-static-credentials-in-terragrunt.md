---
title: "Dynamic Multi-Account Authentication: The End of Static Credentials in Terragrunt"
description: "How to use Terragrunt's --auth-provider-cmd to obtain temporary credentials per unit: the expected JSON contract, per-account role assumption, OIDC integration, and implementation caveats."
date: 2026-08-07 19:00:00 +0000
lang: en
permalink: /en/posts/dynamic-multi-account-authentication-the-end-of-static-credentials-in-terragrunt/
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Security, DevSecOps, OIDC, Multi-Account, IaC]
icons: [terragrunt, terraform, opentofu]
---

## Introduction

Look through the secrets in your infrastructure repository. There is a good chance an access key is sitting there that nobody can say when it was last rotated.

It is there because the pipeline has to authenticate somewhere, and that was the most direct way to solve it. The problem is that a static credential does not expire on its own, does not know who used it, and stays valid long after the person who created it has moved to another team.

In multi-account environments, this problem multiplies in an uncomfortable way. Either you maintain one credential per account, with the management cost that implies, or you maintain a single credential with permission to reach all of them, which is exactly what nobody wanted when separating the accounts.

Terragrunt provides an extension point to solve this differently.

## The Extension Point

The configuration is an option that points to a command, passed as a flag or as an environment variable:

```bash
terragrunt apply --auth-provider-cmd ./scripts/authenticate.sh

# or, equivalently
export TG_AUTH_PROVIDER_CMD="./scripts/authenticate.sh"
terragrunt apply
```

Terragrunt runs that command and uses the result to build the credential environment for the run. The execution happens in the context of each unit, and that detail is what makes the mechanism interesting in multi-account scenarios.

What the command does internally is up to you. It can query a secrets vault, assume a role, exchange a token for temporary credentials, or any combination of these. Terragrunt does not care about the method, only about the format of the response.

## The Contract

The command must write a JSON object to standard output, with up to three top-level keys, all optional:

```json
{
  "awsCredentials": {
    "ACCESS_KEY_ID": "",
    "SECRET_ACCESS_KEY": "",
    "SESSION_TOKEN": ""
  },
  "awsRole": {
    "roleARN": "",
    "roleSessionName": "",
    "duration": 0,
    "webIdentityToken": ""
  },
  "envs": {
    "ANY_KEY": "any_value"
  }
}
```

The distinction between the first two deserves attention, because it defines who does the work.

With `awsCredentials`, your script has already obtained the temporary credentials and hands them over ready to use. With `awsRole`, you tell Terragrunt which role to assume and let it do the assumption.

The `envs` key accepts any key and value pair, and it is how settings such as region or credentials for non-AWS providers pass through.

## Per-Account Credentials

The case that justifies the whole mechanism is each environment living in a different account. The command runs for each unit, and the script decides what to do.

An example that assumes the role matching the unit's account:

```bash
#!/bin/bash
set -euo pipefail

ROLE_ARN="${AUTH_ROLE_ARN:?AUTH_ROLE_ARN must be set}"
SESSION_NAME="terragrunt-$(date +%s)"

# Logs go to stderr, never to stdout
echo "Assuming ${ROLE_ARN}" >&2

CREDS=$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "$SESSION_NAME" \
  --duration-seconds 3600 \
  --output json)

jq -n \
  --arg ak "$(jq -r '.Credentials.AccessKeyId' <<< "$CREDS")" \
  --arg sk "$(jq -r '.Credentials.SecretAccessKey' <<< "$CREDS")" \
  --arg st "$(jq -r '.Credentials.SessionToken' <<< "$CREDS")" \
  --arg region "us-east-1" \
  '{
    awsCredentials: {
      ACCESS_KEY_ID: $ak,
      SECRET_ACCESS_KEY: $sk,
      SESSION_TOKEN: $st
    },
    envs: {
      AWS_REGION: $region
    }
  }'
```

Using `jq` to build the output is not fussiness. It guarantees the values are escaped correctly, which avoids invalid JSON when a token contains special characters.

## Letting Terragrunt Assume the Role

When the logic is only to figure out which role to use, the script gets much simpler. Instead of calling the API and handling the response, it reports the role:

```bash
#!/bin/bash
set -euo pipefail

ACCOUNT="${TG_ACCOUNT_ID:?account not provided}"

jq -n --arg arn "arn:aws:iam::${ACCOUNT}:role/terragrunt-deploy" \
  '{
    awsRole: {
      roleARN: $arn,
      roleSessionName: "terragrunt",
      duration: 3600
    }
  }'
```

Less code means fewer places for mistakes. If your case is only choosing the role according to the account, this is the preferred form.

## Eliminating the Secret Entirely

The field that makes the mechanism truly interesting from a security standpoint is the identity token.

The idea is this: instead of storing a credential, the CI pipeline issues a short-lived token that proves the identity of that run. That token is exchanged for temporary cloud credentials, with permissions restricted to what that pipeline needs.

The result is that no secret is stored. There is no key to rotate, leak, or forget. Trust is established between your CI platform's identity provider and the cloud, under conditions you define.

This is the same principle we saw on the state side in [Ephemeral Values: How OpenTofu Handles Secrets That Never Hit State](/en/posts/ephemeral-values-how-opentofu-handles-secrets-that-never-hit-state/). The safest secret is still the one that does not exist.

## Per Unit, Not Per Pipeline

The difference from the traditional approach is worth underlining, because it is what changes the design.

When authentication happens at the start of the pipeline, the whole run shares the same identity. That forces the credential to have permission for everything any unit might need, and the result is a set of permissions much larger than any individual unit would require.

With the command running in the context of each unit, each one can obtain exactly the identity it needs. A batch run crossing several accounts becomes possible without any single credential able to reach all of them.

The practical consequence is a smaller blast radius. A configuration failure affects the scope of that unit, and not everything the pipeline can reach.

## Caveats

Four implementation points that save debugging time.

**Standard output is for the JSON only.** Any log message printed there breaks parsing. Send everything diagnostic to standard error.

**Test the script in isolation.** Before integrating, run the command and pass the result through a JSON validator. Most problems show up at this stage.

**The script is production code.** It decides who has access to what. It deserves versioning, review in a Pull Request, and the same care you would give a permissions policy.

**Mind the session duration.** A long-running apply can outlast the validity of the credentials obtained at the start. Size the duration for the worst case, not the typical one.

## Conclusion

Static credentials survive less out of conviction and more out of inertia. They work, they were configured once, and rarely does anyone find the right moment to touch something that is working.

The argument for changing is not that they are fragile in themselves, but that they solve the wrong problem. A permanent key answers the question of how to authenticate, when the relevant question is who is running what, right now, and with what authority.

Credentials obtained at execution time answer that second question. They carry identity, scope, and an expiry, and that turns the access log into something that actually tells a story, instead of always pointing to the same shared key someone created three years ago and nobody feels safe enough to revoke.
