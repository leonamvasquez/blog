---
title: "O Pesadelo do Drift: Como Detectar e Corrigir Alterações Manuais na Infraestrutura"
description: "Entenda o fenômeno de Configuration Drift em infraestruturas gerenciadas com Terraform, aprenda a construir pipelines de detecção automatizada com -detailed-exitcode e implemente estratégias de remediação e prevenção estrutural via GitOps."
date: 2026-03-22 19:00:00 -0300
categories: [Terraform, Platform Engineering, SRE]
tags: [Terraform, Configuration Drift, IaC, GitOps, SRE, Automation]
icons: [terraform]
---

## Introdução

Em arquiteturas de larga escala, a premissa fundamental da Infraestrutura como Código (IaC) é a garantia do determinismo: o código presente na branch principal deve ser a única fonte da verdade para a topologia da nuvem.

No entanto, a realidade operacional frequentemente colide com esse princípio. Intervenções emergenciais durante incidentes, ajustes manuais via console, ou scripts legados atuando *out-of-band* introduzem um fenômeno conhecido como **Configuration Drift** (Desvio de Configuração).

O Drift ocorre quando há uma divergência estrutural entre o estado real provisionado no Cloud Provider (AWS, Azure, GCP) e o estado declarado e mapeado no `terraform.tfstate`. Se não detectado e tratado de forma proativa, o Drift corrompe a confiabilidade do pipeline de IaC, tornando o próximo `terraform apply` uma operação de alto risco, imprevisível e potencialmente destrutiva.

## A Tricotomia do Estado no Terraform

Para mitigar o Drift, é imprescindível compreender como o Terraform avalia a realidade. O ciclo de reconciliação opera sobre três pilares:

1.  **Estado Declarado:** O código HCL nos arquivos `.tf`.
2.  **Estado Registrado:** O arquivo de estado (`terraform.tfstate`), que atua como um cache do último mapeamento bem-sucedido.
3.  **Estado Real:** A configuração física e lógica atual na API do provedor de nuvem.

O Drift se manifesta essencialmente como o delta não intencional entre o **Estado Real** e o **Estado Registrado**.

## Arquitetando um Pipeline de Detecção Contínua

A detecção de Drift não deve depender da execução ocasional de um `terraform plan` antes de um novo deploy. A maturidade em Engenharia de Plataforma exige automação contínua.

A implementação padrão consiste em um job agendado (Cron) na esteira de CI/CD dedicado exclusivamente à reconciliação de estado. O núcleo técnico desta automação reside no parâmetro `-detailed-exitcode` do Terraform, que modifica o comportamento de saída do comando `plan`:

-   **Exit Code 0:** Sucesso sem alterações. A infraestrutura está em conformidade total com o código (Zero Drift).
-   **Exit Code 1:** Erro na execução (falha de sintaxe, credenciais inválidas).
-   **Exit Code 2:** Sucesso, porém **há alterações pendentes**. Em um job agendado sem código novo, este é o sinal técnico de Drift.

### Anatomia de um Job de Detecção

```yaml
name: IaC Configuration Drift Detection
on:
  schedule:
    - cron: '0 8 * * *' # Execução diária às 08:00

jobs:
  drift-detection:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v2

      - name: Terraform Init
        run: terraform init

      - name: Verificação de Drift (Plan)
        id: plan
        # O '|| true' previne que o pipeline quebre no exit code 2,
        # permitindo o tratamento explícito no próximo passo
        run: |
          terraform plan -detailed-exitcode -out=tfplan || export exitcode=$?
          echo "exitcode=$exitcode" >> $GITHUB_OUTPUT

      - name: Alertar via Slack/Teams
        if: steps.plan.outputs.exitcode == '2'
        run: |
          echo "ALERTA CRÍTICO: Configuration Drift detectado na produção."
          # Script para disparar webhook para a equipe de SRE
```

## Estratégias de Remediação

Uma vez detectado, o Drift exige uma decisão de engenharia. Existem dois caminhos para restaurar a integridade do estado:

### 1. Remediação Punitiva (Overwrite)

Se a alteração manual foi indevida ou maliciosa (ex: abertura de uma porta no Security Group sem passar por revisão), a ação correta é forçar o estado desejado sobrescrevendo a alteração.

A execução de um `terraform apply` a partir da branch principal reverte as configurações na nuvem para refletirem exatamente o que está no código HCL.

### 2. Reconciliação e Adoção (Adopt)

Se a alteração manual foi uma mitigação legítima de um incidente (ex: aumento de capacidade de IOPS do banco de dados), reverter a alteração via código causaria degradação no serviço.

Neste cenário, a infraestrutura está correta, mas o código está defasado. A remediação envolve:

1.  Atualizar o código HCL para refletir os novos valores (ex: alterar de `iops = 3000` para `iops = 10000`).
2.  Executar `terraform plan -refresh-only` para atualizar o `tfstate` com a realidade da nuvem.
3.  Executar um `terraform apply` que não resultará em alterações físicas, mas confirmará a sincronicidade entre código e nuvem.

## Prevenção Estrutural: Rumo ao GitOps

A detecção de Drift é o tratamento do sintoma. O tratamento da causa raiz reside na arquitetura de acessos e identidade (IAM).

Para erradicar o Drift em ambientes de produção, as organizações devem transitar para um modelo rigoroso de GitOps onde:

-   Engenheiros humanos possuem apenas permissões de `ReadOnlyAccess` no console da nuvem.
-   A exclusividade das operações de escrita (Write/Mutate) é delegada à Role de IAM assumida pelos runners do pipeline de CI/CD.

## Conclusão

A presença tolerada de Configuration Drift corrói os alicerces da Infraestrutura como Código, reduzindo o Terraform de um motor determinístico de arquitetura para uma mera ferramenta de provisionamento inicial.

Ao estabelecer pipelines de detecção automatizados baseados em `-detailed-exitcode` e impor políticas estritas de acesso à nuvem, as equipes de SRE e Plataforma garantem que o repositório de código permaneça inquestionavelmente como a fonte única da verdade.
