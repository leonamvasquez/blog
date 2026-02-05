---
title: "Infraestrutura como Software: Aplicando TDD (Test Driven Development) em Módulos Terraform"
description: "Aprenda a aplicar Test Driven Development (TDD) em módulos Terraform usando o framework nativo terraform test. Guia completo com mocks, testes unitários e de integração em HCL."
date: 2026-02-04 23:16:39 -0300
categories: [Terraform, Engineering, Quality Assurance]
tags: [Terraform, TDD, IaC, Automation, DevOps, Testing]
icons: [terraform]
---

## Introdução

Durante muito tempo, o termo "Infraestrutura como Código" (IaC) foi levado ao pé da letra apenas na parte da codificação, mas frequentemente ignorado na parte da **Qualidade de Software**.

Enquanto desenvolvedores de aplicações jamais enviariam código para produção sem uma bateria de testes unitários, engenheiros de plataforma costumam confiar apenas na validação visual do `terraform plan`. Isso gera um ciclo de feedback lento, propenso a erros humanos.

Com o amadurecimento do **Terraform Test Framework**, a HashiCorp mudou esse jogo. Agora, possuímos uma sintaxe nativa em HCL para validações, mocks e orquestração de testes.

Isso significa que podemos finalmente aplicar **TDD (Test Driven Development)** na nossa infraestrutura, sem precisar aprender Go ou Python, e sem depender de frameworks externos.

## O Novo Modelo Mental: Unitários vs. Integração

Para aplicar TDD na infraestrutura, precisamos separar os testes em duas categorias, suportadas nativamente pelo framework:

1.  **Testes Unitários (Plan & Mock):** Validam a **lógica** do seu código (condicionais, `for_each`, validação de variáveis). Eles rodam na memória, são instantâneos e **não geram custos de nuvem**, pois mockam a API do provider.
2.  **Testes de Integração (Apply):** Validam a **efetividade**. Eles provisionam recursos reais na nuvem, verificam se a API aceitou a configuração e os destroem em seguida.

## Tutorial Prático: O Ciclo TDD

Partindo da premissa de que queremos construir um módulo de S3 seguro seguindo rigorosamente o ciclo **Red-Green-Refactor**.

**O Cenário:** Precisamos criar um módulo de bucket S3 com uma regra de compliance inegociável:
* Se o ambiente for `prod`, o versionamento **deve** estar ativado (`Enabled`).
* Se o ambiente for `dev`, o versionamento **deve** estar suspenso (`Suspended`) para reduzir custos.

### Passo 1: RED (Escrevendo o Teste Primeiro)

No TDD, começamos descrevendo o comportamento esperado *antes* de ter o recurso implementado. O teste deve falhar.

Crie o arquivo `tests/compliance.tftest.hcl`.

> **Importante:** A extensão `.tftest.hcl` é **obrigatória** para que o Terraform reconheça o arquivo como parte do test framework.

> **Dica:** O uso de `mock_provider` é o segredo para TDD rápido. Ele permite testar lógica sem credenciais da AWS.

```hcl
# tests/compliance.tftest.hcl

# Isolamos o teste da API real da AWS
mock_provider "aws" {}

# Variáveis globais para os testes
variables {
  bucket_name = "tdd-bucket-placeholder"
}

# Cenário 1: Ambiente de Desenvolvimento
run "validar_regra_dev" {
  command = plan

  variables {
    env = "dev"
  }

  # Asserção: Verificamos a lógica interna do plano
  # A função one() extrai o único elemento de uma lista/set,
  # útil quando o bloco retorna uma coleção de configuração.
  assert {
    condition     = one(aws_s3_bucket_versioning.this.versioning_configuration).status == "Suspended"
    error_message = "Erro de Compliance: Ambientes DEV não devem ter versionamento ativo."
  }
}

# Cenário 2: Ambiente de Produção
run "validar_regra_prod" {
  command = plan

  variables {
    env = "prod"
  }

  assert {
    condition     = one(aws_s3_bucket_versioning.this.versioning_configuration).status == "Enabled"
    error_message = "Erro de Compliance: Ambientes PROD DEVEM ter versionamento ativo."
  }
}

# Cenário 3: Validação de Input - Ambiente Inválido
run "rejeitar_ambiente_invalido" {
  command = plan

  variables {
    env = "staging"  # Valor não permitido
  }

  # expect_failures indica que esperamos uma falha de validação
  expect_failures = [var.env]
}
```

