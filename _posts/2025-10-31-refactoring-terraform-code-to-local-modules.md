---
title: "Refactoring Terraform Code: How and Why to Abstract Monoliths to Local Modules"
description: "How to create local Terraform modules to organize and reuse code. Learn to refactor monolithic configurations into reusable modules with practical examples and terraform state mv."
date: 2025-10-31 08:00:00 +0000
lang: en
permalink: /en/posts/refactoring-terraform-code-to-local-modules/
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, Terraform Modules, Refactoring, Terraform State, Terraform Tutorial, HashiCorp, Best Practices]
icons: [terraform]
---

## Introduction

It's common for Terraform projects to start simply: a single directory with `main.tf`, `variables.tf`, and `outputs.tf` files. For small infrastructures, this approach works. However, as the environment grows, this root directory transforms into a "monolith" — a `main.tf` file with hundreds or thousands of lines defining all infrastructure, from network to applications.

This monolith quickly becomes hard to maintain, complex to navigate, and dangerous to modify. A small change to a security group might accidentally affect a load balancer.

The solution is refactoring. The first and most important step is decomposing this monolith into local modules. This article is a practical guide on why this abstraction is necessary and how to execute it safely, without causing downtime or recreating resources.

## Why Refactor a Terraform Monolith?

Abstracting monolithic code to local modules is not just a matter of organization; it's a fundamental engineering practice that brings direct benefits:

- **Readability and Maintenance:** It's easier to understand and maintain a focused module (`./modules/vpc`) than navigating a 2000-line `main.tf` file.
- **Complexity Abstraction:** Modules hide implementation details. The root module simply consumes the module, passing necessary variables, without needing to know how internal resources are configured.
- **Reusability (DRY Principle):** Even being local, modules can be reused. If you need two environments (dev and staging) in the same root configuration, you can instantiate the same module twice with different variables.
- **Blast Radius Reduction:** Isolating resources in modules decreases the risk of interdependent changes. A modification to the network module is less likely to affect the application module, facilitating review and change application.

## The Strategy: Local Modules

A local module is simply a directory in the same repository, referenced by a relative path (`./modules/my-module`). This is the simplest form of modularization, serving as a foundation before considering remote modules (via Git or Registry).

### "Before" Structure (Monolith):

```
.
├── main.tf       # (Defines VPC, subnets, security groups, EC2, LB...)
├── variables.tf
└── outputs.tf
```

### "After" Structure (Modularized):

```
.
├── main.tf       # (Now only calls modules)
├── variables.tf  # (Variables for root module)
├── outputs.tf    # (Global outputs)
└── modules/
    ├── vpc/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── web-app/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

## The Refactoring Process: A Practical Guide

The most sensitive part of refactoring is ensuring Terraform understands you're moving resources, not destroying and recreating them. This is done with the `terraform state mv` command.

Let's refactor an `aws_security_group` from a monolithic `main.tf`.

### Step 1: Identify Logic for Abstraction

In the root `main.tf`, we identify a logical resource, like a security group for a web application:

```terraform
variable "vpc_id" { type = string }

resource "aws_security_group" "web_sg" {
  name        = "web-app-sg"
  description = "Allows HTTP and HTTPS traffic"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "web_server" {
  # ...
  vpc_security_group_ids = [aws_security_group.web_sg.id]
}
```

### Step 2: Create Module Structure

We create the directory and standard files for the new module:

```bash
mkdir -p modules/security-group
touch modules/security-group/main.tf
```

### Step 3: Move the `resource` Block

We cut the `resource "aws_security_group" "web_sg"` block from root `main.tf` and paste it into `modules/security-group/main.tf`.

### Step 4: Define the "API" (Variables and Outputs)

#### Variables

The moved resource referenced `var.vpc_id`. This should become an input variable for the module.

```terraform
variable "vpc_id" {
  description = "VPC ID where the SG will be created."
  type        = string
}
```

#### Outputs

The `aws_instance.web_server` resource (which stayed in root) referenced `aws_security_group.web_sg.id`. This should become a module output.

```terraform
output "sg_id" {
  description = "The security group ID created."
  value       = aws_security_group.web_sg.id
}
```

### Step 5: Call the Module in Root

In root `main.tf`, we remove the old resource and add the module call. We also update `aws_instance` to use the module output:

```terraform
variable "vpc_id" { type = string }

module "web_sg" {
  source = "./modules/security-group"

  vpc_id = var.vpc_id
}

resource "aws_instance" "web_server" {
  # ...
  vpc_security_group_ids = [module.web_sg.sg_id]
}
```

### Step 6: Move State (The Critical Step)

If we run `terraform plan` now, Terraform will try to destroy `aws_security_group.web_sg` and create `module.web_sg.aws_security_group.web_sg`, causing downtime.

To avoid this, we inform Terraform that the resource was just moved. We use `terraform state mv` to move the resource address in the state file.

```bash
terraform state mv \
  aws_security_group.web_sg \
  module.web_sg.aws_security_group.web_sg
```

### Step 7: Validate Refactoring

After moving state, run `terraform plan`. Expected output should be:

```
No changes. Your infrastructure is up-to-date.
```

This confirms Terraform now manages the resource at its new code location, without needing to destroy or recreate it. Refactoring was completed successfully without infrastructure impact.

## Conclusion

Refactoring a Terraform monolith to local modules is an investment in the health and scalability of your IaC project. While the process requires care, especially when manipulating state with `terraform state mv`, the benefits in readability, maintenance, and risk reduction are immediate.

Mastering decomposition into local modules is the foundation for more advanced Infrastructure as Code practices, like creating reusable modules and managing complex environments.
