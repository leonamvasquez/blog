---
title: "OpenTofu Além do Básico: Providers Dinâmicos e Variáveis no Backend"
description: "Como funcionam a avaliação antecipada de variáveis e o for_each em blocos provider no OpenTofu: sintaxe, limites, o caso multi-região sem duplicação e o que isso muda na relação com o Terragrunt."
date: 2026-06-19 19:00:00 -0300
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, Terraform, Providers, Backend, IaC, DevOps]
icons: [opentofu]
---

## Introdução

Duas limitações acompanharam o Terraform por quase toda a existência dele, e quem já operou infraestrutura em escala esbarrou nas duas.

A primeira aparece quando você tenta usar variável na configuração do backend e leva um erro dizendo que aquele valor precisa ser literal. A segunda aparece quando você precisa provisionar a mesma infraestrutura em oito regiões e acaba copiando o mesmo bloco `provider` oito vezes, mudando uma linha em cada.

Essas duas restrições explicam boa parte da razão de existir de ferramentas de orquestração ao redor do Terraform. O OpenTofu removeu as duas, e este artigo mostra como.

## Por que Existia a Restrição

Vale entender a causa, porque ela explica os limites que sobraram.

O `init` acontece antes de qualquer avaliação de configuração. É nesse momento que a ferramenta precisa saber onde fica o estado e de onde baixar os módulos, e nesse ponto ela ainda não processou expressão, variável ou dependência nenhuma.

A saída de sempre era exigir valor literal nesses pontos. Quem precisava de flexibilidade recorria a arquivo de backend parcial, script que gerava configuração ou uma camada externa de orquestração.

O OpenTofu resolveu isso com o que chama de **avaliação antecipada**: uma etapa que processa variável e local antes do resto, desde que não dependam de nada que só existe depois.

## Variáveis no Backend e no Módulo

A partir da versão 1.8, variável e local funcionam na configuração de backend, na origem de módulos e na configuração de criptografia.

O caso mais útil é o backend parametrizado por ambiente:

```hcl
variable "projeto" {
  type    = string
  default = "minhaapp"
}

variable "ambiente" {
  type = string
}

variable "regiao" {
  type    = string
  default = "us-east-1"
}

locals {
  bucket_estado = "${var.projeto}-estado-${var.regiao}"
  chave_estado  = "${var.ambiente}/${var.projeto}/terraform.tfstate"
}

terraform {
  backend "s3" {
    bucket  = local.bucket_estado
    key     = local.chave_estado
    region  = var.regiao
    encrypt = true
  }
}
```

O mesmo vale para a origem de um módulo, o que permite fixar a versão por variável:

```hcl
variable "versao_vpc" {
  type    = string
  default = "5.4.0"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = var.versao_vpc

  name = "producao"
  cidr = "10.0.0.0/16"
}
```

Um padrão prático que isso abre é alternar entre módulo local e módulo do registry durante o desenvolvimento:

```hcl
locals {
  origem_vpc = var.usar_modulo_local ? "./modules/vpc" : "terraform-aws-modules/vpc/aws"
}
```

Para isso funcionar, o `init` passou a consumir o arquivo de variáveis e aceitar os parâmetros de linha de comando correspondentes:

```bash
tofu init -var="ambiente=producao"
tofu init -var-file=producao.tfvars
```

### O limite que sobra

A avaliação antecipada não é mágica. Só resolve o que dá pra saber antes de qualquer execução.

Variável e local funcionam. Referência a recurso, fonte de dado ou saída de módulo, não. Se o valor depende de algo que a ferramenta só descobre durante o plano, ele segue indisponível nesse ponto.

Na prática, é restrição razoável. O nome do bucket de estado raramente depende de um recurso já provisionado.

## Providers Dinâmicos com for_each

A segunda limitação caiu na versão 1.9, com a possibilidade de iterar bloco `provider`.

O cenário clássico é multi-região. Antes, você declarava um bloco por região. Agora, declara um só:

