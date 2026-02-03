---
title: "Terraform Beyond the Basics: Using count, for_each and Conditional Expressions"
description: "Learn how to use count, for_each and conditional expressions in Terraform. Practical tutorial with code examples to create dynamic and scalable configurations following IaC best practices."
date: 2025-10-23 08:00:00 +0000
lang: en
permalink: /en/posts/terraform-beyond-basics-count-foreach-conditionals/
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, Terraform count, Terraform for_each, Terraform Conditionals, Terraform Tutorial, Best Practices, HCL]
---

## Introduction

Static resource declaration is the starting point in Terraform. One resource block defines a VM, another defines a bucket, and so on. While functional for simple setups, this approach quickly becomes impractical in complex scenarios, leading to code repetition and maintenance difficulty.

There are more efficient methods to apply logic and create dynamic, scalable configurations. The transition from manual and repetitive configurations to intelligent automation is enabled primarily by three mechanisms: the `count` and `for_each` meta-arguments, and conditional expressions.

This article demonstrates how to use these tools to manage multiple resources, implement conditional logic, and write efficient, reusable IaC code following best practices.

## 1. The count Meta-Argument

`count` allows creating multiple instances of a resource from a single code block. It accepts a numeric value and generates that number of identical copies of the resource.

### Basic Operation

Consider the need to provision three subnets in a VPC. Instead of duplicating the `aws_subnet` block three times, we can use `count`:

```terraform
variable "subnet_count" {
  description = "Number of subnets to create"
  type        = number
  default     = 3
}

resource "aws_subnet" "example" {
  count = var.subnet_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = "us-east-1${element(["a", "b", "c"], count.index)}"

  tags = {
    Name = "subnet-${count.index}"
  }
}
```

In this example, Terraform will provision three instances of `aws_subnet`. The `count.index` object provides the current iteration index (0, 1, and 2), enabling dynamic differentiation of attributes like `cidr_block` and `availability_zone`.

### Limitations of count

`count` organizes resources in an ordered list. If an intermediate resource in this list is removed or the order changes (for example, by reducing count or modifying elements that influence the index), Terraform may reindex and consequently destroy and recreate existing resources, changing their IDs. This "shifting" behavior can be destructive and is generally undesirable in production environments.

**Recommended Use:** `count` is suitable for creating an arbitrary number of identical resources where individual identity of each instance is not critical, or in conjunction with conditional expressions to create/not create a resource (discussed later).

## 2. The for_each Meta-Argument

`for_each` was introduced to mitigate count's limitations. Instead of a numeric value, it accepts a map or a set of strings.

### Operation and Advantages

`for_each` iterates over the items in the provided map or set, creating a resource instance for each one. The main difference is that it uses the map key (or set value) as a unique and stable identifier for each resource, instead of a numeric index.

Let's revisit the previous subnet example, now with `for_each` to manage subnets with specific logical identities:

```terraform
variable "subnets" {
  description = "A map of subnet configurations to create"
  type = map(object({
    cidr_block = string
    az         = string
  }))
  default = {
    "public_a_zone1" = {
      cidr_block = "10.0.1.0/24"
      az         = "us-east-1a"
    },
    "public_b_zone2" = {
      cidr_block = "10.0.2.0/24"
      az         = "us-east-1b"
    },
    "private_a_zone1" = {
      cidr_block = "10.0.10.0/24"
      az         = "us-east-1a"
    }
  }
}

resource "aws_subnet" "example" {
  for_each = var.subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.cidr_block
  availability_zone = each.value.az

  tags = {
    Name = "subnet-${each.key}"
  }
}
```

With `for_each`, resources are addressed as map elements, for example: `aws_subnet.example["public_a_zone1"]`. If the "public_b_zone2" subnet is removed from the variable map, Terraform will destroy only that specific instance without affecting the others, due to the stable identity provided by the key (`each.key`).

**Recommended Use:** `for_each` is the ideal choice for iteration over resources where individual and stable identity of each instance is fundamental. It promotes more predictable and maintainable code.

## 3. Conditional Expressions

Terraform configurations frequently require logic to adapt provisioning to different environments (production, staging, development) or specific requirements. The tool for this is the ternary operator: `condition ? true_value : false_value`.

### 3.1. Dynamic Attribute Definition

This is the most common use case, allowing resource attributes to be defined conditionally:

```terraform
variable "environment" {
  type    = string
  default = "dev"
}

resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = var.environment == "prod" ? "t3.large" : "t3.micro"

  tags = {
    Name = "web-${var.environment}"
  }
}
```

Here, the VM's `instance_type` will be `t3.large` if `var.environment` is "prod", and `t3.micro` otherwise.

### 3.2. Conditional Resource Creation

To create or omit a resource based on a condition, `count` is frequently combined with a conditional expression:

```terraform
variable "enable_s3_logging" {
  type    = bool
  default = false
}

resource "aws_s3_bucket" "detailed_logs" {
  count = var.enable_s3_logging ? 1 : 0

  bucket = "detailed-logs-prod"
  acl    = "private"
}
```

If `var.enable_s3_logging` is `true`, the S3 bucket will be provisioned. If `false`, count will be 0 and no bucket will be created. When referencing this resource, the `[0]` index must be used: `aws_s3_bucket.detailed_logs[0].id`.

## Conclusion

Mastering `count`, `for_each`, and conditional expressions is a fundamental step to optimize your Terraform configurations. These tools enable a broader and more predictable view of terraform code beyond simple resource declaration, empowering you to build dynamic, scalable, and reusable infrastructures.

- Use `count` with criteria, aware of its potential impacts on resource reindexing.
- Prefer `for_each` for iterations that require stability and unique identification of each resource.
- Use ternary expressions to inject conditional logic, adapting attributes and resource existence according to environment needs.

Applying these concepts results in cleaner, reusable code aligned with Don't Repeat Yourself (DRY) principles, elevating the maturity of your Terraform practices.
