---
title: "Autenticação no Vault: Tokens, AppRole, OIDC e Kubernetes Auth"
description: "Como clientes provam identidade ao Vault: o problema do secret zero, tokens, AppRole para máquinas, OIDC para pessoas, JWT para pipelines de CI e o método de autenticação do Kubernetes."
date: 2026-09-04 19:00:00 -0300
categories: [DevSecOps, Segurança, Vault]
tags: [Vault, AppRole, OIDC, Kubernetes, Autenticação, DevSecOps]
icons: [vault]
---

## Introdução

Todo projeto de gestão de segredos esbarra cedo em um paradoxo. Para buscar um segredo no cofre, a aplicação precisa se autenticar. E para se autenticar, ela precisa de uma credencial, que é outro segredo.

Esse primeiro segredo tem nome na literatura: **secret zero**. É a credencial que dá acesso a todas as outras, e por isso a mais valiosa de proteger.

A forma como o Vault lida com esse problema está nos seus métodos de autenticação. Alguns apenas deslocam o secret zero para um lugar mais protegido. Outros o eliminam, apoiando-se em uma identidade que a plataforma já garante. Saber qual é qual é o que separa uma implantação que resolve o problema de uma que apenas o reorganiza.

## Autenticar é Trocar Identidade por Token

Todos os métodos seguem o mesmo contrato. O cliente apresenta uma prova de identidade, o método a valida contra uma fonte de confiança, e o Vault devolve um token com as políticas configuradas para aquela identidade.

O que muda de um método para outro é a fonte de confiança. Pode ser uma lista interna de usuários, um provedor de identidade corporativo, a API do Kubernetes ou o emissor de tokens de uma plataforma de CI.

Depois da troca, o método não participa mais. A partir daí, quem governa o acesso é o token e as políticas associadas a ele.

## Tokens

O token é o próprio mecanismo de autenticação, e também o destino de todos os outros.

Cada token tem um prazo de validade e, em geral, pode ser renovado até um limite máximo. Tokens filhos herdam relações com o token que os criou, o que permite revogar uma árvore inteira de acessos de uma só vez.

Existem dois tipos com perfis diferentes. Os tokens de serviço são completos: podem ser renovados, criar filhos e ser revogados individualmente. Os tokens de lote são leves, não são persistidos da mesma forma e servem a cenários de alto volume em que essas capacidades não são necessárias.

Usar tokens criados manualmente como forma de autenticação de aplicações é possível, mas reproduz exatamente o problema do secret zero. Um token de longa duração guardado em uma variável de ambiente é uma senha com outro nome.

## AppRole: Para Máquinas, com Duas Metades

O AppRole foi desenhado para autenticação de máquinas em ambientes onde não há uma identidade de plataforma disponível. A credencial é dividida em duas partes:

- **role_id**, que identifica o papel e funciona como um nome de usuário.
- **secret_id**, que funciona como senha e pode ter prazo e limite de uso.

```bash
vault auth enable approle

vault write auth/approle/role/app-pagamentos \
    token_policies="pagamentos" \
    token_ttl="20m" \
    token_max_ttl="1h" \
    secret_id_ttl="10m" \
    secret_id_num_uses=1

vault read auth/approle/role/app-pagamentos/role-id
vault write -f auth/approle/role/app-pagamentos/secret-id
```

A aplicação troca as duas partes por um token:

```bash
vault write auth/approle/login \
    role_id="<role_id>" \
    secret_id="<secret_id>"
```

A segurança do AppRole depende de como as duas metades chegam à aplicação. O desenho recomendado é que elas sigam por caminhos diferentes. O role_id pode estar na configuração da imagem, enquanto o secret_id é entregue no momento da implantação por um sistema confiável, com validade curta e uso único.

Para essa entrega, o Vault oferece o embrulho de resposta. Em vez de devolver o secret_id diretamente, ele devolve um token de uso único que só pode ser aberto uma vez, por um prazo curto:

```bash
vault write -wrap-ttl=60s -f auth/approle/role/app-pagamentos/secret-id
```

Se alguém interceptar e abrir esse embrulho antes do destinatário, a aplicação recebe um erro ao tentar abrir, o que torna a interceptação detectável.

Mesmo bem implementado, o AppRole não elimina o secret zero. Ele o torna curto, de uso único e rastreável, o que já é um avanço considerável.

## OIDC: Para Pessoas

Para pessoas, a fonte de confiança natural é o provedor de identidade que a organização já usa. O método OIDC delega a autenticação a ele:

```bash
vault auth enable oidc

vault write auth/oidc/config \
    oidc_discovery_url="https://login.minhaorg.com" \
    oidc_client_id="vault" \
    oidc_client_secret="<segredo-do-cliente>" \
    default_role="engenharia"

vault write auth/oidc/role/engenharia \
    user_claim="email" \
    groups_claim="groups" \
    allowed_redirect_uris="https://vault.minhaorg.com/ui/vault/auth/oidc/oidc/callback" \
    allowed_redirect_uris="http://localhost:8250/oidc/callback" \
    token_policies="engenharia" \
    token_ttl="8h"
```

