---
title: "Terragrunt como Gerenciador de Runtime: Controlando a Versão do Terraform"
description: "Como usar o Terragrunt para controlar qual versão do Terraform executa sua infraestrutura: restrições de versão, geração do bloco required_version, fixação no CI e rollout gradual entre units."
date: 2026-07-10 19:00:00 -0300
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Terraform, CI/CD, Versionamento, IaC]
icons: [terragrunt, terraform, opentofu]
---

## Introdução

Duas execuções da mesma configuração podem produzir planos diferentes sem que uma linha de código tenha mudado. Basta que a versão do Terraform usada para gerar cada plano seja diferente.

O cenário se repete com frequência parecida em times que operam infraestrutura: uma configuração passa a usar um recurso de linguagem recém-lançado, é testada localmente com sucesso e segue para revisão. O merge dispara o pipeline, e o pipeline falha, porque o runner de CI está numa versão mais antiga do Terraform, que não reconhece a sintaxe usada.

A causa raiz é sempre a mesma: nada garantia que a máquina local e o runner de CI rodassem a mesma versão. Em repositórios que usam Terragrunt, essa garantia pode e deve estar declarada no próprio código.

## O Que o Runtime Precisa Garantir

Vale organizar o problema antes de resolver, porque ele tem duas perguntas distintas que costumam ser tratadas como uma só:

1. **Qual versão do Terraform é aceitável?** Uma faixa definida, e não o que estiver instalado em cada máquina.
2. **Quem instala e fixa essa versão?** A máquina local e o runner de CI precisam concordar, sem depender de memória ou de um README desatualizado.

O Terragrunt oferece resposta declarativa para a primeira pergunta. A segunda depende da sua esteira de CI, mas ganha uma rede de proteção quando a primeira já está configurada.

## Restringindo a Versão do Terraform

O Terragrunt permite declarar a faixa aceita diretamente na raiz da configuração:

```hcl
# root.hcl
terragrunt_version_constraint = ">= 1.0.0, < 2.0.0"
terraform_version_constraint  = ">= 1.11.0, < 2.0.0"
```

Quando alguém executa fora dessa faixa, o comando falha antes de qualquer operação, com uma mensagem que aponta a versão instalada e a exigida. É uma falha barata, no início, em vez de um comportamento divergente descoberto só depois de um `apply` malsucedido.

Para confirmar qual versão está efetivamente em uso, sem depender de suposição:

```bash
terragrunt info print
```

O campo correspondente na saída mostra a versão do Terraform que será chamada. Esse comando resolve boa parte das dúvidas de ambiente em poucos segundos.

## A Restrição que o Terraform Enxerga

Existe ainda uma segunda verificação, feita pelo próprio Terraform através do bloco `required_version`. Como ele vive dentro do código da infraestrutura, costuma ficar duplicado em dezenas de módulos.

O bloco de geração do Terragrunt resolve isso a partir da raiz:

```hcl
# root.hcl
generate "versions" {
  path      = "versions.tf"
  if_exists = "overwrite"

  contents = <<EOF
terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.30"
    }
  }
}
EOF
}
```

Com isso, a faixa aceita passa a ser definida em um único lugar e propagada para todas as units. Alterar a política de versões vira uma alteração de uma linha, em vez de uma busca e substituição em dezenas de arquivos.

## Instalação e Fixação no CI

As camadas anteriores validam. Esta instala.

A action oficial permite fixar a versão do Terraform diretamente no workflow:

```yaml
- name: Instalar Terragrunt e Terraform
  uses: gruntwork-io/terragrunt-action@v3
  with:
    tg_version: "1.0.2"
    tf_version: "1.11.6"
```

Há também a possibilidade de declarar a ferramenta em um arquivo próprio de gerenciamento de versões, versionado junto ao repositório. Quando ele está presente, a action o utiliza como fonte da versão, o que faz a máquina local e o runner lerem exatamente a mesma declaração, sem duplicar o número em dois lugares diferentes.

Essa é a configuração que mais reduz o problema de divergência de ambiente, porque elimina a duplicação entre o que está no workflow e o que está na estação de trabalho.

## Rollout Gradual de Versão

Há um uso menos óbvio dessas configurações, e ele é o mais valioso em repositórios grandes.

Como as restrições de versão podem ser sobrescritas em uma unit específica, independentemente do que a raiz define, é possível testar uma nova versão do Terraform em uma unit de baixo risco antes de propagar a mudança para o restante do repositório. Se algo quebrar, a reversão é a remoção de uma linha, e nenhuma outra unit foi afetada.

Esse é o ponto que costuma passar despercebido: manter a orquestração separada da execução não é preferência estética, é o que torna possível testar uma atualização de versão de forma incremental e reversível, em vez de arriscar tudo de uma vez.

## Cuidados

Um ponto merece atenção ao adotar essas restrições: elas validam a versão declarada, não o conteúdo do plano. Duas versões dentro da mesma faixa ainda podem se comportar de forma diferente diante de funcionalidades recém-lançadas ou de mudanças de comportamento documentadas no changelog. A restrição de versão reduz drasticamente a superfície de divergência, mas não substitui a leitura do changelog antes de mover o limite superior da faixa aceita.

## Conclusão

Restrições de versão parecem burocracia até o dia em que um plano diferente é aplicado por causa de uma versão diferente. Depois disso, elas passam a parecer o mínimo.

O que essas configurações fazem, somadas, é transformar o runtime em parte da configuração versionada. Deixa de existir a pergunta sobre o que está instalado na máquina de quem executou, porque a resposta está no repositório, sujeita a revisão como qualquer outra decisão de arquitetura.

Essa mudança tem um efeito secundário que talvez seja o mais importante: torna a atualização de versão uma operação técnica reversível, e não um salto de fé. Quando o Terragrunt sabe declarar qual faixa aceitar e onde instalar a partir dela, subir de versão deixa de ser uma decisão de infraestrutura irreversível e vira uma linha de configuração que você pode testar em uma unit e desfazer no dia seguinte.
