---
title: "OpenTofu no CI/CD: Trocando o Motor sem Reescrever o Pipeline"
description: "Aprenda a adaptar sua esteira de CI/CD existente para o OpenTofu: instalação do binário no runner, tratamento do arquivo de lock, convivência com o Terragrunt e estratégia de migração gradual por repositório."
date: 2026-05-29 19:00:00 -0300
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, CI/CD, GitHub Actions, Terragrunt, IaC, DevOps]
icons: [opentofu]
---

## Introdução

Uma esteira de CI/CD madura costuma ser a parte mais estável da operação de infraestrutura. Roda há meses, tem aprovação configurada, segredo ajustado e um histórico de execuções que ninguém quer mexer sem necessidade.

Por isso, a dúvida mais comum de quem pensa em adotar o OpenTofu quase nunca é sobre a ferramenta em si. É sobre o pipeline: quanto disso precisa ser reescrito?

A resposta curta: quase nada. Na maioria dos casos, a mudança se resume ao passo que instala o binário e ao nome do comando executado. Tem um ponto que costuma quebrar na primeira rodada, o arquivo de lock, e ele ganha seção própria mais à frente.

Se você ainda não conhece a arquitetura da ferramenta, ela está detalhada em [Como o OpenTofu Funciona: Arquitetura, Comandos e Compatibilidade com o Terraform](https://leonam.io/posts/como-o-opentofu-funciona-arquitetura-comandos-compatibilidade-terraform/).

## O Que Realmente Muda no Pipeline

Vale começar demarcando o tamanho do problema. Uma esteira típica de IaC roda quatro etapas: instala o binário, autentica no provedor de nuvem, gera o plano e o aplica.

Dessas quatro, só duas são afetadas pela troca:

- **A instalação do binário.** Troca-se a action ou o passo que baixa o Terraform pelo equivalente do OpenTofu.
- **O nome do comando.** `terraform` vira `tofu`.
O resto fica igual. Autenticação no provedor, configuração do backend remoto, segredos do repositório, políticas de aprovação e estrutura de jobs continuam exatamente como estão. Nenhum desses elementos sabe distinguir os dois binários.

Existe ainda um terceiro ponto, que não é etapa de pipeline, mas costuma ser o primeiro a quebrar: o arquivo de lock. Fica para seção própria, porque pede atenção.

## Instalando o OpenTofu no Runner

O projeto mantém action oficial para o GitHub Actions. A troca é direta:

```yaml
# Antes
- uses: hashicorp/setup-terraform@v3
  with:
    terraform_version: 1.9.0

# Depois
- uses: opentofu/setup-opentofu@v2
  with:
    tofu_version: 1.12.0
```

Dois detalhes de comportamento merecem nota.

O primeiro é a verificação de integridade. Por padrão, a action confere o arquivo baixado contra o checksum SHA-256 publicado na release, e só pula essa verificação, com aviso, quando o checksum não pode ser obtido. Dá para fixar os hashes esperados manualmente também, se sua política de segurança pedir isso.

O segundo é o cache do binário. Pode ser habilitado, mas só faz diferença real em runner próprio, já que runner hospedado é efêmero e não guarda cache entre execuções:

```yaml
- uses: opentofu/setup-opentofu@v2
  with:
    tofu_version: 1.12.0
    cache: true
```

Para outras plataformas de CI, o princípio é o mesmo: trocar o passo que instala o binário. Em pipeline baseado em container, troca-se a imagem base. Em pipeline que usa gerenciador de versão, ajusta-se a declaração da ferramenta.

## O Arquivo de Lock: o Ponto de Atenção

Aqui mora a falha mais comum na primeira execução, e ela tem causa específica.

O OpenTofu baixa providers do próprio registry. O provider é o mesmo binário, mas o endereço de origem gravado no arquivo `.terraform.lock.hcl` muda, e os hashes também. Um arquivo de lock gerado pelo Terraform tende, por isso, a falhar na verificação.

A correção é regenerar o lock e versionar o resultado:

```bash
rm .terraform.lock.hcl
tofu init
git add .terraform.lock.hcl
git commit -m "Regenera lock file para OpenTofu"
```

Existe um segundo problema, mais sutil, que aparece quando a estação de trabalho e o runner rodam sistemas diferentes. O lock guarda hashes por plataforma. Se foi gerado num macOS, só terá os hashes correspondentes, e o pipeline rodando em Linux vai quebrar.

A prevenção é gerar os hashes de todas as plataformas envolvidas:

```bash
tofu providers lock \
  -platform=linux_amd64 \
  -platform=linux_arm64 \
  -platform=darwin_arm64
```

Vale ainda garantir que ninguém esqueça de versionar o arquivo atualizado. Um passo simples resolve:

```yaml
- name: Verifica se o lock file está versionado
  run: git diff --exit-code .terraform.lock.hcl
```

## O Pipeline Completo

Juntando tudo, uma esteira de validação em Pull Request e aplicação na branch principal fica assim:

```yaml
name: Infraestrutura

on:
  pull_request:
  push:
    branches: [main]

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: opentofu/setup-opentofu@v2
        with:
          tofu_version: 1.12.0

      - name: Inicializa
        run: tofu init

      - name: Verifica formatação
        run: tofu fmt -check -recursive

      - name: Valida a configuração
        run: tofu validate

      - name: Gera o plano
        run: tofu plan -no-color -out=plano.tfplan

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: producao
    steps:
      - uses: actions/checkout@v4

      - uses: opentofu/setup-opentofu@v2
        with:
          tofu_version: 1.12.0

      - name: Aplica
        run: |
          tofu init
          tofu apply -auto-approve
```

Compare esse arquivo com o seu pipeline atual de Terraform. As diferenças se resumem à action de instalação e ao nome do comando. Estrutura de jobs, condições, ambiente protegido e ordem das etapas seguem idênticos.

## Quando o Terragrunt Está no Meio

Se sua esteira usa Terragrunt, a situação fica ainda mais tranquila, porque a camada de orquestração foi projetada para ser independente do binário de execução.

As versões atuais do Terragrunt já chamam o `tofu` por padrão. Ainda assim, vale declarar a escolha de forma explícita, para a configuração não depender do que está instalado no runner:

```hcl
# root.hcl
terraform_binary = "tofu"
```

A alternativa por variável de ambiente ajuda quando a decisão precisa mudar por pipeline:

```bash
export TG_TF_PATH=$(which tofu)
```

Para confirmar qual binário está de fato em uso, existe comando de diagnóstico:

```bash
terragrunt info print
```

Um detalhe prático que poupa tempo de depuração: a action de instalação do OpenTofu cria, por padrão, um wrapper em volta do binário para expor saída e código de retorno. Esse wrapper pode confundir o Terragrunt na detecção da versão. Quando os dois convivem no mesmo job, desabilite:

```yaml
- uses: opentofu/setup-opentofu@v2
  with:
    tofu_wrapper: false
```

Toda a estrutura de units, dependências e ambientes fica intocada. É exatamente o benefício de manter a orquestração separada da execução.

## Migração Gradual: Um Repositório por Vez

A tentação natural é converter tudo de uma vez. É a abordagem errada, por um motivo simples: se algo falhar, você não vai saber qual mudança causou a falha.

Uma sequência que funciona:

1. **Comece pelo repositório menos crítico.** De preferência um ambiente de desenvolvimento, com poucos recursos.
2. **Troque só no job de plano.** Mantenha o `apply` no Terraform por alguns dias e compare as saídas dos dois planos.
3. **Promova o `apply` quando os planos baterem.** Sem recurso marcado para recriação, a troca é segura.
4. **Repita nos demais repositórios.** A cada rodada o processo fica mais rápido, porque os problemas já são conhecidos.
Essa cadência permite reverter a qualquer momento, com custo de uma linha alterada no arquivo do pipeline.

## Conclusão

Trocar o motor de execução da sua esteira é, na maioria dos casos, uma alteração de duas linhas: a action que instala o binário e o nome do comando. O arquivo de lock é o único ponto que exige atenção real, e se resolve regenerando o arquivo com os hashes das plataformas certas.
