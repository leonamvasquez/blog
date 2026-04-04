---
title: "CDK for Terraform (CDKTF): Writing Infrastructure with TypeScript and Python"
description: "Understand the CDK for Terraform (CDKTF) paradigm, which allows writing infrastructure with TypeScript, Python, and other general-purpose languages while maintaining full compatibility with the Terraform Provider ecosystem and State Management."
date: 2026-03-29 19:23:19 -0300
lang: en
permalink: /en/posts/cdk-for-terraform-cdktf-writing-infrastructure-typescript-python/
categories: [Terraform, Platform Engineering, Architecture]
tags: [Terraform, CDKTF, TypeScript, Python, IaC, Developer Experience]
icons: [terraform]
---

## Introduction

The HashiCorp Configuration Language (HCL) revolutionized how we provision infrastructure. Its declarative nature is excellent for describing the final state of a cloud topology. However, as infrastructure scales and becomes the foundation of complex internal platforms, the inherent limitations of a DSL become apparent.

HCL, by design, lacks the advanced logical flow constructs present in general-purpose programming languages. When engineers need to implement intricate conditional logic, inheritance, polymorphism, or integrate infrastructure with external packages, HCL code frequently degenerates into massive bottlenecks with nested `dynamic blocks` and hard-to-read native functions.

Furthermore, the initiative to bring infrastructure development closer to developers (Shift-Left) runs into a cognitive barrier: requiring developers proficient in Node.js, Python, or Java to learn a proprietary language just to provision a database.

It is to solve this architectural and cognitive gap that HashiCorp introduced **CDK for Terraform (CDKTF)**.

## The Synthesis Paradigm: Imperative Generating Declarative

CDKTF is not a new infrastructure execution engine. It acts as a synthesizer (compiler).

The central concept is to allow infrastructure to be written using imperative and Object-Oriented paradigms in languages like TypeScript, Python, C#, Go, or Java. When the `cdktf synth` command is executed, the framework translates that code into a structured JSON file that the standard Terraform core (`terraform core`) understands and applies.

Architecturally, this means all the benefits of the Terraform ecosystem are preserved (the thousands of Providers, State Management, the dependency Graph Engine) while leveraging the expressive power of a mature language.

## Anatomy of a CDKTF Application (TypeScript)

Infrastructure is no longer a collection of loose `.tf` files but is treated as traditional software. The mental model is based on **App** and **Stacks**: an `App` is the root container that houses one or more `Stacks`, with each `Stack` being equivalent to a Terraform workspace or state file.

### Practical Example: Abstraction with Object-Oriented Programming

The challenge of creating resources for multiple microservices illustrates the paradigm difference well. In HCL, the solution requires complex maps and `for_each`. In TypeScript, we use native language classes and iterations:

```typescript
import { Construct } from "constructs";
import { App, TerraformStack } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { Instance } from "@cdktf/provider-aws/lib/instance";
import { S3Bucket } from "@cdktf/provider-aws/lib/s3-bucket";

class MicroserviceStack extends TerraformStack {
  constructor(scope: Construct, id: string, env: string) {
    super(scope, id);

    new AwsProvider(this, "AWS", {
      region: "us-east-1",
    });

    const services = ["auth", "billing", "inventory"];

    services.forEach((service) => {
      new Instance(this, `ec2-${service}`, {
        ami: "ami-0c55b159cbfafe1f0",
        instanceType: env === "prod" ? "m5.large" : "t3.micro",
        tags: {
          Name: `${service}-app-${env}`,
          Owner: "Platform Team",
        },
      });

      new S3Bucket(this, `bucket-${service}`, {
        bucket: `company-${service}-data-${env}`,
      });
    });
  }
}

const app = new App();
// The same class logic is reused to instantiate multiple environments
new MicroserviceStack(app, "dev-environment", "dev");
new MicroserviceStack(app, "prod-environment", "prod");

app.synth();
```

When running `cdktf deploy`, the framework synthesizes the JSON, calculates the exact resource plan, and executes the apply, preserving the same transactional safety of traditional Terraform.

## Architectural Benefits of CDKTF

Adopting CDKTF is a platform architecture decision motivated by four main factors:

**Ecosystem and Package Management:** With TypeScript or Python, infrastructure modules can be packaged and distributed via NPM, PyPI, or Maven, integrating IaC into the organization's existing artifact repositories.

**Real Software Testing:** Instead of relying exclusively on IaC-specific frameworks, established tools like Jest (TypeScript) or PyTest (Python) can be used for unit tests with mocks on provisioning logic.

**Strong Typing (Type Safety):** CDKTF imports the Provider schema and generates the corresponding class bindings. The IDE offers intelligent auto-complete, compile-time validation, and alerts for missing required variables — the error is identified at typing time, not at `terraform apply`.

**Reduced Cognitive Load:** Developers manage application infrastructure using the exact same language in which the application was written, eliminating the mental context switch to a proprietary DSL.

## CDKTF vs. Pulumi

The central architectural difference between the two approaches lies in the execution engine.

**Pulumi** has its own state and concurrency engine, operating autonomously and interacting directly with cloud provider APIs.

**CDKTF** is a Terraform code synthesizer. It depends on the Terraform ecosystem (Providers, Registry, Terraform CLI) as the underlying execution layer.

For organizations with consolidated investment in Terraform (modules, custom Providers, Terraform Enterprise/Cloud), CDKTF represents the natural evolution: it adds expressive power without giving up the existing legacy and interoperability.

## Conclusion

HCL remains the ideal choice for static or moderately dynamic infrastructure configurations. However, when infrastructure becomes an internal product that requires complex abstractions, distribution of standardized libraries, and tight integration with the software development lifecycle, the rigidity of a DSL becomes a structural bottleneck.

CDK for Terraform fills the historical gap between Software Engineering and Infrastructure Engineering, allowing organizations to apply consolidated development practices — Object-Oriented Programming, Unit Testing, Static Typing — directly in the construction and maintenance of the cloud fabric.
