---
title: "Hooks no Terragrunt: Pontos de Extensão do Ciclo de Vida"
description: "Como usar before_hook, after_hook e error_hook no Terragrunt: sintaxe, ordem de execução, tratamento de falhas e o critério para decidir entre hook, pipeline e recursos do próprio motor."
date: 2026-07-17 19:00:00 -0300
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Hooks, CI/CD, IaC, DevOps, Automação]
icons: [terragrunt, terraform, opentofu]
---

## Introdução

Basicamente toda equipe que trabalha com Terragrunt termina construindo um script ao redor dele.

O início costuma ser modesto: um lint antes do plano. Aí entra a atualização do kubeconfig, depois um aviso no canal do time, depois a remoção de um arquivo temporário. Chega um ponto em que ninguém mais chama o Terragrunt direto — existe sempre um wrapper que precisa disparar antes.

O incômodo desse padrão é que toda essa lógica fica fora da configuração. Ninguém herda esse comportamento, ele não segue a unit, e desaparece assim que alguém dispara o comando manualmente.

É exatamente esse problema que os hooks atacam: eles trazem esses passos para dentro do próprio arquivo de configuração, onde passam a ser versionados e herdados como qualquer outro atributo.

## Os Três Tipos

Declarados dentro do bloco `terraform`, os hooks existem em três formatos:

- **`before_hook`** dispara antes da chamada ao OpenTofu ou Terraform.
- **`after_hook`** dispara depois dela.
- **`error_hook`** entra em ação quando ocorre um erro cuja mensagem bate com um padrão definido por você.

Um exemplo mínimo já deixa a estrutura clara:

```hcl
terraform {
  before_hook "aviso_inicio" {
    commands = ["apply", "plan"]
    execute  = ["echo", "Iniciando execução"]
  }

  after_hook "aviso_fim" {
    commands     = ["apply", "plan"]
    execute      = ["echo", "Execução concluída"]
    run_on_error = true
  }
}
```

Há dois atributos obrigatórios: `commands`, que define em quais comandos o hook age, e `execute`, que recebe comando e argumentos numa lista.

## Os Atributos que Fazem Diferença

Além dos dois obrigatórios, existem quatro opcionais que pesam bastante na prática:

- **`working_dir`** controla onde o hook é executado. O padrão muda conforme o caso: na maioria das vezes é o diretório do módulo, que fica dentro do cache quando você usa `source`. É um detalhe que costuma pegar quem imaginava estar no diretório da própria unit.
- **`run_on_error`** força o hook a rodar mesmo depois de uma falha anterior. Por padrão, isso vem desligado.
- **`suppress_stdout`** silencia o output do comando — útil quando algum script depende de ler a saída do motor sem interferência, e qualquer texto extra atrapalharia essa leitura.
- **`if`** deixa o hook pular a execução quando a expressão resulta em falso.

## before_hook: Preparação e Validação

O caso de uso mais comum é assegurar que algo aconteça antes de qualquer execução — validar código, por exemplo:

```hcl
terraform {
  before_hook "tflint" {
    commands = ["plan", "apply"]
    execute  = ["tflint", "--minimum-failure-severity=error"]
  }
}
```

O tflint conta com suporte nativo via hook, o que torna essa integração direta.

Outra aplicação frequente é preparar o terreno para o que vem depois:

```hcl
terraform {
  before_hook "kubeconfig" {
    commands = ["plan", "apply"]
    execute = [
      "aws", "eks", "update-kubeconfig",
      "--region", "us-east-1",
      "--name", "cluster-producao"
    ]
  }
}
```

E é aqui que fica visível a vantagem sobre o script à parte: declarado na configuração raiz, esse passo passa a ser herdado por todas as units que dependem dele, sem que ninguém precise se lembrar disso manualmente.

## after_hook: Limpeza e Notificação

Depois que a execução termina, os dois cenários mais típicos são avisar alguém e limpar algo. O que separa um do outro é o `run_on_error`:

```hcl
terraform {
  after_hook "notifica_sucesso" {
    commands     = ["apply"]
    execute      = ["bash", "-c", "./scripts/notifica.sh sucesso"]
    run_on_error = false
  }

  after_hook "limpeza" {
    commands     = ["apply"]
    execute      = ["bash", "-c", "rm -f /tmp/lock-terragrunt"]
    run_on_error = true
  }
}
```

Notificar só faz sentido se tudo deu certo. Já a limpeza precisa rodar de qualquer jeito. É justamente essa diferença que o atributo captura.

## error_hook: Respondendo a Falhas Específicas

O terceiro tipo é o mais rico e, ao mesmo tempo, o mais negligenciado. Ele só é acionado quando a mensagem de erro casa com algum dos padrões declarados:

