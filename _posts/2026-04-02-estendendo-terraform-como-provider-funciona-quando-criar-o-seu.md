---
title: "Estendendo o Terraform: Entendendo como um Provider Funciona (e quando criar o seu)"
description: "Disseque a arquitetura de comunicação gRPC entre o Terraform Core e os Providers, compreenda o contrato CRUD do Plugin Framework em Go e estabeleça os critérios de engenharia para justificar a criação de um Provider customizado para sistemas internos."
date: 2026-04-02 19:00:00 -0300
categories: [Terraform, Platform Engineering, Go]
tags: [Terraform, Custom Provider, Go, Golang, IaC, Architecture]
icons: [terraform]
---

## Introdução

Existe um equívoco comum de que o Terraform "sabe" como provisionar recursos na AWS, no Azure ou no Kubernetes. Na realidade arquitetural, o binário principal do Terraform (`terraform core`) é agnosticamente cego em relação a qualquer nuvem ou infraestrutura.

O Terraform Core possui apenas duas responsabilidades fundamentais:

1.  Analisar os arquivos HCL e construir um **Grafo de Dependências** Direcionado e Acíclico (DAG).
2.  Gerenciar o ciclo de vida do arquivo de estado (`terraform.tfstate`).

A capacidade de interagir com APIs externas (criar instâncias, gerenciar permissões) é inteiramente delegada aos **Providers**. Um Provider não é um módulo ou um script; é um binário autônomo, escrito quase exclusivamente em Go, que atua como tradutor entre o Terraform Core e a API do serviço de destino.

Este artigo disseca a arquitetura de comunicação entre o Core e os Plugins e estabelece os critérios de engenharia para justificar a criação de um Provider customizado para sistemas internos da organização.

## Arquitetura Cliente-Servidor via gRPC

Quando você executa um `terraform init`, o Terraform faz o download dos binários dos providers declarados. Ao executar `terraform plan` ou `apply`, o Core inicia esses binários em processos paralelos e realiza a comunicação estritamente via **gRPC** (Remote Procedure Call usando Protobuf) através de sockets locais.

O Core envia mensagens como *"Qual é o esquema deste recurso?"* ou *"Planeje a criação deste recurso com base nestes inputs"*. O Provider, por sua vez, encapsula a lógica de negócio da API alvo, traduz a solicitação para chamadas HTTP REST ou GraphQL adequadas e retorna o resultado estruturado de volta ao Core via gRPC.

## Quando (Não) Criar um Provider Customizado

Antes de engajar um time de engenharia na escrita de código Go, é necessário avaliar a matriz de complexidade.

**Não crie um Provider se:**
-   Você precisa apenas disparar uma chamada HTTP simples (webhook, job no Jenkins). O `terraform-provider-http` ou provisionadores nativos como `local-exec` são suficientes.
-   O sistema externo não possui uma API com semântica de estado consistente. Se a leitura do recurso é assíncrona ou inexistente, o Terraform não conseguirá reconciliar o estado.

**Crie um Provider customizado se:**
-   Você possui um sistema interno robusto (ex: um IPAM corporativo, um sistema legado de gestão de identidades, ou um orquestrador de hardware Bare Metal próprio).
-   Os recursos desse sistema precisam compartilhar o mesmo ciclo de vida (CRUD) da infraestrutura na nuvem em uma única execução de `apply`.
-   O **State Management** e a detecção de **Configuration Drift** são cruciais para a auditoria do sistema interno.

## O Contrato CRUD: Implementando o Plugin Framework

A HashiCorp recomenda o **Terraform Plugin Framework** (substituto do SDKv2) para o desenvolvimento de novos providers. O framework abstrai a complexidade do gRPC e direciona o engenheiro para focar na modelagem de dados e nas operações CRUD.

Para criar um recurso (ex: `meusistema_usuario`), o desenvolvedidor Go implementa um contrato estrito em uma struct. O ciclo funciona da seguinte forma:

### Schema Definition

O Provider define os atributos do recurso: tipos (`String`, `Bool`, `Map`), campos obrigatórios (`Required`), opcionais (`Optional`) e campos calculados pela API após a criação (`Computed`, como IDs gerados pelo banco ou timestamps).

### Create

Acionado durante o `terraform apply`. O código Go extrai as variáveis do plano HCL, monta o payload e executa um POST para a API interna. Após o sucesso, o Provider deve persistir o Identificador Único retornado pela API no objeto de estado do Terraform esta é a âncora de todas as operações subsequentes.

### Read

O coração da detecção de Drift. Antes de cada operação, o Terraform aciona o `Read`. O Provider recupera o ID do estado, executa um GET na API e atualiza o estado em memória com os valores reais. Se a API retornar `404 Not Found`, o Provider instrui o Terraform a remover o recurso do estado, forçando recriação no próximo plano.

### Update

Acionado quando o Terraform detecta divergência entre o código HCL e o estado registrado. O Provider recebe o diff e executa um PUT ou PATCH na API.

### Delete

Acionado via `terraform destroy` ou quando o bloco do recurso é removido do código. O Provider executa um DELETE na API e o Terraform remove a entrada correspondente do `terraform.tfstate`.

## O Impacto na Engenharia de Plataforma

Construir providers customizados é o ápice da maturidade em **Platform Engineering**.

Ao encapsular APIs internas fragmentadas e scripts imperfeitos dentro de um binário de Provider oficial da organização, unifica-se a experiência do desenvolvedor. Times de produto deixam de abrir chamados em sistemas de tickets para criar permissões internas e passam a declarar `resource "meu_sistema_permissao" "dev"` em seus próprios repositórios Terraform.

A infraestrutura interna legada ganha, de forma transparente, todas as vantagens de uma arquitetura moderna: versionamento de código, peer review, idempotência e auditoria de estado via State Management.

## Conclusão

O Terraform Core é deliberadamente minimalista. Sua extensibilidade real reside no protocolo de plugins e na riqueza do ecossistema de Providers. Compreender essa arquitetura é o que diferencia um engenheiro que consome o Terraform de um engenheiro que o estende.

Quando sistemas internos críticos são encapsulados como Providers de primeira classe, a organização eleva sua maturidade operacional ao unificar o ciclo de vida de toda a infraestrutura interna e externa sob uma única interface declarativa, auditável e determinística.
