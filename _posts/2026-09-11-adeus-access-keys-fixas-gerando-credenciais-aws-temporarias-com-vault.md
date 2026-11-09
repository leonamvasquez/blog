---
title: "Adeus Access Keys Fixas: Gerando Credenciais AWS Temporárias com Vault"
description: "Como usar o secrets engine de AWS do Vault para gerar credenciais sob demanda: a configuração da credencial raiz, os tipos iam_user e assumed_role, leases, revogação e o que muda em ambientes multi-conta."
date: 2026-09-11 19:00:00 -0300
categories: [DevSecOps, Segurança, Vault]
tags: [Vault, AWS, IAM, STS, Credenciais Dinâmicas, DevSecOps]
icons: [vault]
---

## Introdução

Chaves de acesso da AWS publicadas em repositórios públicos são procuradas ativamente por robôs. A própria AWS mantém varreduras que detectam essas exposições e aplicam restrições à chave, justamente porque o intervalo entre a publicação e a primeira tentativa de uso costuma ser curto.

O cenário de vazamento público é o mais visível, mas não o mais comum. Mais frequente é a chave que vive anos na configuração de um pipeline, copiada para o arquivo local de alguns engenheiros, com permissões que cresceram a cada vez que alguém precisou de algo novo.

O secrets engine de AWS do Vault ataca o problema pela raiz. Em vez de existir uma chave permanente para cada consumidor, cada pedido gera uma credencial nova, com permissões específicas e prazo de validade.

## O Modelo

A estrutura é simples. O Vault guarda uma única credencial com permissão para criar outras. Cada consumidor, ao pedir acesso, recebe uma credencial gerada naquele momento, válida por um prazo definido e associada a um lease.

Quando o lease expira ou é revogado, o Vault remove a credencial na AWS, nos tipos que permitem essa remoção. Os consumidores nunca tocam na credencial raiz, e nenhuma credencial entregue a eles sobrevive além do necessário.

## A Credencial Raiz

O primeiro passo é ativar o engine e informar a credencial que o Vault vai usar:

```bash
vault secrets enable aws

vault write aws/config/root \
    access_key="AKIA..." \
    secret_key="..." \
    region="us-east-1"
```

Essa credencial deve pertencer a um usuário de IAM dedicado ao Vault, com permissões limitadas ao necessário para gerar as credenciais dos papéis configurados. A documentação exige ainda que essa seja a única chave de acesso desse usuário.

Feita a configuração, o passo seguinte é fazer com que ninguém mais conheça essa chave:

```bash
vault write -f aws/config/rotate-root
```

O Vault gera uma chave nova, apaga a anterior e passa a ser o único detentor. Logo após a rotação, as chamadas seguintes podem falhar por alguns segundos, enquanto a AWS propaga a alteração.

Na edição Enterprise, existe ainda a federação de identidade de carga de trabalho, que permite ao Vault se autenticar na AWS sem nenhuma chave estática, por meio de um token de identidade confiado pelo IAM. É o caminho para eliminar até mesmo essa última credencial.

## Os Tipos de Credencial

Cada papel configurado no engine define um tipo de credencial. São quatro:

- **iam_user** cria um usuário de IAM real, com chaves próprias.
- **assumed_role** assume um papel de IAM existente e devolve credenciais temporárias de STS.
- **federation_token** gera credenciais temporárias de federação a partir do usuário do Vault.
- **session_token** gera um token de sessão para o próprio usuário do Vault.

Os dois primeiros cobrem a maioria dos casos de uso.

## iam_user

Neste tipo, o Vault cria um usuário de IAM para cada pedido e o remove quando o lease termina. As permissões são definidas por políticas gerenciadas ou por um documento de política inline:

```bash
vault write aws/roles/leitura-s3 \
    credential_type="iam_user" \
    policy_arns="arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
```

```bash
vault read aws/creds/leitura-s3
```

A resposta traz a chave de acesso, a chave secreta e o identificador do lease.

A vantagem é a revogação real. Ao encerrar o lease, o usuário deixa de existir, e qualquer uso posterior da credencial falha imediatamente.

