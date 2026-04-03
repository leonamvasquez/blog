---
title: "Compliance as Code: Bloqueando Deploys Inseguros com OPA (Open Policy Agent) e Terraform"
description: "Aprenda a implementar Compliance as Code com OPA (Open Policy Agent) e a linguagem Rego para validar planos do Terraform e bloquear automaticamente configurações inseguras de infraestrutura antes do terraform apply."
date: 2026-03-08 19:00:00 -0300
categories: [Terraform, Security, DevSecOps]
tags: [Terraform, OPA, Open Policy Agent, Rego, Compliance as Code, Security]
icons: [terraform]
---

## Introdução

A escalabilidade de adoção de Infraestrutura como Código (IaC) expõe um gargalo estrutural na esteira de deploy: a validação de compliance de segurança. Quando múltiplos engenheiros submetem Pull Requests com código Terraform diariamente, a auditoria manual via Code Review torna-se uma abordagem insuficiente propensa a omissões críticas como Security Groups com ingress irrestrito (`0.0.0.0/0`) ou recursos provisionados sem as tags de governança obrigatórias.

O paradigma de **Compliance as Code** resolve esse problema ao substituir revisões humanas por políticas declarativas, executáveis e determinísticas, acopladas diretamente à esteira de CI/CD. A ferramenta padrão da indústria para essa abordagem é o **OPA (Open Policy Agent)**, um motor de políticas de propósito geral graduado pela CNCF.



## O Que é o OPA e o conceito de "Shift-Left"

O Open Policy Agent (OPA) é um motor de políticas de propósito geral. Ele desacopla a tomada de decisão da execução. Em vez de escrever regras de segurança hardcoded nos seus scripts de CI/CD, você escreve políticas declarativas usando uma linguagem própria do OPA chamada **Rego**.

Aplicar o OPA no pipeline do Terraform significa trazer a validação de segurança para a esquerda (**Shift-Left**). Em vez de esperar o recurso ser criado na AWS para o *AWS Security Hub* apitar um alerta de vulnerabilidade, o OPA avalia o "plano de voo" e **bloqueia o pipeline antes mesmo do recurso existir**.

## Como o OPA funciona com o Terraform?

O Terraform não interage nativamente com o OPA na sua execução padrão. A integração é viabilizada pelo formato JSON. O fluxo arquitetural é:

1. O Terraform analisa o código e o estado, gerando um plano binário (`terraform plan -out=tfplan`).
2. Convertamos esse plano para uma representação estruturada em JSON (`terraform show -json tfplan > plan.json`).
3. Injetamos o JSON no OPA como **Input**.
4. O OPA cruza o JSON com as **Políticas (Rego)** e emite uma decisão: *Permitir ou Negar*.

## Bloqueando Configurações de Rede Inseguras

Para demonstrar a implementação prática, utilizaremos uma diretriz de segurança comum como caso de uso: **nenhum Security Group da AWS pode permitir tráfego de entrada (ingress) irrestrito de qualquer origem (`0.0.0.0/0`)**.

### 1. Escrevendo a Política em Rego (`policy.rego`)

Rego é uma linguagem baseada em consultas (query language). A lógica de um bloco `deny` é: *se as condições dentro das chaves forem verdadeiras, a regra foi violada e a mensagem é adicionada à lista de negações.*

```rego
package terraform.policies

# Define a regra de negação
deny[msg] {
    # 1. Itera sobre todas as mudanças de recursos no plano do Terraform
    resource := input.resource_changes[_]
    
    # 2. Filtra apenas os recursos que são do tipo 'aws_security_group_rule'
    resource.type == "aws_security_group_rule"
    
    # 3. Filtra apenas ações de criação ou atualização
    resource.change.actions[_] == "create"
    
    # 4. Verifica se o tipo da regra é 'ingress' (entrada)
    resource.change.after.type == "ingress"
    
    # 5. Verifica se algum dos blocos CIDR é '0.0.0.0/0'
    resource.change.after.cidr_blocks[_] == "0.0.0.0/0"
    
    # Se todas as linhas acima forem verdadeiras, formata a mensagem de erro:
    msg := sprintf("VIOLAÇÃO DE SEGURANÇA: A regra '%s' permite tráfego de entrada irrestrito (0.0.0.0/0).", [resource.address])
}
```

### 2. Avaliando o Código (O Pipeline de CI/CD)

No seu pipeline do GitHub Actions, GitLab CI ou Jenkins, o fluxo executado será:

```bash
# 1. Gera o plano do Terraform
terraform plan -out=tfplan

# 2. Converte o plano para JSON
terraform show -json tfplan > plan.json

# 3. Avalia o plano contra a política Rego usando o binário do OPA
opa eval --format pretty --data policy.rego --input plan.json "data.terraform.policies.deny"
```

### 3. O Resultado

Dado um recurso `aws_security_group_rule` com ingress aberto para `0.0.0.0/0`, a saída do OPA será:

```json
[
  "VIOLAÇÃO DE SEGURANÇA: A regra 'aws_security_group_rule.web_ingress' permite tráfego de entrada irrestrito (0.0.0.0/0)."
]
```

No pipeline, basta adicionar um script simples para checar se o array de resposta está vazio. Se não estiver, o CI falha com `exit 1` e o `terraform apply` nunca chega a ser executado.

## Conftest: A Ferramenta do Desenvolvedor

Escrever e rodar comandos `opa eval` nativos pode ser um pouco árduo. Para pipelines de IaC, o ecossistema criou o **Conftest** (que roda o motor do OPA por baixo dos panos).

Com o Conftest, a experiência de validação fica tão simples quanto rodar um linter:

```bash
conftest test plan.json -p policy.rego
```

Saída do Conftest:

```
FAIL - plan.json - main - VIOLAÇÃO DE SEGURANÇA: A regra 'aws_security_group_rule.web_ingress' permite tráfego...
1 test, 1 passed, 0 warnings, 1 failure, 0 exceptions
```

## OPA vs. HashiCorp Sentinel

Se você utiliza o Terraform Cloud/Enterprise, já possui o **HashiCorp Sentinel**, que resolve exatamente o mesmo problema. A desvantagem do Sentinel é o vendor lock-in e o licenciamento pago.

O OPA, por outro lado, é open source e universal. Você pode usar a mesma linguagem Rego para validar não apenas o Terraform, mas também manifestos do Kubernetes, permissões de APIs, configurações do Envoy/Consul e arquivos Docker. Isso unifica a linguagem de Governança da empresa inteira.

## Conclusão

Delegar a responsabilidade da auditoria de segurança à memória ou à atenção de alguém durante um Code Review é uma receita para o desastre (e vazamentos de dados).

Ao implementar o Open Policy Agent, transformamos os manuais de segurança em formato PDF em código executável e determinístico. O **Compliance as Code** não apenas protege a empresa contra configurações equivocadas de infraestrutura, como dá aos desenvolvedores um feedback imediato (e seguro) para corrigirem seus erros antes mesmo de envolverem a equipe de Segurança.