O engenheiro faz login pelo navegador, com a autenticação em dois fatores e as regras de acesso que a empresa já aplica:

```bash
vault login -method=oidc
```

O ganho principal está no ciclo de vida. Quando alguém sai da empresa e é desativado no provedor de identidade, perde também o acesso ao Vault, sem que ninguém precise lembrar de fazer isso em mais um sistema.

## JWT: Para Pipelines de CI

O mesmo princípio vale para pipelines. As principais plataformas de CI emitem, para cada execução, um token assinado que descreve a origem: repositório, branch, ambiente e evento que disparou o job.

O método JWT valida esse token diretamente:

```bash
vault auth enable jwt

vault write auth/jwt/config \
    oidc_discovery_url="https://token.actions.githubusercontent.com" \
    bound_issuer="https://token.actions.githubusercontent.com"
```

O papel restringe quais execuções podem se autenticar, a partir das informações contidas no token:

```bash
vault write auth/jwt/role/infra-deploy - <<EOF
{
  "role_type": "jwt",
  "user_claim": "repository",
  "bound_audiences": ["https://github.com/minhaorg"],
  "bound_claims": {
    "repository": "minhaorg/infraestrutura",
    "ref": "refs/heads/main"
  },
  "token_policies": ["infra-deploy"],
  "token_ttl": "15m"
}
EOF
```

Com isso, apenas jobs executados na branch principal daquele repositório recebem um token, válido por quinze minutos. Não existe credencial guardada nos segredos do repositório, porque a prova de identidade é emitida pela própria plataforma a cada execução.

Esse é o mesmo padrão que apareceu do lado da execução de infraestrutura em [Autenticação Dinâmica Multi-Conta: O Fim das Credenciais Estáticas no Terragrunt](/posts/autenticacao-dinamica-multi-conta-o-fim-das-credenciais-estaticas-no-terragrunt/). O pipeline obtém o token no Vault e, a partir dele, as credenciais da nuvem.

## Kubernetes Auth: Para Pods

Dentro de um cluster, cada pod já possui uma identidade: o token do service account, montado automaticamente pelo Kubernetes. O método de autenticação do Kubernetes aproveita isso.

A configuração aponta para a API do cluster:

```bash
vault auth enable kubernetes

vault write auth/kubernetes/config \
    kubernetes_host="https://kubernetes.default.svc:443"
```

Quando o Vault roda dentro do próprio cluster, ele usa o certificado e o token locais para falar com a API. Rodando fora, é preciso informar o certificado da autoridade e um token com permissão para revisar outros tokens.

O papel vincula service accounts e namespaces a políticas:

```bash
vault write auth/kubernetes/role/pagamentos \
    bound_service_account_names="pagamentos" \
    bound_service_account_namespaces="producao" \
    audience="vault" \
    token_policies="pagamentos" \
    token_ttl="1h"
```

No login, o pod envia o próprio token do service account. O Vault confirma sua validade através da API de revisão de tokens do Kubernetes, verifica se nome e namespace correspondem ao papel e devolve o token com as políticas.

O resultado é a autenticação sem nenhum segredo configurado na aplicação. A identidade vem da plataforma, que já é responsável por garantir que aquele pod é quem diz ser.

O atributo de audiência merece atenção. Sem ele, qualquer token válido daquele service account, emitido para qualquer finalidade, serve para autenticar no Vault. Restringir a audiência exige que o token tenha sido emitido especificamente para esse uso.

## Qual Método para Qual Cliente

A escolha segue uma regra simples: use a identidade mais forte que a plataforma do cliente já oferece.

- **Pessoas:** OIDC, ligado ao provedor de identidade corporativo.
- **Pipelines de CI:** JWT, validando o token emitido pela plataforma a cada execução.
- **Pods no Kubernetes:** o método nativo do Kubernetes, baseado no service account.
- **Cargas em nuvem:** os métodos dos próprios provedores, que validam a identidade da instância ou da função.
- **Máquinas sem identidade de plataforma:** AppRole, com entrega separada das duas metades.

Tokens criados manualmente ficam reservados para administração e situações de emergência.

## Conclusão

O secret zero não desaparece porque se escolheu um cofre melhor. Ele desaparece quando a pergunta sobre como a aplicação prova quem é passa a ser respondida pela plataforma onde ela roda, e não por um valor guardado em algum lugar.

Os métodos de autenticação do Vault são, na prática, adaptadores para as diferentes formas que essa identidade de plataforma assume. O provedor corporativo atesta pessoas, o emissor de CI atesta execuções, o Kubernetes atesta pods.

O AppRole ocupa um lugar à parte nessa lista. Ele existe para os casos em que nenhuma plataforma pode atestar nada, e cumpre bem esse papel. O que vale observar em uma implantação é quantos clientes estão usando AppRole por necessidade, e quantos estão usando por hábito, quando havia uma identidade mais forte disponível e ninguém parou para olhar.
