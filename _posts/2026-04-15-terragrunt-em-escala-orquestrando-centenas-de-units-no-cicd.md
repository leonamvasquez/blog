---
title: "Terragrunt em Escala: Orquestrando Centenas de Units no CI/CD com run --all e Detecção de Drift"
description: "Aprenda a orquestrar centenas de units do Terragrunt em uma esteira de CI/CD escalável, executando apenas o delta afetado com --filter-affected, gerando relatórios estruturados de execução e implementando detecção contínua de Configuration Drift via GitOps."
date: 2026-04-15 19:00:00 -0300
categories: [Terraform, Platform Engineering, SRE]
tags: [Terragrunt, CI/CD, Drift Detection, GitOps, IaC, Platform Engineering]
icons: [terraform, terragrunt]
---

## Introdução

Existe uma percepção equivocada de que a simples adoção do Terragrunt como camada de orquestração sobre o OpenTofu/Terraform torna, automaticamente, a esteira de Integração e Entrega Contínua (CI/CD) escalável. Na realidade operacional, o oposto costuma ocorrer.

À medida que o repositório de infraestrutura evolui de dezenas para centenas de **units** (uma unit é o diretório que contém um único `terragrunt.hcl`, com estado e ciclo de vida próprios), o pipeline ingênuo passa a executar `terragrunt run --all plan` sobre a totalidade do grafo a cada Pull Request. O resultado é uma esteira lenta, dispendiosa e, paradoxalmente, mais arriscada.

Este artigo disseca a arquitetura de execução do `run --all` no Terragrunt 1.0 e estabelece os padrões de engenharia necessários para construir pipelines que operam sobre o **delta** (apenas o conjunto de units efetivamente alterado), produzem telemetria estruturada e incorporam a detecção contínua de **Configuration Drift** (Desvio de Configuração: quando o estado real provisionado na nuvem deixa de corresponder ao código declarado).

## O Problema de Escala: O Custo do Grafo Completo

Antes de otimizar, é necessário compreender a origem do custo. O Terragrunt modela as relações entre units como um **DAG** (Directed Acyclic Graph: um Grafo Acíclico Dirigido), construído a partir dos blocos `dependency`.

Em um pipeline que aciona `run --all` sem qualquer restrição, o Terragrunt percorre esse grafo por inteiro. Para um repositório de larga escala, isso impõe três penalidades estruturais:

1. **Latência de execução.** Cada unit dispara um processo de `init` e `plan`, autenticando-se no provedor de nuvem. Centenas de units transformam um job de minutos em uma operação de dezenas de minutos.
2. **Custo computacional e de API.** A reavaliação integral do estado a cada commit consome cotas de API do provedor e tempo de runner de forma desnecessária.
3. **Raio de impacto ampliado.** Um `apply` que abrange todo o grafo (em vez do delta) eleva o **blast radius** (raio de impacto) de qualquer alteração, ainda que a mudança real tenha sido pontual.

A maturidade em Engenharia de Plataforma exige que o pipeline reflita a natureza incremental das alterações. Você não modificou trezentas units; modificou três.

## A Anatomia do `run --all` no Terragrunt 1.0

No Terragrunt 1.0, a orquestração de múltiplas units foi consolidada sob o comando `run --all`, que substitui o antigo `run-all`. O comando preserva a garantia fundamental do Terragrunt: a execução respeita estritamente a ordem topológica do DAG de dependências.

A invocação canônica em um ambiente de automação assume a seguinte forma:

```bash
# Executa o comando em todas as units, em ordem de dependência,
# sem prompts interativos e com paralelismo controlado.
terragrunt run --all apply \
  --non-interactive \
  --parallelism 10
```

Os parâmetros relevantes para o contexto de CI/CD são:

- **`--non-interactive`:** suprime qualquer solicitação de confirmação. É obrigatório em runners não interativos, sob risco de o job travar indefinidamente.
- **`--parallelism`:** define o grau de concorrência entre units independentes. Valores elevados aceleram a execução, porém ampliam a pressão sobre a API do provedor.

O comando, por si só, resolve a ordem de execução. O que ele não resolve, em sua forma básica, é a abrangência. Para isso, recorremos à camada de filtragem.

## Filtragem do Delta: `--filter` e `--filter-affected`

O sistema de filtros é, provavelmente, a funcionalidade mais subutilizada do Terragrunt. Ele restringe a fila de execução a um subconjunto específico de units, e é o mecanismo que viabiliza a escalabilidade real do pipeline.

Dois modos de operação concentram a maior parte dos casos de uso:

```bash
# 1. Executa apenas as units alteradas em relação à branch padrão.
#    Ideal para validação de Pull Requests.
terragrunt run --all plan --filter-affected

# 2. Restringe a execução a um caminho específico via glob.
#    Ideal para isolar um ambiente inteiro.
terragrunt run --all apply --filter './live/prod/**'
```

A flag `--filter-affected` computa o conjunto de units modificadas comparando o estado atual com a branch padrão do repositório. Por essa razão, o checkout no pipeline deve recuperar o histórico completo do Git, e não apenas o último commit. Sem isso, o cálculo do delta é impreciso.

Em repositórios de produção, a adoção dessa filtragem é o que diferencia uma esteira que executa em quatro minutos de uma que executa em quarenta.

## Telemetria de Execução: Relatórios Estruturados