Ao executar `terraform test`, o resultado será falha, pois ainda não codificamos a lógica. Isso é o estado **RED**.

### Passo 2: GREEN (Implementando a Lógica)

Agora, escrevemos o código HCL mínimo necessário para satisfazer os testes.

Arquivo `providers.tf`:

```hcl
# providers.tf
terraform {
  required_version = ">= 1.7.0"

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
```

Arquivo `main.tf`:

```hcl
# main.tf
variable "bucket_name" {
  type        = string
  description = "Nome único do bucket S3"
}

variable "env" {
  type        = string
  description = "Ambiente de deploy (dev ou prod)"

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "O valor de 'env' deve ser 'dev' ou 'prod'."
  }
}

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    # Implementação da Lógica de Negócio testada
    status = var.env == "prod" ? "Enabled" : "Suspended"
  }
}
```

Agora, execute o comando novamente:

```bash
$ terraform test

tests/compliance.tftest.hcl
  validar_regra_dev          [pass]
  validar_regra_prod         [pass]
  rejeitar_ambiente_invalido [pass]

3 tests passed.
```

**Estado GREEN alcançado!** Validamos a lógica de negócio em milissegundos, sem criar nada na AWS.

### Passo 3: Expandindo com Testes de Integração

Mocks são excelentes para lógica, mas não garantem que a AWS aceitará o nome do bucket ou que a região suporta o recurso. Para garantir mais confiabilidade, adicionamos um teste de integração que usa a API real.

Primeiro, crie o módulo auxiliar `tests/setup/main.tf` que gera um ID único para evitar conflitos de nome:

```hcl
# tests/setup/main.tf
terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

resource "random_id" "this" {
  byte_length = 4
}

output "random_id" {
  value = random_id.this.hex
}
```

Agora, crie o arquivo `tests/integration.tftest.hcl`. Note que aqui não usamos `mock_provider` e mudamos o comando para `apply`.

```hcl
# tests/integration.tftest.hcl

# Helper: Módulo auxiliar para gerar ID randômico (evita conflito de nomes no S3)
run "setup" {
  module {
    source = "./setup"
  }
}

run "provisionamento_real_e2e" {
  command = apply

  variables {
    # Usamos o output do passo anterior para gerar um nome único
    bucket_name = "tdd-integration-${run.setup.random_id}"
    env         = "dev"
  }

  # Validamos um atributo que só existe DEPOIS que a AWS cria o recurso (Computed)
  assert {
    condition     = startswith(aws_s3_bucket.this.arn, "arn:aws:s3:::")
    error_message = "O ARN do bucket não foi gerado corretamente pela AWS"
  }
}
```

Ao rodar `terraform test` agora, o framework irá:

1. Rodar os testes unitários (Mock) primeiro.
2. Se passarem, rodará o `setup`.
3. Rodará o `provisionamento_real_e2e` (fazendo o Apply na AWS).
4. Executará as asserções.
5. Executará o `destroy` automático para limpar a conta.

## Dicas Avançadas

### Filtrando Testes

Para rodar apenas um arquivo ou cenário específico:

```bash
# Rodar apenas testes unitários (mocks)
terraform test -filter=tests/compliance.tftest.hcl

# Rodar apenas testes de integração
terraform test -filter=tests/integration.tftest.hcl
```

### Verbose Mode

Para debugging detalhado dos testes:

```bash
terraform test -verbose
```

## Estratégia de Engenharia

A adoção do Terraform Test deve seguir uma pirâmide:

**Base (80%): Testes Unitários com Mocks.**
* Valide condicionais, validações de variáveis, locals complexos e regras de compliance.
* Rodam em todos os Pull Requests.
* Custo zero e feedback imediato.

**Topo (20%): Testes de Integração.**
* Valide a criação bem-sucedida de recursos críticos ou complexos (ex: Peering de VPC, Criação de Cluster K8s).
* Rodam em merges para a `main` ou em schedules noturnos.
* Garantem que contratos de API da Cloud não mudaram.

## Conclusão

O `terraform test` democratizou a qualidade de código na infraestrutura. Não é mais necessário ser um especialista em Go para garantir que seu módulo funciona.

Ao adotar o TDD no Terraform, você move a descoberta de erros para a esquerda (Shift-Left), reduz custos de nuvem com falhas de deploy e entrega uma plataforma muito mais confiável para seus desenvolvedores.