```hcl
variable "regioes" {
  type = map(object({
    cidr = string
  }))

  default = {
    us-east-1 = { cidr = "10.0.0.0/16" }
    eu-west-1 = { cidr = "10.1.0.0/16" }
    sa-east-1 = { cidr = "10.2.0.0/16" }
  }
}

provider "aws" {
  alias    = "por_regiao"
  for_each = var.regioes

  region = each.key
}
```

Para usar essas instâncias, o módulo recebe a instância correspondente pelo mapa de providers:

```hcl
module "vpc_regional" {
  source = "./modules/vpc"

  for_each = { for regiao, config in var.regioes : regiao => config }

  providers = {
    aws = aws.por_regiao[each.key]
  }

  name = "vpc-${each.key}"
  cidr = each.value.cidr
}
```

Adicionar uma região passa a ser só acrescentar uma entrada no mapa. O código não cresce.

### Três restrições que vale conhecer

A primeira: o bloco `provider` precisa ter `alias` estático. Ele identifica a configuração, e por isso a referência no módulo é fixa, com a instância escolhida na hora entre colchetes.

A segunda: a expressão do `for_each` do provider precisa ser resolvível na etapa de avaliação antecipada. Vale variável e local, não vale fonte de dado nem recurso.

A terceira é a mais sutil, e a que mais gera erro. **A expressão de `for_each` do módulo ou do recurso precisa ser diferente da expressão usada no provider**, mesmo que as duas produzam o mapa idêntico. É por isso que, no exemplo acima, o módulo usa uma compreensão sobre a variável em vez de repetir `var.regioes` direto.

O motivo é ordem de destruição. A ferramenta precisa garantir que as instâncias de provider sobrevivam aos recursos que dependem delas durante um `destroy`. Expressões diferentes permitem estabelecer essa ordem.

## O Que Isso Muda na Relação com o Terragrunt

Cabe aqui uma observação honesta, porque essas duas funcionalidades atingem justo algumas das razões históricas para adotar camada de orquestração.

Backend parametrizado por ambiente e origem de módulo versionada por variável foram, por anos, argumento direto a favor do Terragrunt. Hoje o próprio OpenTofu resolve os dois casos.

Isso não torna a orquestração desnecessária. O Terragrunt continua entregando o que a ferramenta base não faz: isolamento de estado por unidade, grafo de dependências entre componentes, execução em lote sobre dezenas de units e filtro do que mudou.

O que mudou foi a fronteira. Projeto pequeno e médio, que adotava Terragrunt só pra parametrizar o backend, hoje resolve isso na própria ferramenta. Projeto com muita unidade interdependente segue se beneficiando da camada de orquestração.

Reavaliar essa fronteira de tempos em tempos é mais saudável do que assumir que a decisão tomada há dois anos ainda vale.

## Cuidados

Três pontos que merecem atenção antes de sair usando.

**Variável no backend afeta quem executa.** Se o nome do bucket depende de uma variável, quem rodar a ferramenta precisa passá-la também no `init`. Documente isso, ou o próximo do time vai perder tempo descobrindo.

**Valor sensível é bloqueado na origem de módulos.** Desde a 1.9, a ferramenta impede que valor marcado como sensível apareça em caminho de módulo, porque ficaria visível durante a inicialização.

**Flexibilidade cobra clareza.** Origem de módulo definida por expressão condicional é poderosa e também mais difícil de rastrear. Use quando resolver um problema real, não só porque agora dá.

## Conclusão

Essas duas funcionalidades têm algo em comum: devolvem à ferramenta base coisa que a comunidade resolvia por fora, com script, arquivo parcial e camada extra.

Vale registrar que essa vantagem não é permanente. O Terraform vem fechando parte dessa distância nas versões recentes, e é esperado que continue. A diferença entre os dois projetos é retrato em movimento, não estado final.

O que fica é o critério pra avaliar qualquer uma das duas ferramentas: menos a lista de funcionalidade exclusiva de cada versão, e mais a pergunta de quais camadas externas você mantém hoje só porque a ferramenta não dava conta. Toda vez que uma delas deixa de ser necessária, sobra menos código pra manter, e é isso que de fato conta no fim de um ano de operação.
