---
title: "Terragrunt Stacks por Dentro: Implícitos vs. Explícitos (e Quando Usar Cada Um)"
description: "Um mergulho técnico na arquitetura dos Terragrunt Stacks: a distinção entre stacks implícitos e explícitos, a anatomia do terragrunt.stack.hcl, a injeção de valores, a composição via stacks aninhados e o modelo de geração sob demanda."
date: 2026-04-28 19:00:00 -0300
categories: [Terraform, Platform Engineering, IaC]
tags: [Terragrunt, Terragrunt Stacks, IaC, DRY, Platform Engineering]
icons: [terraform, terragrunt]
---

## Introdução

Existe um equívoco recorrente de que os **Terragrunt Stacks** constituem apenas uma renomeação conceitual para a prática, já consolidada, de agrupar múltiplas units em uma árvore de diretórios. Trata-se de uma simplificação que ignora a mudança arquitetural mais significativa introduzida no Terragrunt 1.0.

A confusão é compreensível, porque o termo "stack" descreve, de fato, duas realidades distintas dentro da ferramenta. Uma delas é implícita, derivada da estrutura do sistema de arquivos. A outra é explícita, declarada e gerada sob demanda. A diferença entre ambas não é semântica, e sim operacional: ela define se a sua infraestrutura é versionável como um artefato ou se permanece refém da disposição das pastas.

Este artigo disseca a anatomia dos Terragrunt Stacks, contrasta o modelo implícito com o explícito, detalha o fluxo de injeção de valores via `terragrunt.stack.hcl` e estabelece o critério de decisão para a adoção de cada abordagem.

## A Dicotomia Fundamental: Implícito vs. Explícito

Antes de qualquer código, é necessário fixar a distinção que estrutura todo o restante do artigo. Um **stack**, no Terragrunt, é uma coleção de units tratada como uma unidade lógica de orquestração. Essa coleção pode ser definida de duas formas.

1. **Stack implícito.** Qualquer diretório-pai que contenha units em seus subdiretórios. É o comportamento legado e padrão. Aqui, a estrutura de pastas *é* a fonte da verdade. Ao executar `terragrunt run --all` na raiz, o Terragrunt percorre essa árvore e a trata como um stack.
2. **Stack explícito.** Uma coleção declarada em um arquivo `terragrunt.stack.hcl`, que descreve quais units instanciar, de qual origem (`source`) buscá-las e quais valores injetar. As units não residem no repositório; elas são geradas sob demanda.

O stack implícito é transparente, porém rígido. Mover um diretório quebra referências de `include` e `dependency`, e a coleção de infraestrutura não pode ser versionada de forma atômica. O stack explícito inverte essa lógica: a definição da coleção passa a ser código versionado, e a árvore de diretórios torna-se um artefato gerado e descartável.

## A Anatomia do `terragrunt.stack.hcl`

O arquivo `terragrunt.stack.hcl` é o coração do modelo explícito. Ele é composto, fundamentalmente, por blocos `unit` e, opcionalmente, por blocos `stack` (que abordaremos na seção de composição).

Cada bloco `unit` declara uma instância de infraestrutura a ser materializada:

```hcl
# live/prod/terragrunt.stack.hcl

unit "vpc" {
  source = "git::git@github.com:sua-org/catalog.git//units/vpc?ref=v2.3.0"
  path   = "vpc"

  values = {
    cidr_block = "10.0.0.0/16"
    azs        = ["us-east-1a", "us-east-1b"]
  }
}

unit "database" {
  source = "git::git@github.com:sua-org/catalog.git//units/database?ref=v2.3.0"
  path   = "database"

  values = {
    engine_version = "16.3"
    multi_az       = true
  }
}
```

Três atributos definem cada unit:

- **`source`:** a origem da unit. O uso de uma referência versionada (`?ref=v2.3.0`) é o que confere à coleção a capacidade de ser atualizada de forma explícita e reversível.
- **`path`:** o caminho relativo onde a unit será gerada dentro do diretório `.terragrunt-stack`.
- **`values`:** o mapa de valores injetado na unit no momento da geração.

A ausência de qualquer `terragrunt.hcl` no diretório de produção é intencional. O que existe é a descrição da coleção; a coleção em si é gerada.

## O Fluxo de Valores: `values` e `terragrunt.values.hcl`

O atributo `values` é o mecanismo que resolve o problema da duplicação. Ele permite instanciar a mesma `source` com parâmetros distintos por ambiente, sem replicar arquivos.

Durante a geração, o Terragrunt materializa o conteúdo do bloco `values` em um arquivo `terragrunt.values.hcl`, depositado no diretório da unit. A definição da unit, por sua vez, consome esses dados através do objeto `values`:

```hcl
# catalog/units/database/terragrunt.hcl

terraform {
  source = "git::git@github.com:sua-org/modules.git//rds?ref=v4.1.0"
}

inputs = {
  engine_version = values.engine_version
  multi_az       = values.multi_az
}
```

