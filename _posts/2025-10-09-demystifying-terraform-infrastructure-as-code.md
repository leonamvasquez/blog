---
title: "Demystifying Terraform: What is Infrastructure as Code (IaC)?"
description: "What is Terraform and Infrastructure as Code? Learn the fundamental concepts of IaC, the difference between declarative and imperative models, and how Terraform materializes the desired state of your infrastructure."
date: 2025-10-10 11:00:00 +0000
lang: en
permalink: /en/posts/demystifying-terraform-infrastructure-as-code/
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, What is Terraform, Infrastructure as Code, HCL, HashiCorp, Cloud, Terraform Tutorial]
icons: [terraform]
---

## Introduction

This article focuses on server infrastructure and the automation of creating and maintaining these environments. Throughout the text, we'll look only at infrastructure, leaving aside for now other layers like containers and orchestrators. The idea here is to help you clearly understand the Infrastructure as Code (IaC) paradigm, without mixing concepts that, although related, belong to different areas.

## The Philosophy of Infrastructure as Code (IaC)

Infrastructure as Code is not just a technique, but a field of knowledge that marks a paradigm shift in how computing environments are managed. Previously, teams created and maintained servers, networks, and other resources with manually made configurations, often following operational procedures or internal wikis. This way of working, besides being subject to human errors, made it difficult to repeat processes and control changes.

When we migrate to the IaC model, we bring software development practices: versioning, testing, and repetition. The environment stops being a set of manually created resources and becomes described by code files, which can be reviewed, tested, and audited. It's important to separate, in this context, "infrastructure deployment" from "application deployment." When we talk about IaC, we're only talking about provisioning and configuring the resources that support the environment, such as servers, networks, databases, and platform services. The application code comes later, running on this already-prepared foundation.

## IaC Models: Declarative vs. Imperative (Contextualizing Terraform)

There are different ways to implement IaC, the main ones being the imperative model and the declarative model. The imperative model, like Ansible, follows a sequence of commands: "install package X," "configure service Y," "restart server Z." The focus is on the step-by-step, and the result depends on the order of these actions.

In the declarative model, the goal is to describe how the infrastructure should look at the end of the process. The user defines, through configuration files, the desired state of the environment. The tool takes care of transforming the current state into the desired state, calculating and executing what's needed to get there. Terraform is the main reference for this model, allowing the professional to describe the ideal environment and leave the convergence work to the tool.

## Terraform: Materializing the Desired State

Terraform uses the HCL (HashiCorp Configuration Language) to describe the desired state of infrastructure. Terraform's workflow is a practical example of the declarative model. When running the `terraform plan` command, the tool compares the current state of resources with what's defined in the configuration files, showing the user an execution plan that details the differences and necessary actions to align both states. The `terraform apply` command executes the proposed operations, reducing the difference between the real environment and the ideal environment to zero.

This process is not just task automation, but the application of a concept: infrastructure starts to be treated as software, subject to the same control, review, and audit practices.

## Conclusion

Infrastructure as Code completely changes the way computing environments are managed, bringing to infrastructure practices already established in software development. The declarative model, which Terraform puts into practice, allows professionals to describe complex environments precisely, in a versionable and auditable way. Understanding this approach is the first step to mastering infrastructure provisioning and building scalable, reliable, and reusable environments.

---

## Read Also

If you enjoyed this article, check out the other posts in the Terraform series:

- [Terraform State: What it is, why it's important and how to manage it](/en/posts/terraform-state-what-it-is-why-important-how-to-manage/)
- [Terraform Beyond the Basics: count, for_each and Conditionals](/en/posts/terraform-beyond-basics-count-foreach-conditionals/)
- [Refactoring Terraform Code to Local Modules](/en/posts/refactoring-terraform-code-to-local-modules/)
