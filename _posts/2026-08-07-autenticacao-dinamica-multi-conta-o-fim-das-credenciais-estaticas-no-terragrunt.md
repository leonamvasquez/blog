---
title: "Autenticação Dinâmica Multi-Conta: O Fim das Credenciais Estáticas no Terragrunt"
description: "Como usar o --auth-provider-cmd do Terragrunt para obter credenciais temporárias por unit: o contrato JSON esperado, assunção de papéis por conta, integração com OIDC e os cuidados de implementação."
date: 2026-08-07 19:00:00 -0300
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Segurança, DevSecOps, OIDC, Multi-Account, IaC]
icons: [terragrunt, terraform, opentofu]
---

## Introdução

Procure nos segredos do seu repositório de infraestrutura. Há uma boa chance de existir ali uma chave de acesso que ninguém sabe dizer quando foi rotacionada pela última vez.

Ela está lá porque a esteira precisa autenticar em algum lugar, e essa foi a forma mais direta de resolver. O problema é que uma credencial estática não expira sozinha, não sabe quem a usou e continua válida muito tempo depois de a pessoa que a criou ter trocado de time.

Em ambientes com várias contas, esse problema se multiplica de um jeito desconfortável. Ou você mantém uma credencial por conta, com o custo de gestão que isso implica, ou mantém uma única credencial com permissão para alcançar todas elas, o que é exatamente o que ninguém queria ao separar as contas.

O Terragrunt oferece um ponto de extensão para resolver isso de outra forma.

## O Ponto de Extensão

A configuração é uma opção que aponta para um comando, passada por flag ou por variável de ambiente:

```bash
terragrunt apply --auth-provider-cmd ./scripts/autentica.sh

# ou, de forma equivalente
export TG_AUTH_PROVIDER_CMD="./scripts/autentica.sh"
terragrunt apply
```

O Terragrunt executa esse comando e usa o resultado para montar o ambiente de credenciais da execução. A execução acontece no contexto de cada unit, e esse detalhe é o que torna o mecanismo interessante em cenários multi-conta.

O que o comando faz por dentro é problema seu. Pode consultar um cofre de segredos, assumir um papel, trocar um token por credenciais temporárias ou qualquer combinação disso. O Terragrunt não se importa com o método, apenas com o formato da resposta.

## O Contrato

O comando precisa escrever um objeto JSON na saída padrão, com até três chaves de nível superior, todas opcionais:

```json
{
  "awsCredentials": {
    "ACCESS_KEY_ID": "",
    "SECRET_ACCESS_KEY": "",
    "SESSION_TOKEN": ""
  },
  "awsRole": {
    "roleARN": "",
    "roleSessionName": "",
    "duration": 0,
    "webIdentityToken": ""
  },
  "envs": {
    "QUALQUER_CHAVE": "qualquer_valor"
  }
}
```

A distinção entre as duas primeiras merece atenção, porque define quem faz o trabalho.

Com `awsCredentials`, o seu script já obteve as credenciais temporárias e as entrega prontas. Com `awsRole`, você informa qual papel deve ser assumido e deixa que o Terragrunt faça a assunção.

A chave `envs` aceita qualquer par de chave e valor, e é por onde passam configurações como região ou credenciais de outros provedores que não a AWS.

## Credenciais por Conta

O caso que justifica todo o mecanismo é o de cada ambiente viver em uma conta diferente. O comando roda para cada unit, e o script decide o que fazer.

Um exemplo que assume o papel correspondente à conta da unit:

