---
title: "Rotação de Senhas: Criando Usuários de Banco de Dados Just-in-Time"
description: "Como usar o secrets engine de banco de dados do Vault para criar usuários sob demanda no PostgreSQL: configuração da conexão, rotação da senha administrativa, papéis dinâmicos, static roles e o impacto nas aplicações."
date: 2026-09-18 19:00:00 -0300
categories: [DevSecOps, Segurança, Vault]
tags: [Vault, PostgreSQL, Banco de Dados, Credenciais Dinâmicas, DevSecOps]
icons: [vault]
---

## Introdução

Quase todo banco de dados em produção tem um usuário chamado alguma variação de `app_user`. Ele foi criado na primeira versão do sistema, com uma senha que hoje está na configuração de quatro serviços diferentes, em dois pipelines e na memória de alguns engenheiros que já não trabalham na empresa.

Ninguém troca essa senha. Trocá-la exigiria atualizar todos esses lugares ao mesmo tempo, e ninguém tem certeza de quais são.

O secrets engine de banco de dados do Vault resolve isso de um jeito que inicialmente parece estranho: em vez de proteger melhor o `app_user`, ele faz com que cada instância da aplicação tenha o próprio usuário, criado quando ela inicia e removido quando o prazo acaba.

## O Que Significa Just-in-Time

A expressão descreve o momento em que o acesso passa a existir. Em vez de um usuário permanente aguardando ser usado, o usuário é criado no instante do pedido, com as permissões que aquele consumidor precisa e com prazo de validade.

Três consequências decorrem disso. Cada credencial é única, então os logs de auditoria do banco passam a identificar qual instância fez cada operação. Cada credencial expira, então um vazamento tem duração limitada. E não existe senha compartilhada para rotacionar, porque nenhuma senha dura o suficiente para precisar disso.

## Configurando a Conexão

O primeiro passo é ativar o engine e informar ao Vault como se conectar ao banco:

```bash
vault secrets enable database

vault write database/config/pagamentos-db \
    plugin_name="postgresql-database-plugin" \
    allowed_roles="pagamentos-leitura,pagamentos-escrita" \
    connection_url="postgresql://{{username}}:{{password}}@db.interno:5432/pagamentos" \
    username="vault_admin" \
    password="senha-inicial" \
    password_authentication="scram-sha-256"
```

Os marcadores na URL de conexão são preenchidos pelo próprio Vault com o usuário e a senha informados. O atributo `allowed_roles` limita quais papéis podem usar essa conexão, o que impede que um papel configurado por engano gere credenciais em um banco que não deveria.

O usuário configurado aqui precisa de permissão para criar e remover outros usuários. Ele deve ser dedicado ao Vault, e não o superusuário que algum administrador usa no dia a dia.

## Tirando a Senha Administrativa de Circulação

A senha informada na configuração foi digitada por alguém, aparece no histórico do terminal e talvez esteja em um gerenciador de senhas pessoal. O passo seguinte resolve isso:

```bash
vault write -f database/rotate-root/pagamentos-db
```

O Vault troca a senha do usuário administrativo por uma que só ele conhece. A partir desse momento, a única forma de administrar usuários naquele banco através dessa conta é pelo Vault.

Essa operação é irreversível no sentido prático: ninguém consegue recuperar a nova senha. Se houver necessidade de acesso administrativo direto para emergências, ela precisa estar resolvida por outra conta antes da rotação.

## O Papel Dinâmico

O papel define o que acontece quando alguém pede uma credencial. O núcleo é o SQL de criação:

```bash
vault write database/roles/pagamentos-leitura \
    db_name="pagamentos-db" \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
    default_ttl="1h" \
    max_ttl="24h"
```

Os três marcadores são preenchidos a cada pedido: um nome de usuário gerado, uma senha gerada e a data de expiração.

A cláusula de validade no próprio PostgreSQL merece destaque. Ela funciona como uma segunda barreira, independente do Vault. Se, por qualquer motivo, o Vault não conseguir remover o usuário ao fim do lease, o próprio banco recusa o login depois da data informada.

