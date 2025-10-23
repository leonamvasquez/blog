---
title: "Terraform Além do Básico: Utilizando count, for_each e Expressões Condicionais"
date: 2025-10-23 08:00:00 +0000
categories: [DevOps, IaC, Terraform]
tags: [Terraform, Count, ForEach, Condicionais, IaC, Best Practices]
---

## Introdução

A declaração estática de recursos é o ponto de partida no Terraform. Um bloco resource define uma VM, outro define um bucket, e assim por diante. Embora funcional para setups simples, essa abordagem rapidamente se torna impraticável em cenários complexos, levando à repetição de código e dificuldade de manutenção.

Existem métodos mais eficientes para aplicarmos lógica e criar configurações dinâmicas e escaláveis. A transição de configurações manuais e repetitivas para a automação inteligente é viabilizada a princípio por três mecanismos: os meta-argumentos `count` e `for_each`, e o uso de expressões condicionais.

Este artigo demonstra como utilizar essas ferramentas para gerenciar múltiplos recursos, implementar lógica condicional e escrever código IaC eficiente e reutilizável, seguindo as melhores práticas.

## 1. O Meta-Argumento count

O `count` permite criar múltiplas instâncias de um recurso a partir de um único bloco de código. Ele aceita um valor numérico e gera essa quantidade de cópias idênticas do recurso.

### Funcionamento Básico

Considere a necessidade de provisionar três sub-redes em uma VPC. Em vez de duplicar o bloco `aws_subnet` três vezes, podemos empregar `count`:

```hcl
variable "subnet_count" {
  description = "Número de sub-redes a criar"
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

Neste exemplo, o Terraform provisionará três instâncias de `aws_subnet`. O objeto `count.index` fornece o índice da iteração atual (0, 1 e 2), possibilitando a diferenciação dinâmica de atributos como `cidr_block` e `availability_zone`.

### Limitações do count

O `count` organiza os recursos em uma lista ordenada. Se um recurso intermediário nesta lista for removido ou a ordem alterada (por exemplo, ao reduzir o count ou modificar elementos que influenciam o índice), o Terraform pode reindexar e, consequentemente, destruir e recriar recursos existentes, alterando seus IDs. Este comportamento de "deslocamento" (shifting) pode ser destrutivo e é, geralmente, indesejável em ambientes de produção.

**Uso Recomendado:** O `count` é adequado para criar um número arbitrário de recursos idênticos onde a identidade individual de cada instância não é crítica, ou em conjunto com expressões condicionais para criar/não criar um recurso (discutido adiante).

## 2. O Meta-Argumento for_each

O `for_each` foi introduzido para mitigar as limitações do `count`. Em vez de um valor numérico, ele aceita um mapa (map) ou um conjunto de strings (set of strings).

### Funcionamento e Vantagens

O `for_each` itera sobre os itens do mapa ou conjunto fornecido, criando uma instância de recurso para cada um. A principal diferença é que ele utiliza a chave do mapa (ou o valor do conjunto) como um identificador único e estável para cada recurso, em vez de um índice numérico.

Vamos voltar ao exemplo anterior das sub-redes, agora com `for_each` para gerenciar sub-redes com identidades lógicas específicas:

```hcl
variable "subnets" {
  description = "Um mapa de configurações de sub-redes a serem criadas"
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

Com `for_each`, os recursos são endereçados como elementos de um mapa, por exemplo: `aws_subnet.example["public_a_zone1"]`. Se a sub-rede "public_b_zone2" for removida do mapa de variáveis, o Terraform destruirá apenas essa instância específica, sem afetar as demais, devido à identidade estável fornecida pela chave (`each.key`).

**Uso Recomendado:** `for_each` é a escolha ideal para iteração sobre recursos onde a identidade individual e estável de cada instância é fundamental. Ele promove um código mais previsível e de fácil manutenção.

## 3. Expressões Condicionais

As configurações do Terraform frequentemente exigem lógica para adaptar o provisionamento a diferentes ambientes (produção, homologação, desenvolvimento) ou requisitos específicos. A ferramenta para isso é o operador ternário: `condição ? valor_se_verdadeiro : valor_se_falso`.

### 3.1. Definição Dinâmica de Atributos

Este é o caso de uso mais comum, permitindo que atributos de recursos sejam definidos de forma condicional:

```hcl
variable "environment" {
  type    = string
  default = "dev"
}

resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0" # Exemplo de AMI, deve ser dinâmica em um cenário real
  instance_type = var.environment == "prod" ? "t3.large" : "t3.micro"

  tags = {
    Name = "web-${var.environment}"
  }
}
```

Aqui, o `instance_type` da VM será `t3.large` se `var.environment` for "prod", e `t3.micro` caso contrário.

### 3.2. Criação Condicional de Recursos

Para criar ou omitir um recurso baseado em uma condição, o `count` é frequentemente combinado com uma expressão condicional:

```hcl
variable "enable_s3_logging" {
  type    = bool
  default = false
}

resource "aws_s3_bucket" "detailed_logs" {
  # O recurso será criado (count = 1) se 'enable_s3_logging' for verdadeiro,
  # ou não será criado (count = 0) se for falso.
  count = var.enable_s3_logging ? 1 : 0

  bucket = "logs-detalhados-prod"
  acl    = "private"
}
```

Se `var.enable_s3_logging` for `true`, o bucket S3 será provisionado. Se `false`, o count será 0 e nenhum bucket será criado. Ao referenciar este recurso, o índice `[0]` deve ser utilizado: `aws_s3_bucket.detailed_logs[0].id`.

Para `for_each`, a criação condicional de um recurso único pode ser feita passando um mapa vazio:

```hcl
resource "aws_s3_bucket" "another_logs_bucket" {
  for_each = var.enable_s3_logging ? { "prod_specific_bucket" = true } : {}

  bucket = "minha-empresa-outros-logs-prod"
  acl    = "private"
}
```

Ambas as abordagens são válidas, mas o padrão `count = var.condicao ? 1 : 0` é largamente adotado para a criação condicional de recursos singulares.

## Conclusão

O domínio de `count`, `for_each` e expressões condicionais é um passo fundamental para otimizar suas configurações Terraform. Essas ferramentas permitem uma visão mais ampla e previsível do código terraform além da simples declaração de recursos, capacitando você a construir infraestruturas dinâmicas, escaláveis e reutilizáveis.

- Utilize `count` com critério, ciente de seus potenciais impactos na reindexação de recursos.
- Prefira `for_each` para iterações que requerem estabilidade e identificação única de cada recurso.
- Empregue expressões ternárias para injetar lógica condicional, adaptando atributos e a existência de recursos conforme as necessidades do ambiente.

A aplicação desses conceitos resulta em um código mais limpo, reutilizável e alinhado aos princípios do Don't Repeat Yourself (DRY), elevando a maturidade de suas práticas com Terraform.