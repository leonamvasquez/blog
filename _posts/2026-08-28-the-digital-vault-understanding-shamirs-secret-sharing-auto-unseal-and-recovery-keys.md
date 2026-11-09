---
title: "The Digital Vault: Understanding Shamir's Secret Sharing, Auto-Unseal, and Recovery Keys"
description: "How Vault protects its own master key: the key chain, the math of Shamir's Secret Sharing, the manual unseal process, auto-unseal with KMS, and the real role of recovery keys."
date: 2026-08-28 19:00:00 +0000
lang: en
permalink: /en/posts/the-digital-vault-understanding-shamirs-secret-sharing-auto-unseal-and-recovery-keys/
categories: [DevSecOps, Security, Vault]
tags: [Vault, Shamir, Unseal, KMS, Cryptography, DevSecOps]
icons: [vault]
---

## Introduction

Bank vaults often require two people to open. Each one knows half of the combination, and neither can open it alone. The rule does not exist because employees are dishonest, but because it eliminates the possibility that a single mistake, a single act of coercion, or a single ill-intentioned person is enough.

Vault applies the same principle to the key that protects all of its data, only with math in place of combinations split in half.

Understanding this mechanism is necessary to operate Vault in production. It determines what happens when a server restarts, who needs to be available at that moment, and what is lost irrecoverably if something goes wrong.

## The Sealed State

As we saw in the previous article in this series, everything Vault writes passes through a cryptographic barrier. The storage only receives encrypted data.

When the Vault process starts, it does not have in memory the key capable of decrypting that data. In this state, called **sealed**, it knows where the information is but cannot read it, and it refuses practically all requests.

Unsealing is the process of giving Vault the material needed to rebuild that key. As long as it keeps running, the key stays only in memory. If the process restarts, the cycle starts over.

## The Key Chain

Vault does not use a single key. It uses a chain, and each link protects the next.

The data is encrypted by an **encryption key**, which is kept in the storage itself, also encrypted. What encrypts the encryption key is the **root key**, which in turn is also stored encrypted. The root key is protected by the **unseal key**.

The reason for this indirection is operational. Changing the key that protects the data would require re-encrypting everything. With the chain, it is possible to change the top link, for example distributing new parts of the unseal key, without touching the data.

The remaining question is how to protect the last link. That is where Shamir comes in.

## The Math of Shamir

The method was published by Adi Shamir in 1979, in a paper with a direct title: "How to Share a Secret". The idea solves a precise problem: splitting a secret into several parts, so that any group with a minimum number of them reconstructs the secret, and any smaller group learns absolutely nothing.

The intuition comes from geometry. Two points determine a line. Three points determine a parabola. In general, k points are needed to determine a polynomial of degree k minus one.

The method works like this:

1. The secret becomes the constant term of a polynomial, the point where the curve crosses the vertical axis.
2. The remaining coefficients are chosen at random.
3. Each distributed part is a point on that curve.
4. With k points, the curve is reconstructed by interpolation, and the constant term reveals the secret.

The detail that makes the scheme secure lies in what happens with fewer points. With k minus one points, there is a curve compatible with every possible value of the secret. The information obtained is literally null, not just hard to exploit. The calculations take place over a finite field, which eliminates information leaks that would exist with real numbers.

## Initialization

The split happens only once, at initialization:

```bash
vault operator init -key-shares=5 -key-threshold=3
```

These are the default values: five parts, of which three rebuild the key. The output brings the five parts and the initial root token.

This output is the only moment when the parts appear together. If it is recorded in a terminal log, copied into a single document, or handed whole to one person, the scheme's protection ceases to exist. To avoid this risk, the command accepts the holders' PGP keys, and each part comes out encrypted for the person who will keep it:

```bash
vault operator init \
    -key-shares=5 \
    -key-threshold=3 \
    -pgp-keys="ana.asc,bruno.asc,carla.asc,diego.asc,elisa.asc"
```

## Manual Unseal

With Vault sealed, each holder provides their part:

```bash
vault operator unseal
```

The command asks for the part without displaying it. Progress shows up in the status:

```bash
vault status
```

When the threshold is reached, Vault rebuilds the key, decrypts the chain, and starts responding normally.

## The Operational Cost

This model has a cost that only shows up in operation. Every restart of every server requires three people, out of five, to be available and reachable.

That includes the restart at three in the morning, after an operating system update nobody remembered to coordinate. It includes the server that went down and came back on its own in another availability zone. It includes the holiday.

In environments where Vault is a dependency of every application, a sealed Vault is a general outage. Auto-unseal came about to deal with this.

## Auto-Unseal

In auto-unseal, protection of the root key is delegated to an external key management service, such as a cloud provider's KMS, an HSM, or another Vault with the Transit engine.

The configuration is a block in the server file:

```hcl
seal "awskms" {
  region     = "us-east-1"
  kms_key_id = "df68263c-d9ee-44e3-afca-83cfa370c605"
}
```

On startup, Vault asks the external service to decrypt the root key. If it has permission, it receives the result and unseals itself with no human intervention.

The change in trust has to be made explicit. With Shamir, security depends on a quorum of people. With auto-unseal, it depends on who has permission to use that key in the external service. The access policy for that key becomes one of the most critical controls in the whole infrastructure.

## Recovery Keys

When Vault is initialized with auto-unseal, it does not generate unseal keys. It generates **recovery keys**, also split by the Shamir scheme, with the same defaults of five parts and a threshold of three.

```bash
vault operator init -recovery-shares=5 -recovery-threshold=3
```

The name leads to a common mistake. Recovery keys are not used to unseal Vault. They authorize sensitive operations that still require a human quorum, such as generating a new root token.

The practical consequence is serious. If the external service's key is deleted, or if Vault permanently loses access to it, the recovery keys do not recover the data. The root key stays encrypted by a key that no longer exists. Protection against accidental deletion of that key, including the grace periods providers offer, stops being a configuration detail and becomes a continuity requirement.

## Choosing Between the Two

Manual unseal with Shamir makes sense when there is no trustworthy key service available, when the organization requires that no external party take part in protecting the key, or when the volume of restarts is low enough that human coordination is not a problem.

Auto-unseal makes sense in most cloud environments, where availability is critical and the provider's key service is already part of the trust base.

It is possible to migrate between the two models. The migration is a procedure of its own and deserves testing before being carried out in production.

## Conclusion

Vault's sealing mechanism is an answer to a question every secrets system has to face: who protects the key that protects everything?

There is no answer that eliminates the problem. Shamir distributes trust among people and charges in availability. Auto-unseal concentrates trust in a service and charges in dependency. The choice is about which of these failures your organization is better placed to prevent.

The most frequent mistake is not in choosing between the two, but in not noticing that a choice was made. Teams that enable auto-unseal without reviewing who has access to the KMS key end up with a vault whose real security is that of an IAM permission nobody is looking at.