As permissões concedidas no SQL são o lugar certo para aplicar o princípio do menor privilégio. Um papel de leitura concede apenas leitura, um de escrita concede apenas o que a aplicação precisa escrever. Como criar papéis é barato, não há motivo para um único papel com todas as permissões.

## Obtendo e Gerenciando Credenciais

O consumidor pede uma credencial lendo o caminho do papel:

```bash
vault read database/creds/pagamentos-leitura
```

A resposta traz um usuário, uma senha e um lease com a duração padrão de uma hora, renovável até o limite máximo.

```bash
vault lease renew database/creds/pagamentos-leitura/<lease_id>
vault lease revoke database/creds/pagamentos-leitura/<lease_id>
```

Ao revogar ou expirar, o Vault remove o usuário do banco.

Há um caso em que essa remoção falha, e ele aparece com frequência em aplicações que criam objetos. Se o usuário dinâmico criou uma tabela, ele passa a ser o dono dela, e o PostgreSQL não permite remover um usuário que possui objetos. A solução é fazer com que os usuários dinâmicos pertençam a um papel de grupo dono dos objetos, e criem tabelas sob esse papel, em vez de serem eles próprios os donos.

## Quando o Usuário Precisa Existir

Nem todo sistema aceita trocar de usuário a cada conexão. Aplicações legadas, ferramentas de terceiros e integrações que dependem de um nome fixo esperam um usuário permanente.

Para esses casos existem os **static roles**. O Vault passa a gerenciar a senha de um usuário existente, trocando-a periodicamente:

```bash
vault write database/static-roles/integracao-legada \
    db_name="pagamentos-db" \
    username="integracao_legada" \
    rotation_period="24h"
```

```bash
vault read database/static-creds/integracao-legada
```

O usuário continua o mesmo, mas a senha muda a cada ciclo, e quem precisa dela a busca no Vault em vez de tê-la guardada.

Esse modelo tem um ponto frágil: qualquer alteração de senha feita fora do Vault dessincroniza os dois lados. O Vault continua entregando a senha que acredita ser a correta, e as conexões falham até que alguém corrija manualmente no banco. Depois que um usuário passa a ser gerenciado pelo Vault, toda alteração precisa passar por ele.

Na edição Enterprise existe ainda uma variante que dispensa a conta administrativa, em que cada usuário gerencia a própria rotação.

## O Impacto na Aplicação

Credenciais dinâmicas mudam o que a aplicação precisa fazer, e esse é o ponto que mais trava a adoção.

Uma aplicação que lê a senha uma vez na inicialização e mantém um pool de conexões para sempre não funciona bem com uma credencial que expira em uma hora. Ela precisa renovar o lease enquanto estiver ativa, ou buscar uma credencial nova e reciclar as conexões do pool antes que a anterior expire.

Existem formas de tirar essa responsabilidade do código. O Vault Agent, rodando ao lado da aplicação, cuida da autenticação, da renovação e da escrita das credenciais em arquivo, e a aplicação só precisa reler esse arquivo quando ele muda. Bibliotecas de acesso a banco em vários ecossistemas também oferecem integração direta.

A conversa com o time de aplicação deve acontecer antes da adoção, e não depois do primeiro pool de conexões quebrado em produção.

## Conclusão

O `app_user` compartilhado persiste porque resolver o problema dele parecia exigir uma rotação coordenada que ninguém conseguia executar com segurança. Credenciais just-in-time contornam a dificuldade em vez de enfrentá-la: não existe rotação coordenada quando não existe senha compartilhada.

O custo da mudança está na aplicação, que precisa aceitar credenciais com prazo de validade. Esse custo é real, e é ele que determina o ritmo da adoção.

Em troca, o banco de dados ganha algo que raramente teve: um registro em que cada conexão aponta para uma origem identificável, e em que um usuário encontrado nos logs de uma atividade suspeita pode ser associado a uma instância, a um horário e a um lease específico. Para quem já precisou investigar um incidente em um banco onde tudo acontecia sob o mesmo `app_user`, a diferença dispensa argumentos.
