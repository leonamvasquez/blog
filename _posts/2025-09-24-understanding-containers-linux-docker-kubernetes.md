---
title: "Understanding Containers: Linux, Docker and Kubernetes"
description: "What are containers and how do they work? Learn the differences between Linux containers, Docker and Kubernetes. Tutorial with practical examples of namespaces, cgroups, Dockerfile and K8s manifests."
date: 2025-09-24 18:00:00 -0300
lang: en
permalink: /en/posts/understanding-containers-linux-docker-kubernetes/
categories: [DevOps, Containers]
tags: [Containers, Linux, Docker, Kubernetes, DevOps, Cloud-Native, Namespaces, cgroups]
icons: [linux, docker, kubernetes]
---

# What Are Containers?

Containers are an **operating system-level resource isolation** technology that allows packaging and running applications in an isolated, lightweight, and portable manner. Unlike traditional virtual machines that virtualize complete hardware, containers share the host operating system kernel and use native Linux mechanisms to create isolation, making them much more efficient in terms of resources.

## The Foundation: Containers in Linux

### How Linux Containers Work

Containers in Linux are built on fundamental kernel technologies:

#### 1. **Namespaces**
Provide isolation of system resources:
- **PID Namespace**: Isolates the process tree
- **Network Namespace**: Isolates network interfaces
- **Mount Namespace**: Isolates filesystem mount points
- **UTS Namespace**: Isolates hostname and domain name
- **IPC Namespace**: Isolates inter-process communication
- **User Namespace**: Isolates users and groups

#### 2. **Control Groups (cgroups)**
Limit and control resource usage:
- CPU
- Memory
- Disk I/O
- Network

#### 3. **Union File Systems**
Allow overlaid filesystem layers, creating the illusion of a single filesystem.

### Practical Example: Creating a Container "Manually"

```bash
# Create a new PID and mount namespace
sudo unshare --pid --mount --fork /bin/bash

# Inside the new namespace
mount -t proc proc /proc
ps aux  # Shows only namespace processes
```

## Docker: Simplifying Containers

### What is Docker?

Docker is a platform that drastically simplifies the use of containers, providing:

- **Engine**: Runtime to execute containers
- **Images**: Immutable templates to create containers
- **Dockerfile**: Declarative language to create images
- **Registry**: Repository to share images

### Main Differences from "Pure" Linux Containers

| Aspect | Linux Container | Docker |
|--------|----------------|--------|
| **Complexity** | High (manual configuration) | Low (simple commands) |
| **Portability** | Limited | High (standardized images) |
| **Management** | Manual | Automatic |
| **Networking** | Complex configuration | Automatic virtual networks |
| **Volumes** | Manual mounts | Volume management |

### Practical Example with Docker

```dockerfile
# Dockerfile
FROM alpine:latest
RUN apk add --no-cache nodejs npm
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t my-app .
docker run -p 3000:3000 my-app
```

## Kubernetes: Orchestrating Containers at Scale

### What is Kubernetes?

Kubernetes is an orchestration system that manages containers in clusters, providing:

- **Scheduling**: Automatic distribution of containers
- **Service Discovery**: Discovery and load balancing
- **Auto-scaling**: Automatic scalability
- **Self-healing**: Automatic failure recovery
- **Rolling Updates**: Updates without downtime

### Main Differences

| Aspect | Docker | Kubernetes |
|--------|--------|------------|
| **Scope** | Single host | Multi-host cluster |
| **Orchestration** | Limited (Docker Compose) | Complete |
| **Networking** | Bridge/Host | CNI plugins |
| **Storage** | Local volumes | Persistent Volumes |
| **Load Balancing** | Basic | Advanced (Services, Ingress) |

### Example: Deploy on Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: app
        image: my-app:latest
        ports:
        - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: my-app-service
spec:
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

```bash
kubectl apply -f deployment.yaml
kubectl get pods
kubectl get services
```

## Conclusion

Containers have revolutionized application development and deployment. Starting with native Linux technologies, evolving to Docker's simplicity, to Kubernetes orchestration, each tool has its place in the development ecosystem.

The choice between them depends on the specific needs of the project: complexity, scale, available resources, and team expertise.
