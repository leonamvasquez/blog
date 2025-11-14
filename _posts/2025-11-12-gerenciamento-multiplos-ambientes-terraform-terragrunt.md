---
title: "Gerenciamento de Múltiplos Ambientes (Dev, Stage, Prod) com Terraform e Terragrunt"
date: 2025-11-12 18:43:52 +0000
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, Terragrunt, Multi-Environment, Best Practices, DRY]
---

## Introdução

Gerenciar um único ambiente de infraestrutura com Terraform é um processo direto. No entanto, em qualquer cenário profissional, a infraestrutura é dividida em múltiplos ambientes, como desenvolvimento (dev), homologação (stage) e produção (prod). Essa divisão é fundamental para testes, segurança e estabilidade.

A gestão de múltiplos ambientes introduz desafios significativos: como manter as configurações consistentes, evitar a repetição de código e garantir o isolamento total do estado (state) de cada ambiente?

Este artigo explora as abordagens para esse problema, comparando a solução nativa do Terraform (baseada em diretórios) com os benefícios de automação e DRY (Don't Repeat Yourself) fornecidos pela ferramenta Terragrunt.

## 1. O Desafio: Múltiplos Ambientes no Terraform Nativo

Existem duas formas de gerenciar ambientes no Terraform nativo.

### Abordagem 1: Terraform Workspaces

Muitos iniciantes recorrem ao `terraform workspace`. Embora pareça ser a solução, workspaces não são recomendados para separação de ambientes. Eles compartilham o mesmo backend de estado (por padrão) e forçam o uso excessivo de lógica condicional (`var.env == "prod" ? ... : ...`) no mesmo código, tornando-o complexo e frágil. A prática padrão da indústria evita workspaces para este fim.

### Abordagem 2: O Padrão de Diretórios

A abordagem nativa correta é usar uma estrutura de diretórios, onde cada ambiente é um módulo raiz separado.

```
.
└── environments/
    ├── dev/
    │   ├── main.tf
    │   ├── terraform.tfvars
    │   └── backend.tf      # Estado isolado para dev
    ├── stage/
    │   ├── main.tf
    │   ├── terraform.tfvars
    │   └── backend.tf      # Estado isolado para stage
    └── prod/
        ├── main.tf
        ├── terraform.tfvars
        └── backend.tf      # Estado isolado para prod
```

Nesta estrutura, `environments/prod/main.tf` chama os módulos necessários com as variáveis de produção, e `environments/dev/main.tf` faz o mesmo com as variáveis de desenvolvimento.

**Problema (Boilerplate):** Esta solução é robusta em termos de isolamento, mas sofre de um grande problema de repetição (boilerplate). O arquivo `backend.tf`, as configurações do provider e, muitas vezes, as próprias chamadas aos módulos `module` são idênticas em 90% e precisam ser copiadas e coladas em todos os diretórios de ambiente.

Se você precisar atualizar a versão do provider ou a configuração do bucket S3 do backend, deverá fazer isso em todos os diretórios. Isso é ineficiente e propenso a erros.

## 2. O que é Terragrunt?

Terragrunt é um wrapper para o Terraform. Ele não substitui o Terraform, ele o orquestra. O Terragrunt foi criado especificamente para resolver os problemas de repetição de código e gerenciamento de estado em múltiplos ambientes.

Seu principal objetivo é manter suas configurações de Terraform **DRY (Don't Repeat Yourself)**.

## 3. Terragrunt em Ação: O Princípio DRY

O Terragrunt introduz um arquivo de configuração `terragrunt.hcl` e utiliza uma estrutura de hierarquia para reduzir drasticamente o boilerplate.

Vamos revisitar nossa estrutura de diretórios, agora com Terragrunt:

```
.
├── terragrunt.hcl      # Configuração RAIZ (DRY)
└── environments/
    ├── dev/
    │   └── app/
    │       └── terragrunt.hcl
    ├── stage/
    │   └── app/
    │       └── terragrunt.hcl
    └── prod/
        └── app/
            └── terragrunt.hcl
```

### A Configuração Raiz (`/terragrunt.hcl`)

No nível raiz, definimos uma vez como nosso backend (estado remoto) deve ser configurado.

**`/terragrunt.hcl`**

```hcl
remote_state {
  backend = "s3"
  config = {
    encrypt        = true
    bucket         = "meu-bucket-de-terraform-state-central"
    key            = "terraform.tfstate" # O Terragrunt irá ajustar isso
    region         = "us-east-1"
    dynamodb_table = "terraform-state-lock"
  }

  # Gera a configuração do backend dinamicamente
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite"
  }
}

# Define o provider que todos os módulos filhos irão usar
generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "us-east-1"
}
EOF
}
```

O Terragrunt irá gerar os arquivos `backend.tf` e `provider.tf` para você em cada módulo filho.

### A Configuração do Ambiente (`/environments/prod/app/terragrunt.hcl`)

Agora, o arquivo de configuração para a aplicação em produção se torna incrivelmente enxuto:

**`/environments/prod/app/terragrunt.hcl`**

```hcl
# Inclui (herda) todas as configurações do arquivo raiz
include {
  path = find_in_parent_folders()
}

# Configura o "key" do S3 dinamicamente para este ambiente
remote_state {
  config = {
    key = "${path_relative_to_include()}/terraform.tfstate"
  }
}

# Define qual o módulo Terraform este arquivo irá executar
terraform {
  source = "github.com/meus-modulos/terraform-aws-app?ref=v1.2.0"
}

# Define as variáveis (inputs) para este ambiente específico
inputs = {
  instance_type = "t3.large"
  environment   = "production"
  min_size      = 5
}
```

Quando você executar `terragrunt apply` neste diretório, o Terragrunt irá:

1. Ler o `terragrunt.hcl` raiz e configurar o backend S3.
2. Gerar o key do S3 como `environments/prod/app/terraform.tfstate`, garantindo isolamento.
3. Baixar o módulo de `terraform { source ... }`.
4. Executar o `terraform apply` passando os `inputs` (variáveis) de produção.

Se você precisar alterar o bucket S3 do backend, você o faz em um único lugar: o `terragrunt.hcl` raiz.

## 4. Benefícios Adicionais do Terragrunt

O DRY é o principal benefício, mas o Terragrunt oferece mais:

**Gerenciamento de Dependências:** O Terraform nativo não sabe "esperar". Se sua aplicação depende de uma VPC, você precisa aplicá-los em ordens separadas. O Terragrunt resolve isso com blocos `dependency`, permitindo que o módulo app declare que depende do módulo vpc e leia as saídas dele.

**Execução Múltipla:** Com as dependências definidas, você pode ir ao diretório raiz (`/environments/prod`) e executar `terragrunt run-all apply`. O Terragrunt irá calcular o grafo de dependência e aplicar todos os módulos (VPC, banco de dados, app) na ordem correta.

## Conclusão

O Terraform nativo, usando o padrão de diretórios, pode gerenciar múltiplos ambientes, mas ao custo de uma alta carga de trabalho manual e repetição de código. Isso é viável para projetos pequenos, mas se torna um gargalo de manutenção em sistemas maiores.

Terragrunt se destaca por resolver exatamente esse problema. Ele não substitui o Terraform, mas o complementa, forçando práticas DRY e fornecendo automação para gerenciamento de estado e dependências.

Para equipes que buscam escalar suas práticas de IaC de forma consistente e segura através de múltiplos ambientes, o Terragrunt adiciona uma camada de orquestração que justifica sua curva de aprendizado.