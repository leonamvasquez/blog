---
title: "Arquitetura de Módulos: O Padrão de Composição (Módulos Aninhados)"
description: "Aprenda o padrão de composição de módulos aninhados no Terraform. Tutorial sobre como criar módulos de alto nível que orquestram módulos de baixo nível para infraestrutura escalável e reutilizável."
date: 2025-11-06 20:00:00 +0000
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, Terraform Modules, Módulos Aninhados, Arquitetura Terraform, Composição, Tutorial Terraform, HashiCorp, Best Practices]
icons: [terraform]
---

## Introdução

A refatoração de código Terraform para módulos locais é um passo essencial para a manutenibilidade. No entanto, à medida que a infraestrutura cresce, um novo desafio de complexidade pode surgir no módulo raiz, que passa a ser responsável por orquestrar dezenas de módulos menores.

O próximo nível de maturidade arquitetural é a composição de módulos. Este é um padrão onde módulos maiores e lógicos orquestram módulos menores, cada um com uma responsabilidade única. Em vez de um módulo raiz complexo que chama módulos de vpc, alb, e security-group separadamente, criamos um módulo de "composição" (ex: web-app-stack) que os agrupa e interliga.

Este artigo explora essa arquitetura de módulos aninhados, detalhando como implementá-la e os benefícios de clareza, abstração e reutilização que ela proporciona a projetos de IaC complexos.

## 1. O que é Composição de Módulos (Módulos Aninhados)?

A composição de módulos, ou aninhamento, ocorre quando um módulo Terraform chama outro módulo Terraform. Em vez de uma arquitetura "plana" onde o módulo raiz chama todos os outros, criamos uma hierarquia.

Podemos classificar os módulos em três níveis:

- **Módulo de Infraestrutura (baixo nível):** Módulos pequenos e com responsabilidade única. Ex: vpc-module, security-group-module, ec2-instance-module.
- **Módulo de Composição (nível médio):** Um módulo que agrupa e interconecta vários módulos de infraestrutura para criar uma "stack" lógica. Ex: web-app-stack-module, database-stack-module.
- **Módulo Raiz (alto nível):** O módulo principal que define um ambiente específico (produção, desenvolvimento) e chama os módulos de composição necessários para provisionar a infraestrutura desse ambiente.

Essa estrutura permite que o módulo raiz abstraia a complexidade. Ele apenas solicita uma "stack de aplicação web", sem precisar conhecer os detalhes da VPC ou dos grupos de segurança que a compõem.

## 2. Benefícios da Composição de Módulos

Adotar o padrão de composição oferece vantagens de engenharia significativas:

- **Reutilização Ampliada:** Módulos de infraestrutura menores (como security-group) podem ser reutilizados em diferentes módulos de composição.
- **Clareza e Legibilidade:** A arquitetura se torna mais clara. O módulo raiz reflete o design lógico (ex: web-app, database), enquanto os módulos de composição lidam com os detalhes da implementação.
- **Abstração Multicamadas:** A complexidade é gerenciada em níveis. O módulo raiz não precisa saber quais saídas da VPC devem ser conectadas às entradas do ALB; o módulo de composição cuida dessa "cola".
- **Manutenibilidade e "Blast Radius" Reduzido:** Alterações em um módulo de infraestrutura (ex: vpc) são testadas e aplicadas dentro do contexto dos módulos de composição que o utilizam, facilitando a manutenção e isolando falhas.

## 3. Implementando um Padrão de Composição: Exemplo Prático

Vamos ilustrar a composição com um exemplo de uma "Web App Stack" que utiliza módulos de infraestrutura para VPC e Security Group.

### Estrutura do Projeto:

```
.
├── environments/
│   └── production/
│       └── main.tf        # Módulo Raiz (define o ambiente de produção)
└── modules/
    ├── web-app-stack/   # Módulo de Composição
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── vpc/             # Módulo de Infraestrutura (VPC)
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── security-group/  # Módulo de Infraestrutura (Security Group)
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

### 3.1. Módulo de Infraestrutura: `vpc/`

Define uma VPC e suas sub-redes.

#### `modules/vpc/variables.tf`

```terraform
variable "vpc_cidr" {
  description = "Bloco CIDR da VPC."
  type        = string
}
# ... outras variáveis para sub-redes
```

#### `modules/vpc/main.tf`

```terraform
resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
  # ...
}
# ... recursos para sub-redes
```

#### `modules/vpc/outputs.tf`

```terraform
output "vpc_id" {
  description = "ID da VPC criada."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs das sub-redes públicas."
  value       = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}
```

### 3.2. Módulo de Infraestrutura: `security-group/`

Cria um Security Group.

#### `modules/security-group/variables.tf`

```terraform
variable "vpc_id" {
  description = "ID da VPC para associar o SG."
  type        = string
}

variable "name_prefix" {
  description = "Prefixo para o nome do SG."
  type        = string
}
```

#### `modules/security-group/main.tf`

```terraform
resource "aws_security_group" "app_sg" {
  name        = "${var.name_prefix}-app-sg"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

#### `modules/security-group/outputs.tf`

```terraform
output "sg_id" {
  description = "ID do Security Group."
  value       = aws_security_group.app_sg.id
}
```

### 3.3. Módulo de Composição: `web-app-stack/`

Este módulo orquestra a criação da VPC e do Security Group, e eventualmente outros recursos como EC2, ALB, etc.

#### `modules/web-app-stack/variables.tf`

```terraform
variable "env" {
  description = "Ambiente (ex: prod, dev)."
  type        = string
}

variable "project_name" {
  description = "Nome do projeto."
  type        = string
}

variable "vpc_cidr_block" {
  description = "CIDR para a VPC da stack."
  type        = string
}
```

#### `modules/web-app-stack/main.tf`

```terraform
# Chama o módulo VPC
module "vpc" {
  source = "../vpc" # Caminho relativo para o módulo VPC

  vpc_cidr = var.vpc_cidr_block
  # ... outras variáveis do módulo VPC
}

# Chama o módulo Security Group, usando a saída do módulo VPC
module "app_sg" {
  source = "../security-group" # Caminho relativo para o módulo Security Group

  vpc_id      = module.vpc.vpc_id # Passa o ID da VPC do módulo VPC
  name_prefix = "${var.project_name}-${var.env}"
}
```

#### `modules/web-app-stack/outputs.tf`

```terraform
output "web_app_vpc_id" {
  description = "ID da VPC da stack."
  value       = module.vpc.vpc_id
}

output "web_app_sg_id" {
  description = "ID do Security Group da stack."
  value       = module.app_sg.sg_id
}
```

### 3.4. Módulo Raiz: `environments/production/main.tf`

Este módulo final define o ambiente "produção" e chama o módulo de composição `web-app-stack`.

#### `environments/production/main.tf`

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
  source = "../../modules/web-app-stack" # Caminho relativo para o módulo de composição

  env            = "prod"
  project_name   = "MeuProjeto"
  vpc_cidr_block = "10.10.0.0/16"
}

output "production_vpc_id" {
  value = module.production_web_app.web_app_vpc_id
}
```

## Conclusão

O padrão de composição de módulos é um pilar da arquitetura de Infraestrutura como Código em escala. Ao decompor grandes infraestruturas em módulos menores e orquestrá-los através de módulos de composição, o código atinge níveis superiores de abstração, reutilização e manutenibilidade.

Essa abordagem não apenas torna o código Terraform mais legível e fácil de gerenciar, mas também garante consistência e reduz o risco em projetos complexos, permitindo que as equipes construam e evoluam suas infraestruturas de forma mais eficiente e previsível.