---
title: "Vault Authentication: Tokens, AppRole, OIDC, and Kubernetes Auth"
description: "How clients prove identity to Vault: the secret zero problem, tokens, AppRole for machines, OIDC for people, JWT for CI pipelines, and the Kubernetes authentication method."
date: 2026-09-04 19:00:00 +0000
lang: en
permalink: /en/posts/vault-authentication-tokens-approle-oidc-and-kubernetes-auth/
categories: [DevSecOps, Security, Vault]
tags: [Vault, AppRole, OIDC, Kubernetes, Authentication, DevSecOps]
icons: [vault]
---

## Introduction

Every secrets management project runs early into a paradox. To fetch a secret from the vault, the application needs to authenticate. And to authenticate, it needs a credential, which is another secret.

This first secret has a name in the literature: **secret zero**. It is the credential that gives access to all the others, and therefore the most valuable one to protect.

How Vault deals with this problem lies in its authentication methods. Some merely move the secret zero to a better protected place. Others eliminate it, relying on an identity the platform already guarantees. Knowing which is which is what separates a deployment that solves the problem from one that only reorganizes it.

## Authenticating Is Exchanging Identity for a Token

All methods follow the same contract. The client presents proof of identity, the method validates it against a source of trust, and Vault returns a token with the policies configured for that identity.

What changes from one method to another is the source of trust. It can be an internal list of users, a corporate identity provider, the Kubernetes API, or the token issuer of a CI platform.

After the exchange, the method no longer takes part. From then on, what governs access is the token and the policies attached to it.

## Tokens

The token is the authentication mechanism itself, and also the destination of all the others.

Each token has an expiry and, in general, can be renewed up to a maximum limit. Child tokens inherit relationships with the token that created them, which makes it possible to revoke an entire tree of access at once.

There are two types with different profiles. Service tokens are complete: they can be renewed, create children, and be revoked individually. Batch tokens are lightweight, are not persisted in the same way, and serve high-volume scenarios where those capabilities are not needed.

Using manually created tokens as the way applications authenticate is possible, but it reproduces exactly the secret zero problem. A long-lived token stored in an environment variable is a password by another name.

## AppRole: For Machines, in Two Halves

AppRole was designed for machine authentication in environments where no platform identity is available. The credential is split into two parts:

- **role_id**, which identifies the role and works like a username.
- **secret_id**, which works like a password and can have an expiry and a usage limit.

```bash
vault auth enable approle

vault write auth/approle/role/app-payments \
    token_policies="payments" \
    token_ttl="20m" \
    token_max_ttl="1h" \
    secret_id_ttl="10m" \
    secret_id_num_uses=1

vault read auth/approle/role/app-payments/role-id
vault write -f auth/approle/role/app-payments/secret-id
```

The application exchanges the two parts for a token:

```bash
vault write auth/approle/login \
    role_id="<role_id>" \
    secret_id="<secret_id>"
```

The security of AppRole depends on how the two halves reach the application. The recommended design is for them to travel by different paths. The role_id can live in the image configuration, while the secret_id is delivered at deployment time by a trusted system, with a short lifetime and single use.

For this delivery, Vault offers response wrapping. Instead of returning the secret_id directly, it returns a single-use token that can only be opened once, within a short window:

```bash
vault write -wrap-ttl=60s -f auth/approle/role/app-payments/secret-id
```

If someone intercepts and opens that wrapping before the recipient, the application gets an error when trying to open it, which makes the interception detectable.

Even when well implemented, AppRole does not eliminate the secret zero. It makes it short-lived, single-use, and traceable, which is already a considerable improvement.

## OIDC: For People

For people, the natural source of trust is the identity provider the organization already uses. The OIDC method delegates authentication to it:

```bash
vault auth enable oidc

vault write auth/oidc/config \
    oidc_discovery_url="https://login.myorg.com" \
    oidc_client_id="vault" \
    oidc_client_secret="<client-secret>" \
    default_role="engineering"

vault write auth/oidc/role/engineering \
    user_claim="email" \
    groups_claim="groups" \
    allowed_redirect_uris="https://vault.myorg.com/ui/vault/auth/oidc/oidc/callback" \
    allowed_redirect_uris="http://localhost:8250/oidc/callback" \
    token_policies="engineering" \
    token_ttl="8h"
```

