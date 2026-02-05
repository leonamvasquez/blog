---
title: "Infrastructure as Software: Applying TDD (Test Driven Development) to Terraform Modules"
description: "Learn how to apply Test Driven Development (TDD) to Terraform modules using the native terraform test framework. Complete guide with mocks, unit tests, and integration tests in HCL."
date: 2026-02-04 23:16:39 -0300
lang: en
permalink: /en/posts/infrastructure-as-software-tdd-terraform/
categories: [Terraform, Engineering, Quality Assurance]
tags: [Terraform, TDD, IaC, Automation, DevOps, Testing]
icons: [terraform]
---

## Introduction

For a long time, the term "Infrastructure as Code" (IaC) was taken literally only in the coding aspect, while frequently ignoring the **Software Quality** part.

While application developers would never ship code to production without a battery of unit tests, platform engineers often rely solely on visual validation of `terraform plan`. This creates a slow feedback loop, prone to human error.

With the maturation of the **Terraform Test Framework**, HashiCorp changed this game. We now have native HCL syntax for validations, mocks, and test orchestration.

This means we can finally apply **TDD (Test Driven Development)** to our infrastructure, without needing to learn Go or Python, and without depending on external frameworks.

## The New Mental Model: Unit vs. Integration

To apply TDD to infrastructure, we need to separate tests into two categories, natively supported by the framework:

1.  **Unit Tests (Plan & Mock):** Validate the **logic** of your code (conditionals, `for_each`, variable validation). They run in memory, are instantaneous, and **generate no cloud costs**, as they mock the provider API.
2.  **Integration Tests (Apply):** Validate **effectiveness**. They provision real resources in the cloud, verify the API accepted the configuration, and destroy them afterward.

## Practical Tutorial: The TDD Cycle

Starting from the premise that we want to build a secure S3 module strictly following the **Red-Green-Refactor** cycle.

**The Scenario:** We need to create an S3 bucket module with a non-negotiable compliance rule:
* If the environment is `prod`, versioning **must** be enabled (`Enabled`).
* If the environment is `dev`, versioning **must** be suspended (`Suspended`) to reduce costs.

### Step 1: RED (Writing the Test First)

In TDD, we start by describing the expected behavior *before* implementing the resource. The test should fail.

Create the file `tests/compliance.tftest.hcl`.

> **Important:** The `.tftest.hcl` extension is **mandatory** for Terraform to recognize the file as part of the test framework.

> **Tip:** Using `mock_provider` is the secret to fast TDD. It allows testing logic without AWS credentials.

```hcl
# tests/compliance.tftest.hcl

# We isolate the test from the real AWS API
mock_provider "aws" {}

# Global variables for tests
variables {
  bucket_name = "tdd-bucket-placeholder"
}

# Scenario 1: Development Environment
run "validate_dev_rule" {
  command = plan

  variables {
    env = "dev"
  }

  # Assertion: We verify the internal logic of the plan
  # The one() function extracts the single element from a list/set,
  # useful when the block returns a configuration collection.
  assert {
    condition     = one(aws_s3_bucket_versioning.this.versioning_configuration).status == "Suspended"
    error_message = "Compliance Error: DEV environments should not have versioning enabled."
  }
}

# Scenario 2: Production Environment
run "validate_prod_rule" {
  command = plan

  variables {
    env = "prod"
  }

  assert {
    condition     = one(aws_s3_bucket_versioning.this.versioning_configuration).status == "Enabled"
    error_message = "Compliance Error: PROD environments MUST have versioning enabled."
  }
}

# Scenario 3: Input Validation - Invalid Environment
run "reject_invalid_environment" {
  command = plan

  variables {
    env = "staging"  # Not allowed value
  }

  # expect_failures indicates we expect a validation failure
  expect_failures = [var.env]
}
```

When running `terraform test`, the result will be failure, since we haven't coded the logic yet. This is the **RED** state.

### Step 2: GREEN (Implementing the Logic)

Now, we write the minimum HCL code necessary to satisfy the tests.

File `providers.tf`:

```hcl
# providers.tf
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}
```

File `main.tf`:

```hcl
# main.tf
variable "bucket_name" {
  type        = string
  description = "Unique S3 bucket name"
}

variable "env" {
  type        = string
  description = "Deployment environment (dev or prod)"

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "The 'env' value must be 'dev' or 'prod'."
  }
}

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    # Implementation of the tested Business Logic
    status = var.env == "prod" ? "Enabled" : "Suspended"
  }
}
```

Now, run the command again:

```bash
$ terraform test

tests/compliance.tftest.hcl
  validate_dev_rule          [pass]
  validate_prod_rule         [pass]
  reject_invalid_environment [pass]

3 tests passed.
```

**GREEN state achieved!** We validated the business logic in milliseconds, without creating anything on AWS.

### Step 3: Expanding with Integration Tests

Mocks are excellent for logic, but they don't guarantee that AWS will accept the bucket name or that the region supports the resource. For greater reliability, we add an integration test that uses the real API.

First, create the helper module `tests/setup/main.tf` that generates a unique ID to avoid name conflicts:

```hcl
# tests/setup/main.tf
terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

resource "random_id" "this" {
  byte_length = 4
}

output "random_id" {
  value = random_id.this.hex
}
```

Now, create the file `tests/integration.tftest.hcl`. Note that here we don't use `mock_provider` and change the command to `apply`.

```hcl
# tests/integration.tftest.hcl

# Helper: Auxiliary module to generate random ID (avoids S3 name conflicts)
run "setup" {
  module {
    source = "./setup"
  }
}

run "real_e2e_provisioning" {
  command = apply

  variables {
    # We use the output from the previous step to generate a unique name
    bucket_name = "tdd-integration-${run.setup.random_id}"
    env         = "dev"
  }

  # We validate an attribute that only exists AFTER AWS creates the resource (Computed)
  assert {
    condition     = startswith(aws_s3_bucket.this.arn, "arn:aws:s3:::")
    error_message = "The bucket ARN was not correctly generated by AWS"
  }
}
```

When running `terraform test` now, the framework will:

1. Run the unit tests (Mock) first.
2. If they pass, it will run the `setup`.
3. Run `real_e2e_provisioning` (doing the Apply on AWS).
4. Execute the assertions.
5. Execute automatic `destroy` to clean up the account.

## Advanced Tips

### Filtering Tests

To run only a specific file or scenario:

```bash
# Run only unit tests (mocks)
terraform test -filter=tests/compliance.tftest.hcl

# Run only integration tests
terraform test -filter=tests/integration.tftest.hcl
```

### Verbose Mode

For detailed test debugging:

```bash
terraform test -verbose
```

## Engineering Strategy

Terraform Test adoption should follow a pyramid:

**Base (80%): Unit Tests with Mocks.**
* Validate conditionals, variable validations, complex locals, and compliance rules.
* Run on every Pull Request.
* Zero cost and immediate feedback.

**Top (20%): Integration Tests.**
* Validate successful creation of critical or complex resources (e.g., VPC Peering, K8s Cluster Creation).
* Run on merges to `main` or on nightly schedules.
* Ensure Cloud API contracts haven't changed.

## Conclusion

`terraform test` democratized code quality in infrastructure. It's no longer necessary to be a Go expert to ensure your module works.

By adopting TDD in Terraform, you shift error discovery to the left (Shift-Left), reduce cloud costs from deployment failures, and deliver a much more reliable platform for your developers.
