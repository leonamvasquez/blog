---
title: "O Cofre Digital: Entendendo Shamir's Secret Sharing, Auto-Unseal e Recovery Keys"
description: "Como o Vault protege a própria chave mestra: a cadeia de chaves, a matemática do Shamir's Secret Sharing, o processo de unseal manual, o auto-unseal com KMS e o papel real das recovery keys."
date: 2026-08-28 19:00:00 -0300
categories: [DevSecOps, Segurança, Vault]
tags: [Vault, Shamir, Unseal, KMS, Criptografia, DevSecOps]
icons: [vault]
---

## Introdução

Cofres de banco costumam exigir duas pessoas para serem abertos. Cada uma conhece metade da combinação, e nenhuma consegue abrir sozinha. A regra não existe porque os funcionários sejam desonestos, e sim porque ela elimina a possibilidade de que um único erro, uma única coação ou uma única pessoa mal-intencionada seja suficiente.

O Vault aplica o mesmo princípio à chave que protege todos os seus dados, só que com matemática no lugar de combinações divididas ao meio.

Entender esse mecanismo é necessário para operar o Vault em produção. Ele determina o que acontece quando um servidor reinicia, quem precisa estar disponível nesse momento e o que se perde de forma irrecuperável se algo der errado.

## O Estado Selado

Como vimos no artigo anterior desta série, tudo que o Vault grava passa por uma barreira criptográfica. O armazenamento só recebe dados cifrados.

Quando o processo do Vault inicia, ele não tem em memória a chave capaz de decifrar esses dados. Nesse estado, chamado **selado**, ele sabe onde estão as informações mas não consegue lê-las, e recusa praticamente todas as requisições.

Desselar é o processo de entregar ao Vault o material necessário para reconstruir essa chave. Enquanto ele permanecer em execução, a chave fica apenas em memória. Se o processo reiniciar, o ciclo recomeça.

## A Cadeia de Chaves

O Vault não usa uma única chave. Ele usa uma cadeia, e cada elo protege o seguinte.

Os dados são cifrados por uma **chave de criptografia**, que fica guardada no próprio armazenamento, também cifrada. Quem cifra a chave de criptografia é a **root key**, que por sua vez também está armazenada de forma cifrada. A root key é protegida pela **chave de unseal**.

O motivo dessa indireção é operacional. Trocar a chave que protege os dados exigiria recifrar tudo. Com a cadeia, é possível trocar o elo superior, por exemplo distribuir novas partes da chave de unseal, sem tocar nos dados.

A pergunta que sobra é como proteger o último elo. É aí que entra o Shamir.

## A Matemática do Shamir

O método foi publicado por Adi Shamir em 1979, em um artigo de título direto: "How to Share a Secret". A ideia resolve um problema preciso: dividir um segredo em várias partes, de modo que qualquer grupo com um número mínimo delas reconstrua o segredo, e qualquer grupo menor não descubra absolutamente nada.

A intuição vem da geometria. Dois pontos determinam uma reta. Três pontos determinam uma parábola. De forma geral, são necessários k pontos para determinar um polinômio de grau k menos um.

O método funciona assim:

1. O segredo vira o termo constante de um polinômio, o ponto onde a curva cruza o eixo vertical.
2. Os demais coeficientes são escolhidos ao acaso.
3. Cada parte distribuída é um ponto dessa curva.
4. Com k pontos, a curva é reconstruída por interpolação, e o termo constante revela o segredo.

O detalhe que torna o esquema seguro está no que acontece com menos pontos. Com k menos um pontos, existe uma curva compatível com qualquer valor possível do segredo. A informação obtida é literalmente nula, e não apenas difícil de explorar. Os cálculos acontecem sobre um corpo finito, o que elimina vazamentos de informação que existiriam com números reais.

## Inicialização

A divisão acontece uma única vez, na inicialização:

```bash
vault operator init -key-shares=5 -key-threshold=3
```

Esses são os valores padrão: cinco partes, das quais três reconstroem a chave. A saída traz as cinco partes e o root token inicial.

Essa saída é o único momento em que as partes aparecem em conjunto. Se ela for registrada em um log de terminal, copiada para um único documento ou entregue inteira a uma pessoa, a proteção do esquema deixa de existir. Para evitar esse risco, o comando aceita chaves PGP dos detentores, e cada parte sai cifrada para a pessoa que vai guardá-la:

