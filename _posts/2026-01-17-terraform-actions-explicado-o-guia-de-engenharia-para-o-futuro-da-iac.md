---
title: "Terraform Actions Explicado: O Guia de Engenharia para o Futuro da IaC"
date: 2026-01-17 00:32:27 -0300
categories: [Terraform, Architecture, Engineering]
tags: [Terraform, IaC, HashiCorp]
---

## Introdução

A evolução da Infraestrutura como Código (IaC) sempre esbarrou em um limite arquitetural claro: a barreira entre o **Declarativo** (o estado desejado da infraestrutura) e o **Imperativo** (as ações necessárias para operá-la).

O Terraform dominou o mundo declarativo (Day-0 e Day-1). No entanto, para operações de **Day-2**, tarefas que não alteram a topologia da infraestrutura, mas são necessárias para seu funcionamento, como rodar migrations de banco, limpar caches ou disparar webhooks, até então eramos forçados a utilizar anti-padrões. O uso excessivo de `null_resource` e provisionadores `local-exec` criou bases de código frágeis, dependentes de Shell script e ferramentas externas instaladas no runner de CI/CD.

Com a chegada do Terraform 1.14, a HashiCorp introduz uma mudança de paradigma fundamental: **Terraform Actions**.

Este artigo serve como o guia para profissonais que desejam compreender a arquitetura por trás das Actions e como elas substituem scripts imperativos por construções nativas de IaC.

## O Problema de Arquitetura: Side-Effects

No modelo mental clássico do Terraform, tudo é um recurso (`resource`) ou uma fonte de dados (`data`). Recursos têm ciclo de vida CRUD (Create, Read, Update, Delete).

Porém, muitas operações operacionais são **Side-Effects** (efeitos colaterais).
* *Invalidar um cache do CloudFront* não cria um novo recurso; é uma ação pontual.
* *Invocar uma Lambda de Seed* é um evento, não um estado.

Tentar forçar esses eventos dentro de recursos (como fazemos com `null_resource`) quebra o modelo de estado. O Terraform Actions resolve isso introduzindo um novo bloco de primeira classe: `action`.

## Anatomia de uma Action

Diferente de um `local-exec`, onde você escreve o script, uma **Action é definida pelo Provider**. Isso transfere a responsabilidade da implementação do usuário (consumidor) para o desenvolvedor do Provider (AWS, Azure, GCP).

Isso garante que a ação seja executada utilizando a autenticação segura e o contexto já configurado no provider, eliminando a necessidade de CLI externas (como `aws-cli` ou `az-cli`) no ambiente de execução.

### Exemplo Prático: Provisionamento de Aplicação

Vamos analisar um cenário onde, após subir uma EC2, precisamos rodar um Playbook Ansible.

**O Jeito Antigo (Anti-padrão):**
```hcl
resource "null_resource" "run_ansible" {
  provisioner "local-exec" {
    command = "ansible-playbook -i ${aws_instance.app.public_ip}, playbook.yml"
  }
}
```

**O Novo Padrão (Terraform Actions):**

```hcl
# 1. Configuração da Ação
action "ansible_playbook" "app_provisioning" {
  config {
    playbook_path  = "${path.module}/playbook.yml"
    host           = aws_instance.app.public_ip
    ssh_public_key = aws_key_pair.app.public_key
  }
}

# 2. O Gatilho no Ciclo de Vida
resource "aws_instance" "app" {
  # ... configurações da instância ...

  lifecycle {
    action_trigger {
      events  = [after_create]
      actions = [action.ansible_playbook.app_provisioning]
    }
  }
}
```

Observe a diferença de arquitetura: não há concatenação de strings bash. Os dados fluem nativamente entre os recursos do Terraform e a configuração da ação.

Execução Ad-Hoc: O Comando -invoke
Talvez a inovação mais significativa para equipes de DevOps/Platform Enginner seja a capacidade de executar ações isoladas, sem passar pelo ciclo completo de plan e apply.

Imagine que você precise rodar a migration do banco de dados manualmente, ou reiniciar um serviço específico. Com Terraform Actions, isso é feito via CLI:

```bash
terraform apply -invoke action.ansible_playbook.app_provisioning
```

Isso permite que pipelines de CI/CD executem tarefas operacionais complexas utilizando a mesma base de código da infraestrutura, garantindo que a configuração usada para a ação seja idêntica à definida no código (Single Source of Truth).

Casos de Uso e Padrões de Engenharia
Ao adotar Terraform Actions, pessoalmente recomendo os seguintes padrões:

1. Database Initializers
Substitua scripts de seed SQL rodados via psql ou mysql client por Actions nativas que invocam funções serverless (Lambda/Azure Functions) para popular o banco de dados recém-criado.

2. Observabilidade de Deploy
Utilize actions para registrar eventos de deploy em ferramentas de monitoramento.

```hcl
action "datadog_event" "deployment" {
  config {
    title = "Terraform Apply Finished"
    text  = "Infrastructure updated successfully"
  }
}
```

3. GitOps para Configuração de VMs
Em vez de usar user_data complexos e difíceis de debugar, utilize actions para disparar provisionadores (Ansible/Chef/Salt) após a confirmação de que a instância está online e acessível.

## Conclusão
O Terraform Actions não é apenas uma nova feature; é o amadurecimento da ferramenta para cobrir todo o espectro do Platform Engineering.

Ao eliminar a dependência de scripts imperativos e trazer as operações de Day-2 para dentro do grafo de recursos do Terraform, ganhamos em segurança, portabilidade e manutenibilidade. É o fim da era das "gambiarras" com null_resource e o início de uma automação verdadeiramente nativa.