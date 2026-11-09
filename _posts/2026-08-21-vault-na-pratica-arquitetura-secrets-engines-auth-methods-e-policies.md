---
title: "Vault na Prática: Arquitetura, Secrets Engines, Auth Methods e Policies"
description: "Como o HashiCorp Vault funciona por dentro: a barreira criptográfica, o modelo baseado em caminhos, secrets engines, auth methods, tokens, policies e leases, com exemplos de linha de comando."
date: 2026-08-21 19:00:00 -0300
categories: [DevSecOps, Segurança, Vault]
tags: [Vault, HashiCorp, Secrets, Policies, DevSecOps, Segurança]
icons: [vault]
---

## Introdução

Peça para alguém descrever o Vault em uma frase e a resposta costuma ser alguma variação de "um lugar seguro para guardar senhas". A descrição está certa, mas cobre só a parte mais simples do que a ferramenta faz.

Guardar valores é o ponto de partida. O que torna o Vault relevante é a capacidade de gerar credenciais no momento em que alguém pede, com prazo de validade, e de decidir quem pode pedir o quê com base em identidade, e não em posse de uma senha.

Para usar bem essas capacidades, é preciso entender as peças que compõem a ferramenta e como elas se encaixam. São poucas, e quase todo o resto deriva delas.

## O Que é o Vault

O Vault é um sistema de gestão de segredos e de identidade para máquinas e pessoas. Ele armazena valores sensíveis, gera credenciais dinâmicas para outros sistemas, oferece criptografia como serviço e controla o acesso a tudo isso por meio de políticas.

Um registro de contexto, para quem acompanha a série sobre OpenTofu: em 2023, o Vault também passou da licença MPL 2.0 para a BSL 1.1, na mesma mudança que atingiu o Terraform. A reação seguiu um caminho parecido. O OpenBao, fork de código aberto sob MPL 2.0, é mantido sob a Open Source Security Foundation, da Linux Foundation, e mantém compatibilidade de API com o Vault em boa parte dos casos de uso.

Os conceitos deste artigo valem para os dois projetos. Os exemplos usam a CLI do Vault.

## A Barreira e o Armazenamento

A decisão arquitetural mais importante do Vault é tratar o armazenamento como não confiável.

Todo dado que o Vault grava passa antes por uma camada chamada **barreira**, que o criptografa. O backend de armazenamento, seja o Raft integrado ao próprio Vault ou outro suportado, recebe apenas dados cifrados. Quem tem acesso direto ao disco ou ao banco onde o Vault grava não consegue ler nada.

A consequência é que o Vault inicia em um estado chamado **selado**. Ele sabe onde estão os dados, mas não tem a chave para decifrá-los. Até que seja desselado, ele não responde a nenhuma requisição que dependa desses dados.

Esse processo de selagem e desselagem tem complexidade suficiente para um artigo próprio, e é o tema do próximo texto desta série.

## Tudo é um Caminho

A segunda ideia central é que toda interação com o Vault acontece através de caminhos, no estilo de um sistema de arquivos.

Ler um segredo, gerar uma credencial, configurar um método de autenticação, escrever uma política: todas essas operações são leituras e escritas em caminhos. A CLI, a API HTTP e as bibliotecas cliente são formas diferentes de fazer a mesma coisa.

Esse modelo parece um detalhe de interface, mas ele sustenta o sistema de permissões. Como tudo é um caminho, controlar acesso se resume a dizer quem pode fazer o quê em quais caminhos.

## Secrets Engines

Os **secrets engines** são os componentes que efetivamente armazenam, geram ou transformam dados. Cada um é montado em um caminho, e tudo que chega a esse caminho é tratado por ele.

O mais simples é o de chave e valor, que guarda dados estáticos com histórico de versões:

```bash
vault secrets enable -path=secret kv-v2

vault kv put secret/app/config db_host=db.interno db_port=5432
vault kv get secret/app/config
```

Os outros são mais interessantes. O engine de AWS gera credenciais temporárias de IAM. O de banco de dados cria usuários com prazo de validade. O de Transit criptografa e decifra dados sem nunca expor a chave. O de PKI emite certificados.