```hcl
terraform {
  error_hook "permissao_negada" {
    commands  = ["plan", "apply"]
    on_errors = ["AccessDenied", "UnauthorizedOperation"]
    execute   = ["bash", "-c", "./scripts/diagnostica-permissao.sh"]
  }

  error_hook "captura_diagnostico" {
    commands  = ["apply"]
    on_errors = [".*"]
    execute   = ["bash", "-c", "./scripts/coleta-contexto.sh"]
  }
}
```

`on_errors` trabalha com expressões regulares. Um padrão que casa com qualquer coisa serve de rede de segurança geral, enquanto padrões mais específicos permitem tratar cada causa de forma diferente.

Vale reter dois pontos de comportamento. Os error_hooks só entram depois que os hooks de antes e depois já rodaram. E se a intenção é capturar falhas no download de um módulo referenciado via `source`, o comando certo a incluir na lista é o de inicialização a partir do módulo — o erro, nesse caso, acontece antes mesmo de a execução normal começar.

## Ordem de Execução e Interrupção Antecipada

Quando mais de um hook está associado ao mesmo comando, a ordem de execução segue a ordem de declaração. Isso viabiliza encadear etapas com previsibilidade.

Um comportamento em especial merece atenção, porque é o que dá aos hooks seu valor como barreira de qualidade: **quando um `before_hook` falha, a execução para ali**. O motor sequer chega a ser chamado, e os hooks seguintes sem `run_on_error` também ficam de fora.

Na prática, um hook de validação passa a funcionar como um portão de entrada. Se o lint reprova, nada chega a ser aplicado.

## Hooks Condicionais

Como fazem parte da configuração, os hooks enxergam variáveis e locals normalmente. Isso abre espaço para comportamento distinto por ambiente:

```hcl
locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals.environment
}

terraform {
  before_hook "aprovacao_producao" {
    commands = ["apply"]
    execute  = ["bash", "-c", "./scripts/verifica-janela-de-mudanca.sh"]
    if       = local.env == "prod"
  }
}
```

Esse é um dos pontos em que o script externo simplesmente não consegue competir: a condição aparece explícita, ao lado da própria configuração que ela governa.

## Hook, Pipeline ou Recurso Nativo do Motor

Com três lugares possíveis para hospedar automação, ajuda ter um critério claro na hora de escolher.

**Vá de hook quando** o passo precisa rodar toda vez que aquela unit é executada, não importa quem disparou o comando. Preparo de ambiente, validação de código e coleta de diagnóstico se encaixam bem nesse perfil.

**Vá de pipeline quando** o passo pertence ao processo de entrega, não à unit propriamente. Aprovação manual, publicação de artefatos e controle sobre ambientes protegidos funcionam melhor vivendo na esteira.

**Vá de recurso nativo do motor quando** a ação faz parte do ciclo de vida do próprio recurso e o plano precisa ter conhecimento dela. Convém lembrar que o Terraform passou a oferecer mecanismos próprios para esse tipo de ação, assunto tratado em [Terraform Actions Explicado](https://leonam.io/posts/terraform-actions-explicado-o-guia-de-engenharia-para-o-futuro-da-iac/).

A pergunta que distingue os três caminhos é direta: esse passo pertence à unit, ao processo de entrega, ou ao recurso?

## Pontos de Atenção

Três cuidados antes de sair adotando isso em produção.

**Hooks se multiplicam em execuções em lote.** Um hook na raiz roda uma vez por unit. Num `run --all` sobre cinquenta units, aquele lint dispara cinquenta vezes. Meça o custo antes de colocar algo pesado ali.

**O diretório de trabalho quase nunca é o esperado.** Quando existe `source`, o módulo é copiado para um cache, e é ali que o hook roda por padrão. Se o script precisa de arquivos da própria unit, declare `working_dir` explicitamente.

**Recursos recentes ainda podem estar em maturação.** Há funcionalidades em desenvolvimento nessa área — variáveis de contexto disponíveis para os hooks, uma forma de desativá-los pontualmente na execução. Antes de depender delas em produção, confira o estado atual na versão que você está usando.

## Conclusão

Os hooks não trazem capacidade nenhuma que já não existisse. Qualquer coisa que eles fazem, um script ao redor do Terragrunt também faria.

O que muda é onde essa lógica passa a morar. Dentro da configuração, ela é herdada pela hierarquia de units, acompanha o código nas revisões de Pull Request e se comporta igual para todo mundo — inclusive para quem roda o comando direto do terminal sem saber que ali existia um wrapper.

É o tipo de mudança que parece pequena no dia em que é feita e só mostra seu valor meses depois, quando alguém novo entra no time e consegue operar a infraestrutura sem precisar descobrir qual script deveria ter chamado.
