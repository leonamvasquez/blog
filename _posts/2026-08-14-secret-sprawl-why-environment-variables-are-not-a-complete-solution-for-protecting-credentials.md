---
title: "Secret Sprawl: Why Environment Variables Are Not a Complete Solution for Protecting Credentials"
description: "Understand what environment variables actually solve, where they stop, and which three attributes are missing for a credential to be truly managed: expiration, scope, and auditing."
date: 2026-08-14 19:00:00 +0000
lang: en
permalink: /en/posts/secret-sprawl-why-environment-variables-are-not-a-complete-solution-for-protecting-credentials/
categories: [DevSecOps, Security, Vault]
tags: [Secrets, DevSecOps, Vault, Security, 12-Factor, DevOps]
icons: [vault]
---

## Introduction

Taking the password out of the code and putting it in an environment variable is real progress. It leaves the Git history, stops showing up in code reviews, and varies by environment without the code changing.

This practice became established for good reasons, and the recommendation to separate configuration from code remains valid.

The problem is that most teams treat this step as the final solution. The credential left the repository, so it is protected. In practice, it only changed places, and the new place has properties that are rarely examined.

## What the Variable Solves

It is worth being fair to the mechanism before criticizing it, because it solves concrete things.

The environment variable separates the value from the code. It lets the same image or the same artifact run in different environments. It avoids the worst scenario, which is a credential versioned and distributed to everyone who clones the repository.

None of that is small. The point of this article is not that the practice is wrong, but that it covers only the first layer of a problem with several.

## Where It Stops

The exposures that remain tend to surprise people who have never stopped to list them.

**Child processes inherit everything.** Any process launched from yours inherits the entire environment. A helper script, a build tool, a library that runs an external command: all of them receive the credential, even if they have nothing to do with it.

**The environment is readable on the system.** On Linux systems, a process's environment is accessible through the virtual filesystem. Access is restricted to the process owner and the administrator user, which is already a protection, but it means anything running as that identity sees the value.

**Inspection tools show everything.** The command that inspects a container displays the defined variables. So does a pod specification in an orchestrator. Whoever has permission to list those objects has the credential.

**Logs and failures leak the environment.** Stack traces, error reports, and debug output frequently dump the complete environment. All it takes is one library with verbose logging for the credential to appear in an observability system that far more people can access.

**The scope is the entire process.** There is no granularity. If the application needs a credential for one specific operation, that credential stays visible throughout the whole execution, to all the code, including third-party dependencies you did not write.

## The Term: Secret Sprawl

The sum of these characteristics produces the phenomenon that gives the article its name.

**Secret sprawl** is the uncontrolled dispersion of credentials. The same password ends up replicated in the CI configuration, in the orchestrator's secrets manager, in a developer's local file, in a note in the internal documentation, and in an old chat conversation.

None of these copies is recorded anywhere. When the time comes to rotate the credential, the question that stalls everything is simple and unanswerable: where is it in use?

The typical result is the rotation that never happens. The team knows it should change it, does not know what will break, and the credential stays valid indefinitely.

## The Three Missing Attributes

To see the problem clearly, it helps to compare it with what a well-managed credential offers.

**Expiration.** An environment variable has no deadline. The value holds until someone decides to change it, which depends on human discipline instead of a mechanism. A credential with a short lifetime turns a leak into a temporary problem.

**Scope.** The value in the variable is the same for every use. There is no way to grant read permission for one path and write permission for another, or to restrict by operation. The credential carries all the power it has, always.

**Auditing.** There is no record of who read the variable, when, or for what. After an incident, there is no way to determine whether the credential was actually misused or merely exposed.

This triad is a useful criterion. When all three are missing, what you have is a stored value, not a managed credential.

## What Comes Next

The mature answer is not to store the same value in a better place, but to change the nature of the credential.

Three moves, in order of maturity:

1. **Centralize.** A secrets vault becomes the single source, with access control and read logging. The secret is still static, but at least there is an answer to where it is.
2. **Make it dynamic.** Instead of storing a password, the system generates a credential on demand, with a short lifetime and tied to whoever asked. Rotation stops being a task and becomes the default behavior.
3. **Eliminate the secret.** The workload proves its identity by another means and exchanges that proof for temporary access. There is no value to store, leak, or rotate.

This third stage has already appeared here in two different contexts. On the infrastructure execution side, in [Dynamic Multi-Account Authentication: The End of Static Credentials in Terragrunt](/en/posts/dynamic-multi-account-authentication-the-end-of-static-credentials-in-terragrunt/). On the state side, in [Ephemeral Values: How OpenTofu Handles Secrets That Never Hit State](/en/posts/ephemeral-values-how-opentofu-handles-secrets-that-never-hit-state/).

The principle is the same in both cases, and it will be the common thread of the next articles in this series.

## When the Variable Still Fits

To be honest, it still has a place.

For local development, with toy credentials pointing at test services, the added complexity is rarely justified. For configuration that is not sensitive, such as region, log level, or environment name, the variable is exactly the right tool.

And there is one case where it stays even in the mature architecture: as the last hop. A vault obtains the dynamic credential and injects it into the process through the environment, at execution time. The difference is in the origin and the lifetime, not in the delivery mechanism.

The distinction that matters is not whether the credential passes through the environment, but whether it was born there and is going to stay there.

## Conclusion

A good share of the security practices we adopt solve the visible problem and leave the structural problem intact. Taking the password out of the code eliminates the most obvious exposure and creates the feeling that the matter is closed.

The question that reveals whether it really is closed is direct: if this credential leaked right now, how long would it take you to find out, and what would need to be done?

When the answer involves discovering every place it was copied, hoping nothing breaks, and having no way to verify whether it was misused, the problem has not been solved. It has been moved somewhere it bothers you less, which is a different outcome and a much less comfortable one than it usually seems.