O ponto em comum entre os engines dinâmicos é que o segredo não existe antes do pedido. Ele é criado quando alguém precisa, e destruído quando o prazo acaba. Os dois artigos finais desta série tratam desses casos em detalhe, com AWS e com bancos de dados.

## Auth Methods

Antes de acessar qualquer engine, o cliente precisa se identificar. Os **auth methods** são os componentes que verificam essa identidade.

Cada método confia em uma fonte diferente. Um aceita usuário e senha. Outro valida um token emitido pelo Kubernetes para um service account. Outro aceita um token OIDC de um provedor de identidade corporativo ou de uma plataforma de CI.

```bash
vault auth enable userpass

vault write auth/userpass/users/leonam \
    password="troque-esta-senha" \
    token_policies="app-leitura"
```

Independentemente do método, o resultado da autenticação é sempre o mesmo: um token. O método só define como a identidade é provada. A escolha do método certo para cada tipo de cliente é o tema do terceiro artigo desta série.

## Tokens

O token é a moeda de acesso do Vault. Toda requisição autenticada carrega um, e é a partir dele que o Vault descobre quais políticas se aplicam.

Tokens têm prazo de validade e podem ser renovados até um limite máximo. Quando expiram, tudo que foi gerado a partir deles pode ser revogado em cascata, o que dá ao administrador uma forma de encerrar de uma vez todo o acesso concedido a um cliente.

Existe um token especial, o **root token**, criado na inicialização, que ignora todas as políticas. Ele serve para a configuração inicial. Concluída essa etapa, a prática recomendada é revogá-lo e gerar um novo apenas quando houver necessidade, através de um procedimento que exige a participação de quem detém as chaves.

## Policies

As **policies** são o mecanismo de autorização. São escritas em HCL e associam caminhos a capacidades:

```hcl
# app-leitura.hcl
path "secret/data/app/*" {
  capabilities = ["read"]
}

path "secret/metadata/app/*" {
  capabilities = ["list"]
}
```

```bash
vault policy write app-leitura app-leitura.hcl
```

As capacidades disponíveis cobrem as operações possíveis: criar, ler, atualizar, aplicar alterações parciais, apagar, listar, além de uma capacidade privilegiada para caminhos administrativos e uma de negação explícita, que prevalece sobre qualquer outra.

O comportamento padrão é negar. Um token só pode fazer aquilo que alguma de suas políticas permite explicitamente.

Repare nos caminhos do exemplo. O engine de chave e valor na versão 2 separa os dados dos metadados em caminhos diferentes, com os prefixos `data/` e `metadata/`. O comando `vault kv get secret/app/config` esconde esse detalhe, mas a política precisa considerá-lo. Uma política escrita para `secret/app/*` não concede acesso a nada, e esse costuma ser o primeiro erro de quem começa a escrever políticas.

## Leases

O último conceito fecha o ciclo. Toda credencial dinâmica vem acompanhada de um **lease**, um contrato com identificador próprio e prazo de validade.

```bash
vault lease renew <lease_id>
vault lease revoke <lease_id>
```

O lease permite três coisas. O cliente pode renová-lo enquanto precisa da credencial. O administrador pode revogá-lo a qualquer momento, o que destrói a credencial na origem. E, se ninguém fizer nada, ele expira e a credencial deixa de existir.

É esse mecanismo que dá à credencial dinâmica as propriedades que faltam a um segredo estático: prazo, rastreabilidade e revogação.

## Conclusão

O modelo do Vault se resume a uma sequência: um cliente prova quem é através de um auth method, recebe um token, e as políticas associadas a esse token determinam o que ele pode fazer nos caminhos onde os secrets engines estão montados. Credenciais dinâmicas nascem com um lease, e o lease decide quando elas morrem.

Cada uma dessas peças é simples isoladamente. A força do conjunto está na separação entre elas. A forma de provar identidade não depende de onde o segredo está, a permissão não depende de como ele é gerado, e a validade não depende de alguém lembrar de trocar uma senha.

Essa separação é o que permite à ferramenta crescer de um repositório de valores para uma camada de identidade da infraestrutura, e é por essa segunda leitura que vale a pena estudá-la.
