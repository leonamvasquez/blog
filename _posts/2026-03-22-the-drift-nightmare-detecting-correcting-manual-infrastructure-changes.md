---
title: "The Drift Nightmare: How to Detect and Correct Manual Infrastructure Changes"
description: "Understand the Configuration Drift phenomenon in Terraform-managed infrastructures, learn how to build automated detection pipelines with -detailed-exitcode, and implement remediation strategies and structural prevention via GitOps."
date: 2026-03-22 19:00:00 -0300
lang: en
permalink: /en/posts/the-drift-nightmare-detecting-correcting-manual-infrastructure-changes/
categories: [Terraform, Platform Engineering, SRE]
tags: [Terraform, Configuration Drift, IaC, GitOps, SRE, Automation]
icons: [terraform]
---

## Introduction

In large-scale architectures, the fundamental premise of Infrastructure as Code (IaC) is the guarantee of determinism: the code present in the main branch must be the single source of truth for the cloud topology.

However, operational reality often collides with this principle. Emergency interventions during incidents, manual adjustments via the console, or legacy scripts acting *out-of-band* introduce a phenomenon known as **Configuration Drift**.

Drift occurs when there is a structural divergence between the real state provisioned in the Cloud Provider (AWS, Azure, GCP) and the state declared and mapped in `terraform.tfstate`. If not detected and handled proactively, Drift corrupts the reliability of the IaC pipeline, making the next `terraform apply` a high-risk, unpredictable, and potentially destructive operation.

## The State Trichotomy in Terraform

To mitigate Drift, it is essential to understand how Terraform evaluates reality. The reconciliation cycle operates on three pillars:

1.  **Declared State:** The HCL code in the `.tf` files.
2.  **Registered State:** The state file (`terraform.tfstate`), which acts as a cache of the last successful mapping.
3.  **Real State:** The current physical and logical configuration in the cloud provider's API.

Drift manifests essentially as the unintentional delta between the **Real State** and the **Registered State**.

## Architecting a Continuous Detection Pipeline

Drift detection should not depend on the occasional execution of a `terraform plan` before a new deployment. Maturity in Platform Engineering requires continuous automation.

The standard implementation consists of a scheduled job (Cron) in the CI/CD pipeline dedicated exclusively to state reconciliation. The technical core of this automation lies in Terraform's `-detailed-exitcode` parameter, which modifies the exit behavior of the `plan` command:

-   **Exit Code 0:** Success with no changes. The infrastructure is in full compliance with the code (Zero Drift).
-   **Exit Code 1:** Execution error (syntax failure, invalid credentials).
-   **Exit Code 2:** Success, but **there are pending changes**. In a scheduled job with no new code, this is the technical signal of Drift.

### Anatomy of a Detection Job

```yaml
name: IaC Configuration Drift Detection
on:
  schedule:
    - cron: '0 8 * * *' # Daily execution at 08:00

jobs:
  drift-detection:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v2

      - name: Terraform Init
        run: terraform init

      - name: Drift Check (Plan)
        id: plan
        # The '|| true' prevents the pipeline from breaking on exit code 2,
        # allowing explicit handling in the next step
        run: |
          terraform plan -detailed-exitcode -out=tfplan || export exitcode=$?
          echo "exitcode=$exitcode" >> $GITHUB_OUTPUT

      - name: Alert via Slack/Teams
        if: steps.plan.outputs.exitcode == '2'
        run: |
          echo "CRITICAL ALERT: Configuration Drift detected in production."
          # Script to trigger webhook for the SRE team
```

## Remediation Strategies

Once detected, Drift requires an engineering decision. There are two paths to restore state integrity:

### 1. Punitive Remediation (Overwrite)

If the manual change was undue or malicious (e.g., opening a port in the Security Group without going through review), the correct action is to force the desired state by overwriting the change.

Running a `terraform apply` from the main branch reverts the cloud configurations to reflect exactly what is in the HCL code.

### 2. Reconciliation and Adoption (Adopt)

If the manual change was a legitimate incident mitigation (e.g., increasing database IOPS capacity), reverting the change via code would cause service degradation.

In this scenario, the infrastructure is correct, but the code is outdated. Remediation involves:

1.  Update the HCL code to reflect the new values (e.g., change from `iops = 3000` to `iops = 10000`).
2.  Run `terraform plan -refresh-only` to update the `tfstate` with the cloud reality.
3.  Run a `terraform apply` that will result in no physical changes, but will confirm synchronicity between code and cloud.

## Structural Prevention: Towards GitOps

Drift detection is a treatment of the symptom. The root cause treatment lies in the access and identity architecture (IAM).

To eradicate Drift in production environments, organizations must transition to a rigorous GitOps model where:

-   Human engineers only have `ReadOnlyAccess` permissions in the cloud console.
-   The exclusivity of write (Write/Mutate) operations is delegated to the IAM Role assumed by the CI/CD pipeline runners.

## Conclusion

The tolerated presence of Configuration Drift erodes the foundations of Infrastructure as Code, reducing Terraform from a deterministic architecture engine to a mere initial provisioning tool.

By establishing automated detection pipelines based on `-detailed-exitcode` and enforcing strict cloud access policies, SRE and Platform teams ensure that the code repository remains unquestionably the single source of truth.
