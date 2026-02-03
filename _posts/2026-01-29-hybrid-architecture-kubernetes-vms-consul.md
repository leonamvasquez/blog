---
title: "Hybrid Architecture: Unifying Connectivity between Kubernetes and VMs with Consul"
date: 2026-01-29 23:36:17 -0300
lang: en
permalink: /en/posts/hybrid-architecture-kubernetes-vms-consul/
description: "Learn how to unify connectivity between Kubernetes and virtual machines (VMs) using HashiCorp Consul as a hybrid Service Mesh and centralized Service Discovery."
categories: [Architecture, Consul, Kubernetes]
tags: [Consul, Kubernetes, Hybrid Cloud, Service Mesh, Networking, Legacy Modernization]
---

## Introduction

The *Cloud Native* narrative often suggests an ideal world where 100% of infrastructure resides in modern, ephemeral Kubernetes clusters. In practice, this reality is rare.

Most organizations operate in a **hybrid (Brownfield) scenario**: modern microservices running on Kubernetes need to communicate with databases, mainframes, and legacy monolithic applications that still reside on Virtual Machines (VMs) or Bare Metal.

The architectural challenge almost always arises at the network layer. Kubernetes operates on an *overlay* network (CNI), often isolated from the physical network (*underlay*, VLANs or VPCs) where VMs live. Connecting these two worlds through static firewall rules, manual routes, and custom DNS tends to generate fragile, hard-to-maintain, and poorly scalable solutions.

This article explores how **HashiCorp Consul** can act as a unified *control plane*, allowing services in Kubernetes and VMs to discover and communicate transparently, respecting the hybrid reality of organizations.

## The Challenge of Network Dissonance

When trying to connect a Pod in Kubernetes to a service running on a VM, some structural barriers immediately arise:

1. **Ephemeral Addressing**
   Pod IPs change constantly with each *deploy* or *reschedule*. Firewalls and IP-based ACLs cannot keep up with this volatility.

2. **Isolated Service Discovery**
   Kubernetes DNS (kube-dns / CoreDNS) only knows internal cluster resources. An external VM cannot natively resolve names like app.svc.cluster.local.

3. **Lack of Shared Identity**
   By default, there is no common identity that allows consistent authentication and authorization between legacy services and modern workloads.

Most *Service Mesh* solutions focus primarily on Kubernetes, treating VMs as exceptions or requiring the creation of dedicated *gateways* to integrate the external world. Consul takes a different approach: **platform agnostic**.

## Consul: A Service-Oriented Control Plane

Consul's core philosophy is simple and powerful: **the fundamental unit of architecture is the service, not the IP or the platform where it runs**.

By abstracting the complexity of the underlying network, Consul provides a logical and consistent view of the entire distributed environment.

### 1. VMs as Native Resources in the Mesh

Unlike approaches that depend exclusively on Kubernetes-specific components, a VM can participate in the Consul mesh simply by running the **Consul Agent**.

This agent:

* Registers local services (e.g., `legacy-billing` or `oracle-db`) in the global catalog
* Runs local *health checks*
* Associates identity and metadata with the service

For Consul, it doesn't matter if the service runs in a container, a modern VM, or a 2015 Linux server: it's just another service available in the mesh.

### 2. Catalog Synchronization with Kubernetes

On the Kubernetes side, Consul provides the **`consul-k8s`** component, responsible for integrating the cluster with the global control plane.

One of its most important features is **Catalog Sync**, which works bidirectionally:

* **Kubernetes → Consul**
  Cluster services are automatically detected and registered in the Consul catalog, making them visible to external workloads.

* **Consul → Kubernetes**
  External services (running on VMs or Bare Metal) are synchronized into Kubernetes, where Consul creates `Service` resources (`ClusterIP` or `ExternalName`) that represent these endpoints.

This synchronization eliminates the need to maintain parallel DNS or duplicated manual configurations.

## The Connectivity Flow in Practice

The impact of this architecture is operational transparency. A typical communication flow occurs as follows:

1. A microservice in Kubernetes needs to consume a legacy service.
2. The application makes a call to `http://legacy-billing`.
3. CoreDNS resolves this name because Consul synchronized the service into the cluster.
4. Kubernetes routes the call to the VM's real IP (or to the sidecar proxy if the mesh is active).
5. Traffic crosses the boundary between *overlay* and *underlay* without dependency on static IPs or Pod-specific rules.

The result is predictable communication, without *hardcoded* addresses and with less coupling to the physical network topology.

## Security with Consul Connect (Service Mesh)

By enabling **Consul Connect**, the hybrid architecture evolves to a **Zero Trust** model, even for legacy workloads.

In this scenario, an Envoy proxy runs alongside the application on the VM. Communication follows the flow:

`Pod (Envoy) → mTLS encrypted → VM (Envoy) → Local Application`

This allows applying **Intentions**, which work as service-oriented authorization policies, for example:

> Allow the `frontend` service (Kubernetes) to access `legacy-billing` (VM), denying any other communication.

### Operational Considerations

Despite the significant gains in security and observability, introducing proxies on legacy VMs requires planning. Latency-sensitive applications, environments with low observability maturity, or teams unfamiliar with distributed *troubleshooting* may face additional challenges.

## Enabling the Strangler Fig Pattern

From a strategic perspective, this integration practically enables the **Strangler Fig** pattern.

Functionalities of a legacy monolith can be gradually migrated to microservices on Kubernetes, while Consul controls *service discovery* and routing.

With features like **Traffic Splitting**, it's possible to redirect a small percentage of traffic to new implementations, validating behavior and performance before a complete migration, avoiding *Big Bang* approaches.

## When Consul May Not Be the Best Choice

While powerful, Consul is not a universal solution.

In small environments with few legacy services, low change rate, and simple communication between systems, adopting Consul may introduce more operational complexity than immediate benefits.

Teams without maturity in automation, observability, and distributed environment management may struggle to extract the full value of the service mesh. In these cases, simpler solutions based on DNS or static routing may be sufficient.

## Conclusion

Kubernetes should not be treated as an isolated island. In real organizations, infrastructure modernization inevitably involves the coexistence of new and legacy.

Consul's value lies in offering a **pragmatic path** for this transition, abstracting network complexity and providing a unified view of all services, regardless of the platform where they run.

More than connecting Kubernetes and VMs, Consul allows teams to focus on the gradual evolution of architecture and delivering business value, instead of spending energy managing routing tables, firewall rules, and manual DNS configurations.
