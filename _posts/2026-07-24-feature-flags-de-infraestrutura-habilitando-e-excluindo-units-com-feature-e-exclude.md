---
title: "Feature Flags de Infraestrutura: Habilitando e Excluindo Units com feature e exclude"
description: "Como usar os blocos feature e exclude do Terragrunt para controlar quais units executam, escolher ambientes em execuções em lote e entender onde o exclude para de valer e o no_run assume."
date: 2026-07-24 19:00:00 -0300
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Feature Flags, IaC, DevOps, Platform Engineering]
icons: [terragrunt, terraform, opentofu]
---

## Introdução

Times de desenvolvimento resolveram há anos o problema de integrar código que ainda não deve rodar. Chama-se feature flag: o código entra na branch principal desligado, e alguém decide depois quando ligá-lo.

Em infraestrutura, o que se vê com mais frequência é outra coisa: uma branch de longa duração, blocos inteiros comentados ou uma variável booleana com condicionais espalhadas pelo código.

O Terragrunt oferece uma resposta própria, com dois blocos que trabalham juntos: `feature`, que declara a chave, e `exclude`, que decide o que fazer quando ela indica que a unit não deve rodar.

## O Bloco feature

A declaração vive na configuração da unit, e todo flag precisa de um valor padrão:

```hcl
feature "habilita_cache" {
  default = false
}
```

O valor pode ser sobrescrito na execução, de duas formas:

```bash
# Pela linha de comando
terragrunt --feature habilita_cache=true apply

# Por variável de ambiente (vários flags separados por vírgula)
export TG_FEATURE=habilita_cache=true,ambiente=dev
terragrunt apply
```

A vantagem em relação a uma variável qualquer é de clareza: ao ler a configuração, fica evidente que aquilo é um ponto de controle deliberado, e não um parâmetro comum.

O valor padrão é avaliado como expressão em tempo de execução. Isso permite buscar o valor em um serviço externo de feature flags, como LaunchDarkly ou AppConfig:

```hcl
feature "habilita_cache" {
  default = run_cmd("--terragrunt-quiet", "./scripts/consulta-flag.sh", "cache")
}
```

O valor também pode ser consumido em outras partes da configuração, como `inputs` e hooks:

```hcl
inputs = {
  habilita_cache = feature.habilita_cache.value
}
```

## O Bloco exclude

Declarar a chave resolve metade do problema. A outra metade é decidir o que acontece quando a unit deve ficar de fora, e é aí que entra o `exclude`:

```hcl
exclude {
  if      = true
  actions = ["plan", "apply"]
}
```

Os atributos são quatro:

- **`if`** recebe a condição que determina se a unit é excluída.
- **`actions`** lista as ações excluídas. Aceita comandos específicos como `plan` e `apply`, `all` para excluir tudo e `all_except_output` para excluir tudo mantendo o `output`, o que importa quando outras units dependem daquela.
- **`exclude_dependencies`** remove também as dependências da unit da fila de execução. O padrão é `false`.
- **`no_run`** impede a execução da unit em comandos de unit única. Voltamos a ele adiante, porque é a peça que costuma faltar.

## Combinando os Dois

Juntos, os blocos formam o padrão que interessa: uma unit entra no repositório desligada e só executa quando alguém decidir.

```hcl
terraform {
  source = "github.com/minhaorg/modulos//cache?ref=v1.2.0"
}

feature "habilita_cache" {
  default = false
}

exclude {
  if                   = !feature.habilita_cache.value
  actions              = ["all"]
  exclude_dependencies = !feature.habilita_cache.value
}
```

O código está versionado, revisado em Pull Request e visível para todo mundo. Ele só não entra na execução enquanto a flag estiver desligada. Isso reduz a necessidade da branch de longa duração, que é onde o código de infraestrutura costuma envelhecer esperando aprovação.

## Escolhendo Ambientes em Execuções em Lote

O uso mais prático aparece quando há muitas units e você quer rodar só um subconjunto. Em vez de memorizar caminhos, declare cada ambiente como um flag. Aqui, `dev` liga por padrão e os demais ficam desligados:

```hcl
# dev/terragrunt.hcl
feature "dev" {
  default = true
}

exclude {
  if      = !feature.dev.value
  actions = ["all_except_output"]
}
```