```bash
#!/bin/bash
set -euo pipefail

ROLE_ARN="${AUTH_ROLE_ARN:?AUTH_ROLE_ARN precisa estar definida}"
SESSION_NAME="terragrunt-$(date +%s)"

# Logs vão para stderr, nunca para stdout
echo "Assumindo ${ROLE_ARN}" >&2

CREDS=$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "$SESSION_NAME" \
  --duration-seconds 3600 \
  --output json)

jq -n \
  --arg ak "$(jq -r '.Credentials.AccessKeyId' <<< "$CREDS")" \
  --arg sk "$(jq -r '.Credentials.SecretAccessKey' <<< "$CREDS")" \
  --arg st "$(jq -r '.Credentials.SessionToken' <<< "$CREDS")" \
  --arg region "us-east-1" \
  '{
    awsCredentials: {
      ACCESS_KEY_ID: $ak,
      SECRET_ACCESS_KEY: $sk,
      SESSION_TOKEN: $st
    },
    envs: {
      AWS_REGION: $region
    }
  }'
```

O uso do `jq` para montar a saída não é preciosismo. Ele garante que os valores sejam escapados corretamente, o que evita um JSON inválido quando algum token contém caracteres especiais.

## Deixando o Terragrunt Assumir o Papel

Quando a lógica é apenas descobrir qual papel usar, o script fica bem mais simples. Em vez de chamar a API e tratar a resposta, ele informa o papel:

```bash
#!/bin/bash
set -euo pipefail

CONTA="${TG_ACCOUNT_ID:?conta nao informada}"

jq -n --arg arn "arn:aws:iam::${CONTA}:role/terragrunt-deploy" \
  '{
    awsRole: {
      roleARN: $arn,
      roleSessionName: "terragrunt",
      duration: 3600
    }
  }'
```

Menos código significa menos lugar para erro. Se o seu caso é só escolher o papel conforme a conta, essa é a forma preferível.

## Eliminando o Segredo de Vez

O campo que torna o mecanismo realmente interessante do ponto de vista de segurança é o do token de identidade.

A ideia é a seguinte: em vez de guardar uma credencial, a esteira de CI emite um token de curta duração que prova a identidade daquela execução. Esse token é trocado por credenciais temporárias na nuvem, com permissões restritas ao que aquele pipeline precisa.

O resultado é que não existe segredo armazenado. Não há chave para rotacionar, vazar ou esquecer. A confiança passa a ser estabelecida entre o provedor de identidade da sua plataforma de CI e a nuvem, com condições que você define.

Esse é o mesmo princípio que vimos do lado do estado em [Valores Efêmeros: Como o OpenTofu Trata Segredos que Não Vão para o State](/posts/valores-efemeros-como-o-opentofu-trata-segredos-que-nao-vao-para-o-state/). O segredo mais seguro continua sendo aquele que não existe.

## Por Unit, Não por Pipeline

Vale sublinhar a diferença em relação à abordagem tradicional, porque é ela que muda o desenho.

Quando a autenticação acontece no início do pipeline, toda a execução compartilha a mesma identidade. Isso obriga a credencial a ter permissão para tudo que qualquer unit possa precisar, e o resultado é um conjunto de permissões bem maior do que qualquer unit individual exigiria.

Com o comando sendo executado no contexto de cada unit, cada uma pode obter exatamente a identidade que precisa. Uma execução em lote atravessando várias contas passa a ser possível sem que exista uma credencial capaz de alcançar todas elas sozinha.

A consequência prática é a redução do raio de impacto. Uma falha de configuração afeta o escopo daquela unit, e não de tudo que o pipeline alcança.


## Conclusão

Credenciais estáticas sobrevivem menos por convicção e mais por inércia. Elas funcionam, foram configuradas uma vez e raramente alguém encontra o momento adequado para mexer em algo que está funcionando.

O argumento para mudar não é que elas sejam frágeis em si, e sim que elas resolvem o problema errado. Uma chave permanente responde à pergunta sobre como autenticar, quando a pergunta relevante é quem está executando o quê, agora, e com qual autoridade.

Credenciais obtidas no momento da execução respondem essa segunda pergunta. Elas carregam identidade, escopo e prazo de validade, e isso transforma o registro de acesso em algo que de fato conta uma história, em vez de apontar sempre para a mesma chave compartilhada que alguém criou há três anos e que ninguém se sente seguro o bastante para revogar.
