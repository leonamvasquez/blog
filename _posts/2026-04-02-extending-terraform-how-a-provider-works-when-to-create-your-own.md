---
title: "Extending Terraform: Understanding How a Provider Works (and When to Create Your Own)"
description: "Dissect the gRPC communication architecture between Terraform Core and Providers, understand the CRUD contract of the Plugin Framework in Go, and establish the engineering criteria to justify creating a custom Provider for internal systems."
date: 2026-04-02 19:00:00 -0300
lang: en
permalink: /en/posts/extending-terraform-how-a-provider-works-when-to-create-your-own/
categories: [Terraform, Platform Engineering, Go]
tags: [Terraform, Custom Provider, Go, Golang, IaC, Architecture]
icons: [terraform]
---

## Introduction

There is a common misconception that Terraform "knows" how to provision resources in AWS, Azure, or Kubernetes. In architectural reality, the main Terraform binary (`terraform core`) is agnostically blind to any cloud or infrastructure.

Terraform Core has only two fundamental responsibilities:

1.  Parse HCL files and build a Directed Acyclic Graph (DAG) of **Dependencies**.
2.  Manage the lifecycle of the state file (`terraform.tfstate`).

The ability to interact with external APIs (create instances, manage permissions) is entirely delegated to **Providers**. A Provider is not a module or a script; it is an autonomous binary, written almost exclusively in Go, that acts as a translator between Terraform Core and the target service's API.

This article dissects the communication architecture between the Core and Plugins and establishes the engineering criteria to justify creating a custom Provider for the organization's internal systems.

## Client-Server Architecture via gRPC

When you run `terraform init`, Terraform downloads the provider binaries declared. When running `terraform plan` or `apply`, the Core starts these binaries in parallel processes and communicates strictly via **gRPC** (Remote Procedure Call using Protobuf) through local sockets.

The Core sends messages like *"What is the schema of this resource?"* or *"Plan the creation of this resource based on these inputs"*. The Provider, in turn, encapsulates the business logic of the target API, translates the request into appropriate HTTP REST or GraphQL calls, and returns the structured result back to the Core via gRPC.

## When (Not) to Create a Custom Provider

Before engaging an engineering team in writing Go code, it is necessary to evaluate the complexity matrix.

**Do not create a Provider if:**
-   You only need to trigger a simple HTTP call (webhook, Jenkins job). The `terraform-provider-http` or native provisioners like `local-exec` are sufficient.
-   The external system does not have an API with consistent state semantics. If resource reading is asynchronous or nonexistent, Terraform will not be able to reconcile the state.

**Create a custom Provider if:**
-   You have a robust internal system (e.g., a corporate IPAM, a legacy identity management system, or a proprietary Bare Metal hardware orchestrator).
-   The resources of that system need to share the same lifecycle (CRUD) of cloud infrastructure in a single `apply` execution.
-   **State Management** and **Configuration Drift** detection are crucial for auditing the internal system.

## The CRUD Contract: Implementing the Plugin Framework

HashiCorp recommends the **Terraform Plugin Framework** (successor to SDKv2) for developing new providers. The framework abstracts gRPC complexity and directs the engineer to focus on data modeling and CRUD operations.

To create a resource (e.g., `mysystem_user`), the Go developer implements a strict contract in a struct. The cycle works as follows:

### Schema Definition

The Provider defines the resource attributes: types (`String`, `Bool`, `Map`), required fields (`Required`), optional fields (`Optional`), and fields computed by the API after creation (`Computed`, like database-generated IDs or timestamps).

### Create

Triggered during `terraform apply`. The Go code extracts variables from the HCL plan, builds the payload, and executes a POST to the internal API. After success, the Provider must persist the Unique Identifier returned by the API in the Terraform state object — this is the anchor for all subsequent operations.

### Read

The heart of Drift detection. Before each operation, Terraform triggers `Read`. The Provider retrieves the ID from the state, executes a GET on the API, and updates the in-memory state with the real values. If the API returns `404 Not Found`, the Provider instructs Terraform to remove the resource from the state, forcing recreation in the next plan.

### Update

Triggered when Terraform detects divergence between the HCL code and the registered state. The Provider receives the diff and executes a PUT or PATCH on the API.

### Delete

Triggered via `terraform destroy` or when the resource block is removed from the code. The Provider executes a DELETE on the API and Terraform removes the corresponding entry from `terraform.tfstate`.

## The Impact on Platform Engineering

Building custom providers is the pinnacle of maturity in **Platform Engineering**.

By encapsulating fragmented internal APIs and imperfect scripts inside an official organization Provider binary, the developer experience is unified. Product teams stop opening tickets in ticketing systems to create internal permissions and instead declare `resource "my_system_permission" "dev"` in their own Terraform repositories.

Legacy internal infrastructure gains, transparently, all the advantages of a modern architecture: code versioning, peer review, idempotency, and state auditing via State Management.

## Conclusion

Terraform Core is deliberately minimalist. Its real extensibility lies in the plugin protocol and the richness of the Provider ecosystem. Understanding this architecture is what differentiates an engineer who consumes Terraform from an engineer who extends it.

When critical internal systems are encapsulated as first-class Providers, the organization elevates its operational maturity by unifying the lifecycle of all internal and external infrastructure under a single declarative, auditable, and deterministic interface.
