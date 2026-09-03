---
title: "OpenTofu: O que o Fork do Terraform Significa para a Sua Infraestrutura"
description: "Entenda por que o OpenTofu existe, o que motivou a mudança de licença do Terraform em 2023, o que permanece compatível entre os dois projetos e quais critérios técnicos devem orientar a sua decisão."
date: 2026-05-12 19:00:00 -0300
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, Terraform, IaC, Open Source, Licenciamento, DevOps]
icons: [opentofu]
---

## Introdução

Um mal-entendido recorrente trata o OpenTofu como gesto ideológico contra o Terraform, projeto de voluntários, sem peso real para quem roda infraestrutura em produção. Dá para entender a origem dessa leitura, já que o projeto nasceu mesmo de uma briga de licenciamento. O problema é que ela para por aí e ignora tudo que veio depois.

Passados quase três anos do fork, o OpenTofu está sob a Linux Foundation, entrou para a CNCF e hoje oferece recursos que o Terraform simplesmente não tem. Não é mais uma cópia feita por precaução: o projeto trilha caminho próprio.

Este texto retoma o que provocou a divisão, mostra o que ainda é compatível entre as duas ferramentas, aponta onde elas já se afastaram uma da outra e traz critérios práticos para você decidir o que faz sentido no seu contexto. Nada aqui é resposta óbvia: a ideia não é convencer ninguém, e sim dar informação para decidir.

## O Que Mudou em Agosto de 2023

Por quase dez anos o Terraform rodou sob a **MPL 2.0** (Mozilla Public License), licença aberta e permissiva. Uso, modificação, redistribuição: qualquer empresa ou pessoa podia fazer isso, inclusive vender produto comercial construído em cima dele.

No dia 10 de agosto de 2023 a HashiCorp trocou essa licença pela **BUSL 1.1** (Business Source License), mudança que atingiu o Terraform e outros produtos da casa. Vale entender o que isso representa na prática.

BUSL não é licença aberta no sentido estrito do termo. O código segue visível e uso interno continua liberado, mas existe uma restrição de peso: fica vedado oferecer produto ou serviço que concorra com o que a HashiCorp vende.

Duas consequências saem daí:

1. **Quase nada muda para o usuário final típico.** Empresa que usa o Terraform só para provisionar a própria infraestrutura segue tranquila, dentro da licença.
2. **Para fornecedores, a história é outra.** Plataformas montadas sobre o Terraform passaram a viver em zona cinzenta juridicamente, à mercê de como se interpreta "concorrência".
Foi esse segundo grupo que se mexeu primeiro, motivo óbvio: o modelo de negócio dessas empresas perdeu respaldo legal de uma hora para outra.

## Da Reação ao Projeto: a Linha do Tempo

A comunidade reagiu rápido e de forma organizada. Vale acompanhar a sequência, porque ela explica por que esse fork pegou tração onde tantos outros não saem do lugar.

- **Agosto de 2023.** Sai um manifesto público cobrando a reversão da licença. Sem resposta da HashiCorp, o grupo parte para o fork (batizado de início como OpenTF), partindo da última versão do Terraform ainda sob MPL 2.0, a linha 1.5.
- **Setembro de 2023.** A Linux Foundation abraça o projeto, que ganha o nome OpenTofu. Esse é o divisor de águas: a governança sai das mãos de um grupo de empresas interessadas e passa para uma fundação neutra.
- **Janeiro de 2024.** Chega a versão 1.6.0, primeiro release estável, pronto para produção.
- **Fevereiro de 2025.** A IBM fecha a compra da HashiCorp por 6,4 bilhões de dólares. O Terraform entra no portfólio de uma empresa bem maior.
- **Abril de 2025.** O OpenTofu entra na CNCF em nível Sandbox, com exceção formal que garantiu a permanência da licença MPL 2.0.
Um detalhe que costuma passar batido nessas discussões: a estrutura de governança importa. Fork mantido por um consórcio de fornecedores tende a puxar para os interesses desses fornecedores. Projeto sob fundação neutra, por outro lado, tem regras de contribuição públicas, marca própria e um roadmap que nenhuma empresa isolada manda sozinha.

## O Que "Fork" Significa Tecnicamente

Aqui mora a dúvida mais comum, e a resposta é bem menos dramática do que a origem do projeto faz parecer.

O OpenTofu manteve intactas as bases técnicas do Terraform:

- **A linguagem.** HCL é o mesmo. Módulos, expressões e blocos funcionam sem tocar em nada.
- **O formato de estado.** Arquivos de estado conversam nos dois sentidos. Na prática, dá para apontar para o mesmo backend durante uma migração.
- **O protocolo de providers.** Os binários de provider são os mesmos para os dois motores. O ecossistema do OpenTofu já somava mais de 3.900 providers e 23.600 módulos em meados de 2026.
- **A interface de linha de comando.** Comandos equivalentes, o que muda é só o binário chamado: `tofu` em vez de `terraform`.
Na prática, migrar um projeto simples se resume a trocar o binário:

