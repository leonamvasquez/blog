---
title: "Managing Multiple Environments (Dev, Stage, Prod) with Terraform and Terragrunt"
description: "Learn how to manage multiple environments with Terraform and Terragrunt. Complete tutorial on DRY patterns, remote state management and multi-environment infrastructure."
date: 2025-11-12 18:43:52 +0000
lang: en
permalink: /en/posts/managing-multiple-environments-terraform-terragrunt/
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, Terragrunt, Multi-Environment, DRY, Remote State, Terraform Tutorial, HashiCorp, AWS]
icons: [terraform]
---

## Introduction

Managing a single infrastructure environment with Terraform is a straightforward process. However, in any professional scenario, infrastructure is divided into multiple environments, such as development (dev), staging (stage), and production (prod). This division is fundamental for testing, security, and stability.

Managing multiple environments introduces significant challenges: how to keep configurations consistent, avoid code repetition, and ensure total isolation of each environment's state?

This article explores approaches to this problem, comparing Terraform's native solution (directory-based) with the automation and DRY (Don't Repeat Yourself) benefits provided by Terragrunt.

## 1. The Challenge: Multiple Environments in Native Terraform

There are two ways to manage environments in native Terraform.

### Approach 1: Terraform Workspaces

Many beginners turn to `terraform workspace`. While it may seem like the solution, workspaces are not recommended for environment separation. They share the same state backend (by default) and force excessive conditional logic (`var.env == "prod" ? ... : ...`) in the same code, making it complex and fragile. Industry standard practice avoids workspaces for this purpose.

### Approach 2: The Directory Pattern

The correct native approach is using a directory structure, where each environment is a separate root module.

```
.
└── environments/
    ├── dev/
    │   ├── main.tf
    │   ├── terraform.tfvars
    │   └── backend.tf      # Isolated state for dev
    ├── stage/
    │   ├── main.tf
    │   ├── terraform.tfvars
    │   └── backend.tf      # Isolated state for stage
    └── prod/
        ├── main.tf
        ├── terraform.tfvars
        └── backend.tf      # Isolated state for prod
```

**Problem (Boilerplate):** This solution is robust in terms of isolation but suffers from a major repetition problem. The `backend.tf` file, provider configurations, and often the module calls themselves are 90% identical and need to be copied and pasted across all environment directories.

If you need to update the provider version or S3 bucket backend configuration, you must do it in all directories. This is inefficient and error-prone.

## 2. What is Terragrunt?

Terragrunt is a wrapper for Terraform. It doesn't replace Terraform; it orchestrates it. Terragrunt was created specifically to solve code repetition and state management problems in multiple environments.

Its main goal is to keep your Terraform configurations **DRY (Don't Repeat Yourself)**.

## 3. Terragrunt in Action: The DRY Principle

Terragrunt introduces a `terragrunt.hcl` configuration file and uses a hierarchy structure to drastically reduce boilerplate.

Let's revisit our directory structure, now with Terragrunt:

```
.
├── terragrunt.hcl      # ROOT configuration (DRY)
└── environments/
    ├── dev/
    │   └── app/
    │       └── terragrunt.hcl
    ├── stage/
    │   └── app/
    │       └── terragrunt.hcl
    └── prod/
        └── app/
            └── terragrunt.hcl
```

### Root Configuration (`/terragrunt.hcl`)

At root level, we define once how our backend (remote state) should be configured.

```hcl
remote_state {
  backend = "s3"
  config = {
    encrypt        = true
    bucket         = "my-central-terraform-state-bucket"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-state-lock"
  }

  generate = {
    path      = "backend.tf"
    if_exists = "overwrite"
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "us-east-1"
}
EOF
}
```

### Environment Configuration (`/environments/prod/app/terragrunt.hcl`)

Now, the configuration file for the production application becomes incredibly lean:

```hcl
include {
  path = find_in_parent_folders()
}

remote_state {
  config = {
    key = "${path_relative_to_include()}/terraform.tfstate"
  }
}

terraform {
  source = "github.com/my-modules/terraform-aws-app?ref=v1.2.0"
}

inputs = {
  instance_type = "t3.large"
  environment   = "production"
  min_size      = 5
}
```

When you run `terragrunt apply` in this directory, Terragrunt will:

1. Read root `terragrunt.hcl` and configure S3 backend.
2. Generate S3 key as `environments/prod/app/terraform.tfstate`, ensuring isolation.
3. Download module from `terraform { source ... }`.
4. Execute `terraform apply` passing production `inputs` (variables).

If you need to change the S3 backend bucket, you do it in one place: the root `terragrunt.hcl`.

## 4. Additional Terragrunt Benefits

DRY is the main benefit, but Terragrunt offers more:

**Dependency Management:** Native Terraform doesn't know how to "wait." If your application depends on a VPC, you need to apply them in separate orders. Terragrunt solves this with `dependency` blocks, allowing the app module to declare it depends on the vpc module and read its outputs.

**Multiple Execution:** With dependencies defined, you can go to the root directory (`/environments/prod`) and run `terragrunt run-all apply`. Terragrunt will calculate the dependency graph and apply all modules (VPC, database, app) in correct order.

## Conclusion

Native Terraform, using the directory pattern, can manage multiple environments, but at the cost of high manual workload and code repetition. This is viable for small projects but becomes a maintenance bottleneck in larger systems.

Terragrunt excels by solving exactly this problem. It doesn't replace Terraform but complements it, enforcing DRY practices and providing automation for state and dependency management.

For teams seeking to scale their IaC practices consistently and safely across multiple environments, Terragrunt adds an orchestration layer that justifies its learning curve.