```bash
vault operator init \
    -key-shares=5 \
    -key-threshold=3 \
    -pgp-keys="ana.asc,bruno.asc,carla.asc,diego.asc,elisa.asc"
```

## Unseal Manual

Com o Vault selado, cada detentor entrega a sua parte:

```bash
vault operator unseal
```

O comando pede a parte sem exibi-la. O progresso aparece no status:

```bash
vault status
```

Quando o limite é atingido, o Vault reconstrói a chave, decifra a cadeia e passa a responder normalmente.

## O Custo Operacional

Esse modelo tem um custo que só aparece em operação. Cada reinício de cada servidor exige que três pessoas, entre as cinco, estejam disponíveis e acessíveis.

Isso inclui o reinício às três da manhã, depois de uma atualização do sistema operacional que ninguém lembrou de coordenar. Inclui o servidor que caiu e voltou sozinho em outra zona de disponibilidade. Inclui o feriado.

Em ambientes onde o Vault é dependência de todas as aplicações, um Vault selado é uma indisponibilidade geral. Foi para lidar com isso que surgiu o auto-unseal.

## Auto-Unseal

No auto-unseal, a proteção da root key é delegada a um serviço externo de gestão de chaves, como o KMS de um provedor de nuvem, um HSM ou outro Vault com o engine de Transit.

A configuração é um bloco no arquivo do servidor:

```hcl
seal "awskms" {
  region     = "us-east-1"
  kms_key_id = "df68263c-d9ee-44e3-afca-83cfa370c605"
}
```

Ao iniciar, o Vault pede ao serviço externo que decifre a root key. Se tiver permissão, recebe o resultado e se dessela sem intervenção humana.

A troca de confiança precisa ficar explícita. Com Shamir, a segurança depende de um quórum de pessoas. Com auto-unseal, ela depende de quem tem permissão para usar aquela chave no serviço externo. A política de acesso a essa chave passa a ser um dos controles mais críticos de toda a infraestrutura.

## Recovery Keys

Quando o Vault é inicializado com auto-unseal, ele não gera chaves de unseal. Gera **recovery keys**, também divididas pelo esquema de Shamir, com os mesmos padrões de cinco partes e limite de três.

```bash
vault operator init -recovery-shares=5 -recovery-threshold=3
```

O nome induz a um erro comum. As recovery keys não servem para desselar o Vault. Elas autorizam operações sensíveis que continuam exigindo um quórum humano, como a geração de um novo root token.

A consequência prática é séria. Se a chave do serviço externo for apagada, ou se o Vault perder permanentemente o acesso a ela, as recovery keys não recuperam os dados. A root key fica cifrada por uma chave que não existe mais. A proteção contra exclusão acidental dessa chave, incluindo os prazos de carência que os provedores oferecem, deixa de ser detalhe de configuração e passa a ser requisito de continuidade.

## Escolhendo Entre os Dois

O unseal manual com Shamir faz sentido quando não existe um serviço de chaves confiável disponível, quando a organização exige que nenhuma parte externa participe da proteção da chave, ou quando o volume de reinícios é baixo o bastante para que a coordenação humana não seja um problema.

O auto-unseal faz sentido na maioria dos ambientes em nuvem, onde disponibilidade é crítica e o serviço de chaves do provedor já é parte da base de confiança.

É possível migrar entre os dois modelos. A migração é um procedimento próprio e merece teste antes de ser executada em produção.

## Conclusão

O mecanismo de selagem do Vault é uma resposta a uma pergunta que todo sistema de segredos precisa enfrentar: quem protege a chave que protege tudo?

Não existe resposta que elimine o problema. O Shamir distribui a confiança entre pessoas e cobra em disponibilidade. O auto-unseal concentra a confiança em um serviço e cobra em dependência. A escolha é sobre qual dessas falhas a sua organização tem mais condições de prevenir.

O erro mais frequente não está na escolha entre os dois, e sim em não perceber que ela foi feita. Times que ativam o auto-unseal sem rever quem tem acesso à chave do KMS acabam com um cofre cuja segurança real é a de uma permissão de IAM que ninguém está olhando.