```bash
# Antes
terraform init
terraform plan
terraform apply

# Depois
tofu init
tofu plan
tofu apply
```

Um ponto que merece atenção sobre o estado: no primeiro `apply` rodado pelo OpenTofu, o marcador de versão gravado no arquivo de estado é atualizado. É o único registro que muda numa configuração padrão, e isso não compromete a leitura do estado por nenhuma das duas ferramentas.

Isso não quer dizer, porém, que a troca dispense validação. Configurações que dependem de recursos exclusivos de versões recentes do Terraform pedem checagem caso a caso, e o cuidado de sempre com plano e revisão continua valendo.

## Onde os Projetos Já Divergiram

Se compatibilidade fosse tudo que importasse, escolher entre um e outro seria indiferente. Não é o caso: desde 2024 o OpenTofu vem entregando recursos sem equivalente no Terraform de código aberto.

Os mais relevantes para operação:

1. **Criptografia de estado nativa.** Chegou na versão 1.7 e permite cifrar o arquivo de estado sem depender de ferramenta externa. Como o estado costuma guardar dado sensível, essa é a diferença mais significativa do ponto de vista de segurança.
2. **Avaliação antecipada de variáveis.** Desde a 1.8 passou a ser possível usar variáveis na configuração de backend e na origem de módulos, limitação antiga do Terraform que empurrou boa parte da adoção de ferramentas de orquestração por aí.
3. **Iteração em providers.** A 1.9 trouxe `for_each` em blocos de provider, o que facilita bastante cenários multi-região e multi-conta.
4. **Registries OCI.** A 1.10 abriu a possibilidade de distribuir módulos e providers no mesmo padrão usado por imagens de container, interessante para ambiente isolado de rede.
5. **Valores efêmeros.** A 1.11 trouxe valores que não ficam persistidos no estado, resolvendo o problema clássico de segredo gravado em disco.
A linha 1.12, lançada em maio de 2026, seguiu na mesma linha, com melhorias operacionais como proteção dinâmica contra destruição de recursos.

O caminho inverso também acontece: a HashiCorp continua desenvolvendo recursos próprios, alguns amarrados à sua plataforma comercial, que o OpenTofu decidiu, de forma explícita, não replicar. Os dois projetos não estão convergindo, e apostar que um dia voltarão a ser idênticos é erro de planejamento.

## O Que Isso Significa para a Sua Infraestrutura

Traduzindo em critério de decisão, três cenários cobrem a maioria dos casos.

**Você usa Terraform internamente, sem revender infraestrutura.**
Juridicamente, a BUSL não te atinge, e dá para continuar onde está sem problema. A pergunta que sobra é técnica: existe algum recurso exclusivo do OpenTofu que resolve algo que te incomoda hoje? Criptografia de estado e valores efêmeros costumam ser o argumento que pesa mais.

**Você constrói produto ou serviço em cima da ferramenta.**
Aqui a conversa muda de figura. A restrição da BUSL bate direto no seu modelo de negócio, e não é acaso que as principais plataformas gerenciadas de IaC tenham adotado o OpenTofu como padrão.

**Você depende de recursos específicos da HashiCorp.**
Se seu fluxo está amarrado à plataforma comercial da empresa, o OpenTofu não substitui de forma direta. Migrar exigiria trocar também essas integrações, projeto de escopo bem maior.

Existe ainda uma dimensão que vai além do técnico: previsibilidade de licenciamento. Ferramenta sob fundação neutra oferece uma garantia que ferramenta sob controle corporativo não consegue dar, a de que as regras de uso não vão mudar por decisão unilateral de ninguém. Para infraestrutura pensada em anos, isso é critério legítimo de avaliação.

## O Impacto na Engenharia de Plataforma

Além da escolha entre as duas ferramentas, o episódio deixou uma lição de arquitetura que vale guardar.

Times que já tinham separado a camada de orquestração da camada de execução atravessaram a mudança sem grande esforço. Quem usava Terragrunt, por exemplo, só precisou apontar a orquestração para outro binário, sem reescrever a estrutura de ambientes. Quem tinha tudo colado num único fornecedor encarou projeto de migração de verdade.

A conclusão prática: desacoplar o motor de execução da camada de orquestração deixou de ser preferência estética e virou proteção contra risco de fornecedor. Se você ainda não organizou sua infraestrutura assim, o tema está detalhado em [Gerenciamento de Múltiplos Ambientes (Dev, Stage, Prod) com Terraform e Terragrunt](https://leonam.io/posts/gerenciamento-multiplos-ambientes-terraform-terragrunt/).

## Conclusão

O OpenTofu existe porque uma mudança de licença colocou em dúvida o futuro de uma ferramenta que sustenta a infraestrutura de milhares de organizações. Sobreviveu porque achou governança neutra, e se firmou porque deixou de só acompanhar o Terraform para passar a entregar recursos próprios.

Escolher entre os dois não é questão ideológica, é contextual. Depende do seu modelo de negócio, dos recursos que você realmente usa e do peso que previsibilidade de licenciamento tem no seu planejamento.
