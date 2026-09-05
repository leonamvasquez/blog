---
title: "Terragrunt como Gerenciador de Runtime: Controlando Versões de OpenTofu e Terraform"
description: "Como usar o Terragrunt para controlar qual binário e qual versão executam sua infraestrutura: terraform_binary, restrições de versão, fixação no CI e migração gradual entre Terraform e OpenTofu."
date: 2026-07-10 19:00:00 -0300
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, OpenTofu, Terraform, CI/CD, Versionamento, IaC]
icons: [terragrunt, opentofu]
---

## Introdução

Em maio de 2024, vários times descobriram na segunda-feira que os pipelines tinham quebrado no fim de semana. A imagem base usada passou a chamar o OpenTofu em vez do Terraform, e as restrições de versão declaradas no código pararam de bater.

Ninguém tinha mudado nada. A mudança veio de fora, por uma tag de imagem que apontava pra versão mais recente.

O episódio é bom lembrete de uma pergunta que costuma ficar sem dono: quem, exatamente, decide qual binário e qual versão rodam sua infraestrutura?

Em repositório que usa Terragrunt, essa resposta pode e deve estar no próprio código.

## Três Perguntas que o Runtime Precisa Responder

Vale organizar o problema antes de resolver, porque ele tem camadas distintas que costumam ser tratadas como uma só:

1. **Qual binário roda?** Terraform ou OpenTofu.
2. **Qual versão é aceitável?** Uma faixa definida, não o que estiver instalado.
3. **Quem instala e fixa essa versão?** A máquina do engenheiro e o runner de CI precisam concordar.

O Terragrunt dá resposta declarativa pras duas primeiras. A terceira depende da esteira, mas ganha rede de proteção quando as duas anteriores estão configuradas.

## Camada 1: Qual Binário Roda

As versões atuais do Terragrunt já chamam `tofu` por padrão. Mesmo assim, declarar a escolha explícita é boa prática, porque tira a dependência do que o ambiente decidiu por você:

```hcl
# root.hcl
terraform_binary = "tofu"
```

Quando a decisão precisa variar por pipeline, existe a variável de ambiente equivalente:

```bash
export TG_TF_PATH=$(which tofu)
```

E pra descobrir o que está de fato em uso, sem chutar:

```bash
terragrunt info print
```

O campo correspondente na saída mostra qual binário vai ser chamado. Esse comando resolve boa parte das dúvidas de ambiente em segundos.

Repare no ganho conceitual: a escolha do motor de execução deixa de ser característica da máquina e passa a ser parte da configuração versionada.

## Camada 2: Qual Versão é Aceitável

Saber qual binário roda não basta. Um plano gerado por uma versão pode diferir do gerado por outra, e é aí que aparecem as divergências entre o que o engenheiro viu localmente e o que o pipeline aplicou.

O Terragrunt permite declarar restrição pros dois lados:

```hcl
# root.hcl
terragrunt_version_constraint = ">= 1.0.0, < 2.0.0"
terraform_version_constraint  = ">= 1.11.0, < 2.0.0"
```

Quando alguém executa fora da faixa, o comando falha antes de qualquer operação, com mensagem que aponta a versão instalada e a exigida. É falha barata, no começo, em vez de comportamento divergente descoberto depois.

Vale notar que o `terraform_version_constraint` existe há tempo e nasceu com outro propósito: permitir usar o Terragrunt com versão ainda não testada oficialmente, relaxando a verificação interna. O mesmo mecanismo serve pro oposto, que é apertar a faixa aceita.

## Camada 3: A Restrição que o Motor Enxerga

Existe ainda uma terceira checagem, feita pelo próprio Terraform ou OpenTofu via `required_version`. Como ela vive dentro do código da infraestrutura, costuma acabar duplicada em dezenas de módulos.

O bloco de geração resolve isso a partir da raiz:

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

Com isso, a faixa aceita passa a ser definida num só lugar e propagada pra todas as units. Mudar a política de versões vira alteração de uma linha.

## Camada 4: Instalação e Fixação no CI

As camadas anteriores validam. Esta instala.

A action oficial deixa fixar as duas versões direto no workflow:

```yaml
- name: Instalar Terragrunt e OpenTofu
  uses: gruntwork-io/terragrunt-action@v3
  with:
    tg_version:   "1.0.2"
    tofu_version: "1.11.6"
```

Se você quer escolher o binário de forma explícita, tem o parâmetro de caminho:

```yaml
  with:
    tf_path: "terraform"
```

Existe também a opção de declarar as ferramentas num arquivo próprio de gerenciamento de versão, versionado junto com o repositório. Quando ele está presente, a action usa ele como fonte das versões, o que faz a máquina do engenheiro e o runner lerem exatamente a mesma declaração.

Essa é a configuração que mais reduz o problema de divergência de ambiente, porque tira a duplicação entre o que está no workflow e o que está na estação de trabalho.

## Migração Gradual entre Motores

Existe um uso menos óbvio dessas configurações, e é o mais valioso em repositório grande.

Como a escolha do binário é configuração do Terragrunt, dá pra sobrescrever numa unit específica, independente do que a raiz define. Isso permite migrar de Terraform pra OpenTofu por partes, mantendo a maior parte do repositório no motor atual enquanto uma unit de baixo risco valida o novo.

Se a validação falhar, a reversão é tirar uma linha, e nenhuma outra unit foi afetada.

Esse é o ponto que costuma passar batido: manter a orquestração separada da execução não é preferência estética, é o que torna possível trocar o motor de forma incremental e reversível.

## Cuidados

Dois pontos merecem atenção ao definir suas restrições.

**A numeração dos dois projetos se afastou.** Terraform e OpenTofu compartilham a origem, mas seguem cadência própria de release. Uma faixa escrita pensando num não descreve necessariamente o mesmo conjunto de recursos no outro. Revise as restrições ao trocar de motor, em vez de assumir equivalência.

**A tabela de compatibilidade tem limite conhecido.** A documentação do Terragrunt publica quais combinações são testadas oficialmente e reconhece que, na prática, a compatibilidade é mais ampla do que a tabela mostra. Use a tabela como referência de suporte, não como fronteira absoluta do que funciona.

## Conclusão

Restrição de versão parece burocracia até o dia em que um plano diferente é aplicado por causa de um binário diferente. Depois disso, passa a parecer o mínimo.

O que essas configurações fazem, somadas, é transformar o runtime em parte da configuração versionada. Some a pergunta sobre o que está instalado na máquina de quem executou, porque a resposta está no repositório, sujeita a revisão como qualquer outra decisão de arquitetura.

Essa mudança tem um efeito colateral que talvez seja o mais importante: torna a troca de motor uma operação técnica reversível, não um projeto. Quando o Terragrunt sabe declarar qual binário chamar e qual faixa aceitar, migrar entre Terraform e OpenTofu deixa de ser decisão de infraestrutura irreversível e vira linha de configuração que você testa numa unit e desfaz no dia seguinte.
