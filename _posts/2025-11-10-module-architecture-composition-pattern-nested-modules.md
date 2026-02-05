---
title: "Module Architecture: The Composition Pattern (Nested Modules)"
description: "Learn the nested module composition pattern in Terraform. Tutorial on creating high-level modules that orchestrate low-level modules for scalable and reusable infrastructure."
date: 2025-11-06 20:00:00 +0000
lang: en
permalink: /en/posts/module-architecture-composition-pattern-nested-modules/
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, Terraform Modules, Nested Modules, Terraform Architecture, Composition, Terraform Tutorial, HashiCorp, Best Practices]
icons: [terraform]
---

## Introduction

Refactoring Terraform code into local modules is an essential step for maintainability. However, as infrastructure grows, a new complexity challenge can arise in the root module, which becomes responsible for orchestrating dozens of smaller modules.

The next level of architectural maturity is module composition. This is a pattern where larger, logical modules orchestrate smaller modules, each with a single responsibility. Instead of a complex root module calling vpc, alb, and security-group modules separately, we create a "composition" module (e.g., web-app-stack) that groups and interconnects them.

This article explores this nested module architecture, detailing how to implement it and the benefits of clarity, abstraction, and reuse it provides to complex IaC projects.

## 1. What is Module Composition (Nested Modules)?

Module composition, or nesting, occurs when a Terraform module calls another Terraform module. Instead of a "flat" architecture where the root module calls all others, we create a hierarchy.

We can classify modules into three levels:

- **Infrastructure Module (low level):** Small modules with single responsibility. E.g.: vpc-module, security-group-module, ec2-instance-module.
- **Composition Module (mid level):** A module that groups and interconnects various infrastructure modules to create a logical "stack." E.g.: web-app-stack-module, database-stack-module.
- **Root Module (high level):** The main module that defines a specific environment (production, development) and calls the necessary composition modules to provision that environment's infrastructure.

This structure allows the root module to abstract complexity. It simply requests a "web application stack," without needing to know the details of the VPC or security groups that compose it.

## 2. Benefits of Module Composition

Adopting the composition pattern offers significant engineering advantages:

- **Expanded Reusability:** Smaller infrastructure modules (like security-group) can be reused across different composition modules.
- **Clarity and Readability:** Architecture becomes clearer. The root module reflects logical design (e.g., web-app, database), while composition modules handle implementation details.
- **Multi-layer Abstraction:** Complexity is managed at levels. The root module doesn't need to know which VPC outputs should connect to ALB inputs; the composition module handles this "glue."
- **Maintainability and Reduced Blast Radius:** Changes to an infrastructure module (e.g., vpc) are tested and applied within the context of composition modules that use it, facilitating maintenance and isolating failures.

## 3. Implementing a Composition Pattern: Practical Example

Let's illustrate composition with an example of a "Web App Stack" that uses infrastructure modules for VPC and Security Group.

### Project Structure:

```
.
├── environments/
│   └── production/
│       └── main.tf        # Root Module (defines production environment)
└── modules/
    ├── web-app-stack/   # Composition Module
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── vpc/             # Infrastructure Module (VPC)
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── security-group/  # Infrastructure Module (Security Group)
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

### 3.1. Infrastructure Module: `vpc/`

Defines a VPC and its subnets.

#### `modules/vpc/variables.tf`

```terraform
variable "vpc_cidr" {
  description = "VPC CIDR block."
  type        = string
}
```

#### `modules/vpc/main.tf`

```terraform
resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
}
```

#### `modules/vpc/outputs.tf`

```terraform
output "vpc_id" {
  description = "Created VPC ID."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs."
  value       = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}
```

### 3.2. Infrastructure Module: `security-group/`

Creates a Security Group.

#### `modules/security-group/variables.tf`

```terraform
variable "vpc_id" {
  description = "VPC ID to associate the SG."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for SG name."
  type        = string
}
```

#### `modules/security-group/main.tf`

```terraform
resource "aws_security_group" "app_sg" {
  name   = "${var.name_prefix}-app-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

### 3.3. Composition Module: `web-app-stack/`

This module orchestrates VPC and Security Group creation.

#### `modules/web-app-stack/variables.tf`

```terraform
variable "env" {
  description = "Environment (e.g., prod, dev)."
  type        = string
}

variable "project_name" {
  description = "Project name."
  type        = string
}

variable "vpc_cidr_block" {
  description = "CIDR for stack VPC."
  type        = string
}
```

#### `modules/web-app-stack/main.tf`

```terraform
module "vpc" {
  source = "../vpc"
  vpc_cidr = var.vpc_cidr_block
}

module "app_sg" {
  source = "../security-group"
  vpc_id      = module.vpc.vpc_id
  name_prefix = "${var.project_name}-${var.env}"
}
```

### 3.4. Root Module: `environments/production/main.tf`

```terraform
terraform {
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

module "production_web_app" {
  source = "../../modules/web-app-stack"

  env            = "prod"
  project_name   = "MyProject"
  vpc_cidr_block = "10.10.0.0/16"
}

output "production_vpc_id" {
  value = module.production_web_app.web_app_vpc_id
}
```

## Conclusion

The module composition pattern is a pillar of Infrastructure as Code architecture at scale. By decomposing large infrastructures into smaller modules and orchestrating them through composition modules, code achieves superior levels of abstraction, reuse, and maintainability.

This approach not only makes Terraform code more readable and manageable but also ensures consistency and reduces risk in complex projects, enabling teams to build and evolve their infrastructures more efficiently and predictably.
