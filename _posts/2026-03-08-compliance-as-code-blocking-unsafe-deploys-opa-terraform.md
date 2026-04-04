---
title: "Compliance as Code: Blocking Unsafe Deploys with OPA (Open Policy Agent) and Terraform"
description: "Learn how to implement Compliance as Code with OPA (Open Policy Agent) and the Rego language to validate Terraform plans and automatically block unsafe infrastructure configurations before terraform apply."
date: 2026-03-08 19:00:00 -0300
lang: en
permalink: /en/posts/compliance-as-code-blocking-unsafe-deploys-opa-terraform/
categories: [Terraform, Security, DevSecOps]
tags: [Terraform, OPA, Open Policy Agent, Rego, Compliance as Code, Security]
icons: [terraform]
---

## Introduction

The scalability of Infrastructure as Code (IaC) adoption exposes a structural bottleneck in the deployment pipeline: security compliance validation. When multiple engineers submit Pull Requests with Terraform code daily, manual auditing via Code Review becomes an insufficient approach prone to critical omissions such as Security Groups with unrestricted ingress (`0.0.0.0/0`) or resources provisioned without mandatory governance tags.

The **Compliance as Code** paradigm solves this problem by replacing human reviews with declarative, executable, and deterministic policies coupled directly to the CI/CD pipeline. The industry-standard tool for this approach is **OPA (Open Policy Agent)**, a general-purpose policy engine graduated by the CNCF.

## What is OPA and the "Shift-Left" Concept

The Open Policy Agent (OPA) is a general-purpose policy engine. It decouples decision-making from execution. Instead of writing hardcoded security rules in your CI/CD scripts, you write declarative policies using OPA's own language called **Rego**.

Applying OPA in the Terraform pipeline means bringing security validation to the left (**Shift-Left**). Instead of waiting for the resource to be created in AWS for *AWS Security Hub* to trigger a vulnerability alert, OPA evaluates the "flight plan" and **blocks the pipeline before the resource even exists**.

## How Does OPA Work with Terraform?

Terraform does not natively interact with OPA in its standard execution. The integration is enabled by the JSON format. The architectural flow is:

1. Terraform analyzes the code and state, generating a binary plan (`terraform plan -out=tfplan`).
2. We convert that plan to a structured JSON representation (`terraform show -json tfplan > plan.json`).
3. We inject the JSON into OPA as **Input**.
4. OPA crosses the JSON with the **Policies (Rego)** and emits a decision: *Allow or Deny*.

## Blocking Unsafe Network Configurations

To demonstrate the practical implementation, we will use a common security directive as a use case: **no AWS Security Group can allow unrestricted inbound traffic (ingress) from any source (`0.0.0.0/0`)**.

### 1. Writing the Policy in Rego (`policy.rego`)

Rego is a query-based language. The logic of a `deny` block is: *if the conditions inside the braces are true, the rule has been violated and the message is added to the list of denials.*

```rego
package terraform.policies

# Define the denial rule
deny[msg] {
    # 1. Iterate over all resource changes in the Terraform plan
    resource := input.resource_changes[_]
    
    # 2. Filter only resources of type 'aws_security_group_rule'
    resource.type == "aws_security_group_rule"
    
    # 3. Filter only create or update actions
    resource.change.actions[_] == "create"
    
    # 4. Check if the rule type is 'ingress' (inbound)
    resource.change.after.type == "ingress"
    
    # 5. Check if any of the CIDR blocks is '0.0.0.0/0'
    resource.change.after.cidr_blocks[_] == "0.0.0.0/0"
    
    # If all lines above are true, format the error message:
    msg := sprintf("SECURITY VIOLATION: Rule '%s' allows unrestricted inbound traffic (0.0.0.0/0).", [resource.address])
}
```

### 2. Evaluating the Code (The CI/CD Pipeline)

In your GitHub Actions, GitLab CI, or Jenkins pipeline, the executed flow will be:

```bash
# 1. Generate the Terraform plan
terraform plan -out=tfplan

# 2. Convert the plan to JSON
terraform show -json tfplan > plan.json

# 3. Evaluate the plan against the Rego policy using the OPA binary
opa eval --format pretty --data policy.rego --input plan.json "data.terraform.policies.deny"
```

### 3. The Result

Given an `aws_security_group_rule` resource with open ingress to `0.0.0.0/0`, the OPA output will be:

```json
[
  "SECURITY VIOLATION: Rule 'aws_security_group_rule.web_ingress' allows unrestricted inbound traffic (0.0.0.0/0)."
]
```

In the pipeline, simply add a small script to check if the response array is empty. If it's not, the CI fails with `exit 1` and `terraform apply` is never executed.

## Conftest: The Developer's Tool

Writing and running native `opa eval` commands can be a bit cumbersome. For IaC pipelines, the ecosystem created **Conftest** (which runs the OPA engine under the hood).

With Conftest, the validation experience becomes as simple as running a linter:

```bash
conftest test plan.json -p policy.rego
```

Conftest output:

```
FAIL - plan.json - main - SECURITY VIOLATION: Rule 'aws_security_group_rule.web_ingress' allows unrestricted inbound traffic...
1 test, 1 passed, 0 warnings, 1 failure, 0 exceptions
```

## OPA vs. HashiCorp Sentinel

If you use Terraform Cloud/Enterprise, you already have **HashiCorp Sentinel**, which solves exactly the same problem. The downside of Sentinel is vendor lock-in and paid licensing.

OPA, on the other hand, is open source and universal. You can use the same Rego language to validate not just Terraform, but also Kubernetes manifests, API permissions, Envoy/Consul configurations, and Docker files. This unifies the Governance language for the entire company.

## Conclusion

Delegating the responsibility of security auditing to someone's memory or attention during a Code Review is a recipe for disaster (and data breaches).

By implementing Open Policy Agent, we transform security manuals in PDF format into executable and deterministic code. **Compliance as Code** not only protects the company against misguided infrastructure configurations, but gives developers immediate (and safe) feedback to correct their mistakes before even involving the Security team.