```hcl
# stage/terragrunt.hcl (prod segue o mesmo padrão)
feature "stage" {
  default = false
}

exclude {
  if      = !feature.stage.value
  actions = ["all_except_output"]
}
```

Com o padrão aplicado a cada ambiente, a seleção vira parte do comando. Como `dev` liga por padrão, é preciso desligá-lo explicitamente:

```bash
# Roda apenas staging
terragrunt run --all --feature dev=false --feature stage=true plan

# Roda staging e produção, deixando dev de fora
terragrunt run --all --feature dev=false --feature stage=true --feature prod=true plan
```

O uso de `all_except_output` é deliberado: as units excluídas continuam podendo fornecer suas saídas para as que permanecem na fila, o que evita quebrar dependências entre ambientes.

## Versionamento Dinâmico de Módulos

Como o valor do flag é uma expressão comum, ele também pode compor a origem do módulo, sem envolver exclusão nenhuma:

```hcl
feature "versao_s3" {
  default = "v1.0.0"
}

terraform {
  source = "git::git@github.com:minhaorg/modulos.git//s3?ref=${feature.versao_s3.value}"
}
```

Testar uma versão nova em um ambiente passa a ser um parâmetro de execução:

```bash
terragrunt --feature versao_s3=v1.1.0 apply
```

Não é preciso alterar o código, nem reverter um commit se o resultado não agradar.

## Onde o exclude Para e o no_run Assume

Este é o ponto que mais gera confusão. O `exclude` trabalha sobre a **fila de execução**, e a fila só existe em execuções em lote. Se alguém entra no diretório de uma unit e roda o comando direto, não há fila para filtrar.

Para esse caso existe o `no_run`. Segundo a documentação, quando `if` e `no_run` são verdadeiros, ele impede a execução da unit em comandos de unit única, mas apenas quando a ação corrente consta em `actions`:

```hcl
exclude {
  if      = !feature.habilita_cache.value
  no_run  = true
  actions = ["plan", "apply"]
}
```

Duas consequências práticas:

- Em `run --all`, o `no_run` é ignorado. Quem trabalha ali é o `exclude`.
- Rodar `terragrunt plan` direto na pasta da unit é barrado, mas um `destroy`, que não está em `actions`, passa. Liste todas as ações que precisam de proteção, ou use `all`.

A própria documentação sugere um uso adequado: unidades caras de atualizar continuamente e que devem ser ativadas só quando necessário.

Nenhum dos dois é um controle de acesso. Quem tem permissão de alterar a configuração pode desligar a regra. Para política de quem pode aplicar o quê, o lugar certo é o pipeline ou a camada de permissões. Para lógica própria antes da execução, um hook resolve, e o funcionamento está em [Hooks no Terragrunt: Pontos de Extensão do Ciclo de Vida](/posts/hooks-no-terragrunt-pontos-de-extensao-do-ciclo-de-vida/).

## Cuidados

**As condições não enxergam saídas de dependências.** Os atributos do bloco `exclude` não podem referenciar saídas de outras units. O Terragrunt avalia o bloco enquanto monta a fila, antes de qualquer dependência rodar, e rejeita a configuração que tenta fazer isso.

**Flags acumulam dívida.** Um flag que deveria ser temporário e fica dois anos no código vira um mecanismo de controle que ninguém lembra para que serve. Defina quando cada flag será removido no mesmo Pull Request que o cria.

**A exclusão aparece no relatório.** Quando uma unit é excluída, o relatório de execução do Terragrunt registra o motivo. É útil para auditoria e também para descobrir por que algo não rodou quando você esperava que rodasse.

## Conclusão

O que esses blocos fazem é trazer para a infraestrutura uma separação que o desenvolvimento de software consolidou há tempos: a diferença entre integrar código e ativá-lo.

Quando as duas coisas são a mesma, todo código novo é uma decisão entre esperar em uma branch ou ir para produção. Quando se separam, o código pode ser revisado, versionado e integrado sem que isso signifique executá-lo.

A infraestrutura chegou mais tarde a esse ponto por um motivo compreensível: desligar uma funcionalidade em uma aplicação é um condicional, enquanto desligar um componente de infraestrutura é decidir que ele não existe. Por isso a resposta veio da camada de orquestração, e não da linguagem.
