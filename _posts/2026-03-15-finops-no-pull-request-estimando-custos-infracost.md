---
title: "FinOps no Pull Request: Estimando Custos de Nuvem com Infracost antes do Apply"
description: "Aprenda a integrar o Infracost na sua esteira de CI/CD para gerar estimativas de custo diretamente nos Pull Requests do Terraform, combinando com Open Policy Agent para criar guardrails financeiros determinísticos."
date: 2026-03-15 19:00:00 -0300
categories: [Terraform, FinOps, Platform Engineering]
tags: [Terraform, Infracost, FinOps, CI/CD, OPA, Governance]
icons: [terraform]
---

## Introdução

Na construção de esteiras de Integração Contínua (CI) para Infraestrutura como Código (IaC), o padrão da indústria estabeleceu três pilares de validação antes de um `terraform apply`:

1.  **Validação de Sintaxe e Estilo:** `terraform fmt` e `terraform validate`.
2.  **Análise Estática de Segurança (SAST):** Ferramentas como `tfsec` ou `checkov`.
3.  **Validação de Intenção de Estado:** O output do `terraform plan`.

No entanto, há uma ausência crítica de **telemetria financeira**. O `terraform plan` detalha as mutações de estado e as topologias de rede, mas falha em traduzir essas abstrações (ex: alterar `iops` de 3000 para 10000 em um `aws_db_instance`) para impacto financeiro direto. 

Isso relega a governança de custos a processos reativos de auditoria pós-deploy. Para atingir o "Shift-Left" financeiro real, a estimativa de custos deve ser determinística e acoplada ao processo de Code Review. É exatamente essa camada arquitetural que o **Infracost** provê.



## Arquitetura e Funcionamento do Infracost

O Infracost não é um mero parser estático. Ele atua como um motor de resolução de SKUs integrado à sua topologia declarativa. O ciclo de execução ocorre da seguinte forma:

1.  **Ingestão do Plano:** O Infracost consome o output do `terraform plan` convertido para um formato JSON estruturado (`terraform show -json`).
2.  **Mapeamento de Recursos:** O motor interno mapeia os recursos do provider HCL (ex: `aws_instance`) para a taxonomia da Cloud Pricing API.
3.  **Cálculo de Diff:** O sistema não apenas avalia o custo total, mas calcula o delta (diferença) entre o estado atual (`prior_state`) e o estado planejado (`planned_values`), gerando um diff financeiro preciso.

## Implementação na Esteira de CI/CD

A injeção do Infracost no pipeline não deve bloquear a esteira técnica padrão, mas rodar em paralelo como um job de validação analítica. 

Abaixo, a anatomia de implementação em um ambiente GitHub Actions focado em fornecer visibilidade no Pull Request:

```yaml
name: IaC Pipeline - Cost Estimation

on:
  pull_request:
    paths:
      - '**/*.tf'

jobs:
  cost-estimation:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v2
        with:
          terraform_wrapper: false

      - name: Setup Infracost
        uses: infracost/actions/setup@v2
        with:
          api-key: ${{ secrets.INFRACOST_API_KEY }}

      - name: Gerar Plano Terraform
        run: |
          terraform init
          terraform plan -out tfplan.binary
          terraform show -json tfplan.binary > plan.json

      - name: Gerar Breakdown de Custos
        run: infracost breakdown --path plan.json --format json --out-file infracost.json

      - name: Notificar Pull Request
        uses: infracost/actions/comment@v2
        with:
          path: infracost.json
          behavior: update
```

## Governança Ativa: Integrando Infracost e OPA (Open Policy Agent)

Visibilidade financeira é o primeiro passo. O estágio de maturidade final em Engenharia de Plataforma exige **Policy as Code**.

Como o Infracost exporta a estimativa em JSON estruturado, podemos acoplar o **Open Policy Agent (OPA)** para aplicar *Hard Guardrails*. Em vez de depender do discernimento humano para aprovar um salto de custos, definimos regras determinísticas usando a linguagem Rego.

### Exemplo de Política Rego para FinOps

Considere uma diretriz de engenharia: *Nenhum Pull Request pode introduzir um aumento de custo mensal superior a $500 sem aprovação explícita.*

```rego
package terraform.finops

import input as infracost_data

# Define a regra de bloqueio
deny[msg] {
    # Extrai o delta financeiro do JSON gerado pelo Infracost
    diff_mensal := to_number(infracost_data.diffTotalMonthlyCost)
    
    # Condição de violação
    diff_mensal > 500
    
    # Formatação do erro para stdout do CI/CD
    msg := sprintf("BLOCKED BY FINOPS: O incremento de custo previsto ($%.2f) excede o limite estabelecido de $500.00 por PR.", [diff_mensal])
}
```

Ao adicionar uma etapa `opa eval` no pipeline logo após a execução do Infracost, o pipeline falhará propositalmente (Exit Code `1`) caso a condição seja atendida.

## Conclusão

A integração do Infracost transmuta a gestão de custos em nuvem de um processo contábil tardio para uma métrica de engenharia rigorosa, tratada com a mesma seriedade que cobertura de testes e análise de vulnerabilidades.

Ao unificar o Infracost com o Open Policy Agent na esteira de CI/CD, as organizações eliminam o provisionamento inadvertido de recursos dispendiosos. Esta arquitetura assegura que as plataformas em nuvem escalem sob governança determinística, fundindo os interesses de escalabilidade técnica com responsabilidade financeira diretamente na raiz do repositório de infraestrutura.