A desvantagem é a latência. Usuários de IAM recém-criados podem levar alguns segundos para serem reconhecidos em todas as regiões, e uma aplicação que tenta usar a credencial imediatamente pode receber erros de autorização transitórios. Clientes que consomem esse tipo de credencial precisam prever uma pequena espera ou novas tentativas.

## assumed_role

Neste tipo, o Vault não cria nada no IAM. Ele assume um papel existente e devolve credenciais temporárias:

```bash
vault write aws/roles/deploy-producao \
    credential_type="assumed_role" \
    role_arns="arn:aws:iam::222233334444:role/vault-deploy" \
    default_sts_ttl="15m" \
    max_sts_ttl="1h"
```

```bash
vault read aws/sts/deploy-producao
```

Para que funcione, o papel de destino precisa de uma política de confiança que permita à identidade do Vault assumi-lo. A permissão é definida pelo papel na AWS, e não pelo Vault, o que mantém a autoridade sobre o que pode ser feito em cada conta com quem administra aquela conta.

Esse é o tipo adequado para ambientes multi-conta. O Vault fica em uma conta central e cada conta de destino expõe um papel confiando nele. Adicionar uma conta nova é adicionar um papel no Vault e uma relação de confiança na conta, sem nenhuma chave nova a ser distribuída.

O mesmo papel pode aceitar mais de um ARN de destino. Nesse caso, o consumidor indica qual quer assumir no momento do pedido.

## O Detalhe da Revogação

Aqui está a diferença entre os dois tipos que mais pesa em uma resposta a incidentes.

Credenciais temporárias de STS não podem ser revogadas individualmente na AWS. Elas valem até o fim do prazo para o qual foram emitidas. Quando o Vault encerra o lease de uma credencial do tipo assumed_role, ele deixa de renová-la, mas a credencial já entregue continua válida até expirar.

Na prática, isso muda o papel do prazo de validade. Para iam_user, o prazo é uma conveniência, porque a revogação está disponível. Para assumed_role, o prazo é o próprio controle. Quinze minutos de validade significam, no pior caso, quinze minutos de exposição de uma credencial vazada.

Por isso, os valores de TTL para credenciais de STS devem ser dimensionados pelo tempo da tarefa mais longa que as consome, e não por conforto.

## Consumindo em Pipelines de Infraestrutura

O padrão mais comum em infraestrutura como código é o pipeline obter a credencial antes de executar o plano. Com Terragrunt, isso se encaixa no comando de autenticação por unit, descrito em [Autenticação Dinâmica Multi-Conta: O Fim das Credenciais Estáticas no Terragrunt](/posts/autenticacao-dinamica-multi-conta-o-fim-das-credenciais-estaticas-no-terragrunt/):

```bash
#!/bin/bash
set -euo pipefail

CREDS=$(vault read -format=json aws/sts/deploy-producao)

jq -n \
  --arg ak "$(jq -r '.data.access_key' <<< "$CREDS")" \
  --arg sk "$(jq -r '.data.secret_key' <<< "$CREDS")" \
  --arg st "$(jq -r '.data.security_token' <<< "$CREDS")" \
  '{
    awsCredentials: {
      ACCESS_KEY_ID: $ak,
      SECRET_ACCESS_KEY: $sk,
      SESSION_TOKEN: $st
    }
  }'
```

Combinado com a autenticação do pipeline no Vault via JWT, o fluxo inteiro acontece sem que nenhuma chave da AWS esteja guardada em lugar nenhum. A plataforma de CI atesta a execução, o Vault emite um token de curta duração, e esse token obtém credenciais de quinze minutos para a conta de destino.

## Conclusão

Uma chave de acesso permanente é uma decisão tomada uma vez e mantida por inércia. Ela é criada para resolver uma necessidade pontual e sobrevive a essa necessidade, ao projeto que a motivou e, com frequência, à pessoa que a criou.

O engine de AWS do Vault inverte essa lógica. A credencial deixa de ser um recurso que existe e passa a ser um evento que acontece, com início, escopo e fim definidos no momento do pedido.

O efeito mais visível é na resposta a incidentes. Diante de um vazamento, a pergunta deixa de ser onde mais essa chave foi copiada e quem vai quebrar quando ela for trocada. Passa a ser quanto tempo falta para ela expirar, uma pergunta com resposta exata, registrada no lease.
