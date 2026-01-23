---
title: "Refatorando Código Terraform: Como e Porquê Abstrair monolitos para Módulos Locais"
description: "Como criar módulos Terraform locais para organizar e reutilizar código. Aprenda a refatorar configurações monolíticas em módulos reutilizáveis com exemplos práticos e terraform state mv."
date: 2025-10-31 08:00:00 +0000
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, Terraform Modules, Módulos Terraform, Refatoração, Terraform State, Tutorial Terraform, HashiCorp, Best Practices]
---

## Introdução

É comum que projetos Terraform comecem de forma simples: um único diretório com arquivos `main.tf`, `variables.tf` e `outputs.tf`. Para infraestruturas pequenas, essa abordagem funciona. No entanto, à medida que o ambiente cresce, esse diretório raiz se transforma em um "monolito" um arquivo `main.tf` com centenas ou milhares de linhas que define toda a infraestrutura, da rede às aplicações.

Esse monolito rapidamente se torna difícil de manter, complexo para navegar e perigoso para modificar. Uma pequena alteração em um grupo de segurança pode, por engano, afetar um balanceador de carga.

A solução é a refatoração. O primeiro e mais importante passo é decompor esse monolito em módulos locais. Este artigo é um guia prático sobre por que essa abstração é necessária e como executá-la de forma segura, sem causar downtime ou recriar recursos.

## Por que Refatorar um monolito Terraform?

Abstrair código monolítico para módulos locais não é apenas uma questão de organização; é uma prática de engenharia fundamental que traz benefícios diretos:

- **Legibilidade e Manutenção:** É mais fácil entender e manter um módulo focado (`./modules/vpc`) do que navegar em um arquivo `main.tf` de 2000 linhas.
- **Abstração de Complexidade:** Módulos ocultam os detalhes da implementação. O módulo raiz apenas consome o módulo, passando as variáveis necessárias, sem precisar saber como os recursos internos estão configurados.
- **Reutilização (Princípio DRY):** Mesmo sendo locais, os módulos podem ser reutilizados. Se você precisa de dois ambientes (dev e staging) na mesma configuração raiz, pode instanciar o mesmo módulo duas vezes com variáveis diferentes.
- **Redução do "Raio de Explosão" (Blast Radius):** Isolar recursos em módulos diminui o risco de alterações interdependentes. Uma modificação no módulo de rede tem menos probabilidade de afetar o módulo da aplicação, facilitando a revisão e a aplicação de mudanças.

## A Estratégia: Módulos Locais

Um módulo local é simplesmente um diretório no mesmo repositório, referenciado por um caminho relativo (`./modules/meu-modulo`). Esta é a forma mais simples de modularização, servindo como base antes de se considerar módulos remotos (via Git ou Registry).

### Estrutura "Antes" (monolito):

```
.
├── main.tf       # (Define VPC, subnets, security groups, EC2, LB...)
├── variables.tf
└── outputs.tf
```

### Estrutura "Depois" (Modularizado):

```
.
├── main.tf       # (Agora apenas chama os módulos)
├── variables.tf  # (Variáveis para o módulo raiz)
├── outputs.tf    # (Saídas globais)
└── modules/
    ├── vpc/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── web-app/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

## O Processo de Refatoração: Um Guia Prático

A parte mais sensível da refatoração é garantir que o Terraform entenda que você está movendo recursos, e não destruindo e recriando-os. Isso é feito com o comando `terraform state mv`.

Vamos refatorar um `aws_security_group` de um `main.tf` monolítico.

### Passo 1: Identificar a Lógica para Abstração

No `main.tf` raiz, identificamos um recurso lógico, como um grupo de segurança para uma aplicação web:

```terraform
variable "vpc_id" { type = string }

resource "aws_security_group" "web_sg" {
  name        = "web-app-sg"
  description = "Permite tráfego HTTP e HTTPS"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  # ...outras regras
}

resource "aws_instance" "web_server" {
  # ...
  vpc_security_group_ids = [aws_security_group.web_sg.id]
}
```

### Passo 2: Criar a Estrutura do Módulo

Criamos o diretório e os arquivos padrão para o novo módulo:

```bash
mkdir -p modules/security-group
touch modules/security-group/main.tf
```

### Passo 3: Mover o Bloco `resource`

Recortamos o bloco `resource "aws_security_group" "web_sg"` do `main.tf` raiz e o colamos em `modules/security-group/main.tf`.

### Passo 4: Definir a "API" (Variáveis e Saídas)

#### Variáveis

O recurso movido referenciava `var.vpc_id`. Isso deve se tornar uma variável de entrada do módulo.

```terraform
variable "vpc_id" {
  description = "ID da VPC onde o SG será criado."
  type        = string
}
```

#### Saídas

O recurso `aws_instance.web_server` (que ficou no raiz) referenciava `aws_security_group.web_sg.id`. Isso deve se tornar uma saída do módulo.

```terraform
output "sg_id" {
  description = "O ID do grupo de segurança criado."
  value       = aws_security_group.web_sg.id
}
```

### Passo 5: Chamar o Módulo no Raiz

No `main.tf` raiz, removemos o recurso antigo e adicionamos a chamada ao módulo. Também atualizamos a `aws_instance` para usar a saída do módulo:

```terraform
variable "vpc_id" { type = string }

module "web_sg" {
  source = "./modules/security-group"

  vpc_id = var.vpc_id
}

resource "aws_instance" "web_server" {
  # ...
  vpc_security_group_ids = [module.web_sg.sg_id]
}
```

### Passo 6: Mover o Estado (O Passo Crítico)

Se executarmos `terraform plan` agora, o Terraform tentará destruir `aws_security_group.web_sg` e criar `module.web_sg.aws_security_group.web_sg`, causando downtime.

Para evitar isso, informamos ao Terraform que o recurso foi apenas movido. Usamos `terraform state mv` para mover o endereço do recurso no arquivo de estado.

```bash
terraform state mv \
  aws_security_group.web_sg \
  module.web_sg.aws_security_group.web_sg
```

### Passo 7: Validar a Refatoração

Após mover o estado, execute `terraform plan`. A saída esperada deve ser:

```
No changes. Your infrastructure is up-to-date.
```

Isso confirma que o Terraform agora gerencia o recurso em seu novo local no código, sem a necessidade de destruí-lo ou recriá-lo. A refatoração foi concluída com sucesso e sem impacto na infraestrutura.

## Conclusão

Refatorar um monolito Terraform para módulos locais é um investimento na saúde e escalabilidade do seu projeto de IaC. Embora o processo exija cuidado, especialmente ao manipular o estado com `terraform state mv`, os benefícios em legibilidade, manutenção e redução de riscos são imediatos.

Dominar a decomposição em módulos locais é a fundação para práticas de Infraestrutura como Código mais avançadas, como a criação de módulos reutilizáveis e o gerenciamento de ambientes complexos.