O contrato é claro e explícito. A unit no catálogo declara uma interface de valores que espera receber, e o `terragrunt.stack.hcl` de cada ambiente preenche essa interface. Você define a unit uma única vez e a reutiliza em `dev`, `staging` e `prod`, variando apenas o conteúdo do bloco `values`.

Essa separação entre a definição da unit e a sua parametrização é o que torna o modelo verdadeiramente **DRY** (Don't Repeat Yourself: o princípio de não repetir a mesma definição em múltiplos lugares).

## Composição em Escala: Stacks Aninhados e Catálogos

O modelo explícito não se limita a units. Um `terragrunt.stack.hcl` pode referenciar outros stacks por meio do bloco `stack`, habilitando a composição hierárquica.

```hcl
# live/prod/terragrunt.stack.hcl

stack "networking" {
  source = "git::git@github.com:sua-org/catalog.git//stacks/networking?ref=v2.3.0"
  path   = "networking"

  values = {
    environment = "prod"
  }
}
```

Esse mecanismo viabiliza o conceito de **catálogo de infraestrutura**: um repositório versionado que expõe stacks reutilizáveis (uma malha de rede completa, uma plataforma de dados, um ambiente Kubernetes), consumidos por diferentes equipes e ambientes.

A vantagem estratégica é a governança. Uma atualização no stack de rede do catálogo, promovida para a versão `v2.4.0`, propaga-se para todos os ambientes de forma controlada, com a simples alteração de uma referência. A coleção de infraestrutura passa a ter um ciclo de release próprio, equiparável ao de qualquer outro artefato de software.

## Geração Sob Demanda: O Ciclo de Vida do `.terragrunt-stack`

Definida a coleção, ela precisa ser materializada. O Terragrunt expõe um conjunto de subcomandos dedicados ao ciclo de vida do stack explícito:

```bash
# Materializa todas as units e stacks no diretório .terragrunt-stack
terragrunt stack generate

# Executa um comando sobre a stack gerada, em ordem de dependência
terragrunt stack run plan

# Consolida os outputs de todas as units pertencentes à stack
terragrunt stack output
```

O diretório `.terragrunt-stack` resultante é um produto da geração, e não uma fonte da verdade. Em um fluxo maduro, no qual o pipeline de CI/CD executa `terragrunt stack generate` por conta própria, esse diretório deve ser excluído do versionamento:

```gitignore
# .gitignore
.terragrunt-stack/
```

Você inspeciona o conteúdo gerado localmente antes de qualquer aplicação, garantindo que a materialização produza exatamente as units esperadas. A natureza determinística dessa geração é o que torna o modelo confiável.

## A Decisão: Quando Adotar Cada Modelo

A escolha entre implícito e explícito não é uma questão de preferência estética, e sim de escala e governança. O critério a seguir orienta a decisão:

1. **Permaneça com stacks implícitos quando** o número de units é reduzido, cada unit é genuinamente única e a transparência total da árvore de diretórios é mais valiosa do que a redução de duplicação.
2. **Adote stacks explícitos quando** há múltiplos ambientes que compartilham os mesmos padrões, quando a duplicação de arquivos `terragrunt.hcl` já se tornou um custo de manutenção, ou quando a infraestrutura precisa ser versionada e distribuída como um catálogo.

A migração entre os dois modelos é incremental. Units soltas e stacks explícitos coexistem no mesmo repositório, o que permite uma adoção gradual, ambiente por ambiente.

## O Impacto na Engenharia de Plataforma

A introdução dos stacks explícitos representa mais do que uma otimização de organização de arquivos. Ela altera o paradigma de propriedade e distribuição da infraestrutura.

Ao converter coleções de units em artefatos versionados, a Engenharia de Plataforma ganha a capacidade de tratar infraestrutura como um produto interno. Times de aplicação consomem stacks de um catálogo curado, sem precisar compreender os detalhes de implementação de cada módulo. A equipe de plataforma, por sua vez, evolui esses stacks de forma centralizada, com versionamento semântico e ciclos de release controlados.

Essa é a transição de uma operação baseada em convenção de diretórios para uma operação baseada em contratos versionados. É a diferença entre manter infraestrutura e distribuí-la como capacidade.

## Conclusão

O Terragrunt Stacks não são uma renomeação. O modelo implícito reflete a estrutura de arquivos; o modelo explícito a substitui por uma declaração versionada, parametrizável e componível. A primeira abordagem é adequada para repositórios pequenos e específicos; a segunda é o caminho para a escala, a reutilização e a governança.

Próximo passo: identifique, no seu repositório, um padrão de unit que se repete em três ou mais ambientes. Extraia-o para um catálogo versionado, descreva-o em um `terragrunt.stack.hcl` e execute `terragrunt stack generate`. A comparação entre a contagem de arquivos antes e depois é a métrica que justifica a adoção do modelo explícito.