The engineer logs in through the browser, with the two-factor authentication and access rules the company already applies:

```bash
vault login -method=oidc
```

The main gain is in the lifecycle. When someone leaves the company and is deactivated in the identity provider, they lose access to Vault too, without anyone having to remember to do that in one more system.

## JWT: For CI Pipelines

The same principle applies to pipelines. The main CI platforms issue, for each run, a signed token describing the origin: repository, branch, environment, and the event that triggered the job.

The JWT method validates that token directly:

```bash
vault auth enable jwt

vault write auth/jwt/config \
    oidc_discovery_url="https://token.actions.githubusercontent.com" \
    bound_issuer="https://token.actions.githubusercontent.com"
```

The role restricts which runs can authenticate, based on the information contained in the token:

```bash
vault write auth/jwt/role/infra-deploy - <<EOF
{
  "role_type": "jwt",
  "user_claim": "repository",
  "bound_audiences": ["https://github.com/myorg"],
  "bound_claims": {
    "repository": "myorg/infrastructure",
    "ref": "refs/heads/main"
  },
  "token_policies": ["infra-deploy"],
  "token_ttl": "15m"
}
EOF
```

With this, only jobs running on the main branch of that repository receive a token, valid for fifteen minutes. There is no credential stored in the repository secrets, because the proof of identity is issued by the platform itself on each run.

This is the same pattern that appeared on the infrastructure execution side in [Dynamic Multi-Account Authentication: The End of Static Credentials in Terragrunt](/en/posts/dynamic-multi-account-authentication-the-end-of-static-credentials-in-terragrunt/). The pipeline obtains the token from Vault and, from it, the cloud credentials.

## Kubernetes Auth: For Pods

Inside a cluster, every pod already has an identity: the service account token, mounted automatically by Kubernetes. The Kubernetes authentication method takes advantage of that.

The configuration points to the cluster API:

```bash
vault auth enable kubernetes

vault write auth/kubernetes/config \
    kubernetes_host="https://kubernetes.default.svc:443"
```

When Vault runs inside the cluster itself, it uses the local certificate and token to talk to the API. Running outside, you need to provide the authority's certificate and a token with permission to review other tokens.

The role binds service accounts and namespaces to policies:

```bash
vault write auth/kubernetes/role/payments \
    bound_service_account_names="payments" \
    bound_service_account_namespaces="production" \
    audience="vault" \
    token_policies="payments" \
    token_ttl="1h"
```

At login, the pod sends its own service account token. Vault confirms its validity through the Kubernetes token review API, checks that the name and namespace match the role, and returns the token with the policies.

The result is authentication with no secret configured in the application. The identity comes from the platform, which is already responsible for guaranteeing that the pod is who it claims to be.

The audience attribute deserves attention. Without it, any valid token from that service account, issued for any purpose, works to authenticate to Vault. Restricting the audience requires that the token have been issued specifically for this use.

## Which Method for Which Client

The choice follows a simple rule: use the strongest identity the client's platform already offers.

- **People:** OIDC, tied to the corporate identity provider.
- **CI pipelines:** JWT, validating the token issued by the platform on each run.
- **Pods in Kubernetes:** the native Kubernetes method, based on the service account.
- **Cloud workloads:** the providers' own methods, which validate the identity of the instance or function.
- **Machines with no platform identity:** AppRole, with the two halves delivered separately.

Manually created tokens are reserved for administration and emergency situations.

## Conclusion

Secret zero does not disappear because a better vault was chosen. It disappears when the question of how the application proves who it is starts being answered by the platform where it runs, and not by a value stored somewhere.

Vault's authentication methods are, in practice, adapters for the different forms this platform identity takes. The corporate provider attests people, the CI issuer attests runs, Kubernetes attests pods.

AppRole holds a place apart in this list. It exists for the cases where no platform can attest anything, and it fulfills that role well. What is worth observing in a deployment is how many clients use AppRole out of necessity, and how many use it out of habit, when a stronger identity was available and nobody stopped to look.