Um pipeline maduro não apenas executa, mas reporta. O Terragrunt oferece a geração de relatórios estruturados de execução, que substituem a frágil prática de parsear linhas de log com expressões regulares.

```bash
# Gera um relatório estruturado da execução em formato JSON.
terragrunt run --all plan \
  --filter-affected \
  --non-interactive \
  --report-file run-report.json \
  --report-format json
```

O artefato resultante (`run-report.json`) é um documento determinístico que descreve, por unit, o resultado da operação. A partir dele, a esteira pode:

- Construir um sumário consolidado do deploy para publicação no Pull Request.
- Disparar notificações segmentadas (por exemplo, alertar apenas as equipes cujas units falharam).
- Alimentar dashboards de observabilidade da plataforma com dados de execução.

A telemetria transforma o pipeline de uma caixa-preta em um sistema auditável. Essa é a base sobre a qual a governança operacional se sustenta.

## A Esteira de Validação em GitHub Actions

A composição desses elementos resulta em uma esteira de dois estágios: validação no Pull Request e aplicação no merge. O exemplo a seguir utiliza a action oficial da Gruntwork, com as versões das ferramentas fixadas declarativamente via `mise.toml`.

```toml
# mise.toml
# Fixa as versões das ferramentas, garantindo paridade entre o ambiente
# local do engenheiro e o runner de CI.
[tools]
terragrunt = "1.0.0"
opentofu   = "1.10.1"
```

```yaml
# .github/workflows/terragrunt-ci.yml
name: Terragrunt CI

on:
  pull_request:
    branches: [main]

jobs:
  plan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0   # histórico completo, necessário para o cálculo do delta

      - name: Instalar Terragrunt e OpenTofu
        uses: gruntwork-io/terragrunt-action@v3

      - name: Plan das units afetadas
        run: |
          terragrunt run --all plan \
            --filter-affected \
            --non-interactive \
            --report-file plan-report.json \
            --report-format json

      - name: Publicar relatório no Pull Request
        run: ./scripts/comment-report.sh plan-report.json
```

A aplicação, restrita à branch principal, segue o mesmo princípio de delta:

```yaml
  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gruntwork-io/terragrunt-action@v3

      - name: Apply das units afetadas
        run: |
          terragrunt run --all apply \
            --filter-affected \
            --non-interactive
```

O ponto arquitetural a reter é que o pipeline jamais opera sobre o grafo completo. Ele opera sobre a intenção real de cada commit.

## Detecção Contínua de Drift como Job Agendado

A esteira descrita valida e aplica mudanças intencionais. Ela não captura, contudo, as alterações realizadas fora do fluxo de IaC: intervenções manuais no console, ajustes emergenciais durante incidentes ou scripts legados operando *out-of-band*. Esse é o território do Configuration Drift.

A detecção de Drift não deve depender da execução ocasional de um `plan` antes de um deploy. Ela deve ser um job autônomo e agendado, dedicado exclusivamente à reconciliação de estado.

O núcleo técnico dessa automação reside no parâmetro `-detailed-exitcode`, repassado ao OpenTofu/Terraform. Seu comportamento de saída é o sinal que interpretamos:

1. **Exit Code 0:** Conformidade total. O estado real corresponde ao código declarado.
2. **Exit Code 1:** Erro de execução (falha de sintaxe ou credenciais inválidas).
3. **Exit Code 2:** Há alterações pendentes. Em um job agendado, sem código novo, este é o sinal inequívoco de Drift.

```yaml
# .github/workflows/drift-detection.yml
name: Drift Detection

on:
  schedule:
    - cron: "0 6 * * *"   # reconciliação diária, às 06:00 UTC

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: gruntwork-io/terragrunt-action@v3

      - name: Reconciliação de estado
        run: |
          terragrunt run --all plan \
            --non-interactive \
            -- -detailed-exitcode
```

Quando o job retorna o código 2, o pipeline deve acionar um alerta direcionado à equipe responsável, idealmente enriquecido com o relatório estruturado da execução. O tratamento aprofundado das estratégias de remediação e prevenção foi detalhado em [O Pesadelo do Drift: Como Detectar e Corrigir Alterações Manuais na Infraestrutura](https://leonam.io/posts/o-pesadelo-do-drift-detectar-corrigir-alteracoes-manuais-infraestrutura/).

## O Impacto na Engenharia de Plataforma

A combinação de filtragem por delta, telemetria estruturada e detecção contínua de Drift transcende a otimização de tempo de pipeline. Ela redefine a relação da organização com sua infraestrutura.

Ao restringir cada execução ao escopo real da mudança, a plataforma reduz o raio de impacto e, com ele, a probabilidade de incidentes derivados de aplicações abrangentes e não intencionais. Ao produzir relatórios determinísticos, ela converte a operação em um processo auditável e mensurável. Ao reconciliar o estado de forma autônoma, ela garante que a premissa fundamental da IaC, o código como única fonte da verdade, permaneça válida ao longo do tempo.

Essa é a maturidade que distingue uma equipe que apenas utiliza o Terragrunt de uma equipe que o opera como um sistema de governança de infraestrutura.

## Conclusão

A escalabilidade do Terragrunt em CI/CD não emerge do comando `run --all` isoladamente, mas da disciplina de restringi-lo. A filtragem do delta, a telemetria estruturada e a detecção contínua de Drift formam, em conjunto, a espinha dorsal de uma esteira que escala de forma linear, e não exponencial, com o crescimento da infraestrutura.
