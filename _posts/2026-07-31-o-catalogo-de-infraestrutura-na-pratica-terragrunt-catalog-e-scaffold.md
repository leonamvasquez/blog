---
title: "O Catálogo de Infraestrutura na Prática: terragrunt catalog e scaffold"
description: "Como usar os comandos catalog e scaffold do Terragrunt para descobrir módulos internos e gerar units a partir de templates, transformando o repositório de módulos em um catálogo navegável."
date: 2026-07-31 19:00:00 -0300
categories: [DevOps, IaC, Terragrunt]
tags: [Terragrunt, Catalog, Scaffold, Platform Engineering, IaC, DevOps]
icons: [terragrunt, terraform, opentofu]
---

## Introdução

Pense em como uma unit nova aparece no seu repositório. Na maioria das vezes, alguém abre a pasta do vizinho, copia tudo, joga fora o que não serve e ajusta o resto na mão.

Funciona, e é rápido. Mas também é o jeito mais comum de espalhar defeitos. O módulo fica numa versão antiga porque a pasta de origem não era mexida havia meses. Uma dependência é esquecida e só aparece no primeiro erro. As convenções que o time definiu no ano passado não chegam à unit nova, já que a pasta copiada nasceu antes delas.

O Terragrunt traz dois comandos para trocar esse hábito: um mostra quais módulos existem, o outro gera a unit a partir de um template.

## Os Dois Comandos

Cada comando cuida de uma etapa.

O `catalog` serve para descobrir. Ele diz quais módulos a organização mantém e para que serve cada um, e você não precisa ficar abrindo repositórios no navegador para isso.

O `scaffold` serve para gerar. Ele escreve o arquivo de configuração da unit já preenchido, com a origem certa e a lista de parâmetros do módulo.

Os dois se encaixam em sequência: você percorre o catálogo, escolhe um módulo e pede a geração.

## O Bloco catalog

Configurar é simples. Na raiz do repositório, um bloco informa onde ficam os módulos:

```hcl
# terragrunt.hcl na raiz do infrastructure-live
catalog {
  urls = [
    "https://github.com/minhaorg/modulos-infraestrutura",
    "https://github.com/minhaorg/modulos-dados",
  ]
}
```

O atributo `urls` traz a lista de repositórios que o Terragrunt vai percorrer. Espera-se que cada repositório guarde seus módulos numa pasta dedicada, seguindo a convenção usual nesse tipo de projeto.

Como o bloco está na raiz, ele vale para aquele diretório e tudo que está abaixo dele. Quem trabalha no repositório enxerga, portanto, o mesmo catálogo.

## Navegando pelo Catálogo

Com o bloco no lugar, basta rodar o comando sem nenhum argumento:

```bash
terragrunt catalog
```

O Terragrunt clona os repositórios e abre uma interface de terminal listando os módulos que encontrou. Se há muitos repositórios, a primeira execução leva mais tempo. As seguintes são rápidas, porque os clones ficam guardados em cache.

Poucas teclas bastam para se mover por ali:

- **Setas** percorrem a lista de módulos.
- **Enter** abre a documentação do módulo selecionado.
- **Barra** inicia uma busca digitada.
- **S** gera a unit a partir do módulo selecionado.

Dá também para indicar um repositório específico, sem depender do bloco:

```bash
terragrunt catalog https://github.com/minhaorg/modulos-infraestrutura
```

O valor disso é menos evidente do que parece. Numa organização com dezenas de módulos internos, quem acaba de chegar raramente pergunta como o Terragrunt funciona. A dúvida costuma ser o que já está pronto, e o catálogo responde isso sem sair do terminal.

## Gerando a Unit com scaffold

O comando também funciona isolado, sem passar pela interface:

```bash
terragrunt scaffold https://github.com/minhaorg/modulos-infraestrutura//modules/vpc
```

Ele grava um arquivo de configuração no diretório atual, com três itens já resolvidos.

Primeiro, a origem vem preenchida com a URL do módulo e a tag mais recente, o que elimina o problema da versão herdada por cópia. Segundo, a configuração raiz é incluída pelo mecanismo padrão de busca nos diretórios acima. Terceiro, o bloco de entradas traz todos os parâmetros do módulo, divididos entre obrigatórios e opcionais.

Os obrigatórios já aparecem para você preencher, com uma marca mostrando o que falta. Os opcionais chegam comentados, com descrição e tipo, e você só descomenta o que for usar.

A tarefa muda de natureza. Em vez de ler o código do módulo para descobrir o que ele aceita, você recebe a lista pronta e só decide o que preencher.

## Templates Próprios

O padrão gerado é razoável, mas dificilmente reflete as convenções do seu time. Para isso existem os templates.

O Terragrunt usa a ferramenta de templates da própria Gruntwork, e a detecção é automática: se o diretório do módulo tem uma pasta reservada para esse fim, ela passa a ser o template.

A estrutura tem duas partes. Um arquivo de configuração declara as variáveis que serão perguntadas a quem gera a unit:

```yaml
# .boilerplate/boilerplate.yml
variables:
  - name: TeamName
    description: Time responsável por este recurso
    type: string
```

Já os arquivos de template, escritos como templates Go, podem ser tudo o que você quiser gerar junto:

{% raw %}
```hcl
# .boilerplate/terragrunt.hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "{{ .sourceUrl }}"
}

inputs = {
  team = "{{ .TeamName }}"

{{ range $var := .requiredVariables }}
  {{ $var.Name }} = null # TODO: preencher
{{ end }}
}
```
{% endraw %}

Além das variáveis que você mesmo define, o template recebe a URL de origem e a lista de parâmetros do módulo, já separada entre obrigatórios e opcionais.

Também é possível passar um template de forma explícita, como segundo argumento do comando. Assim o padrão do time vale para qualquer módulo, até os de terceiros.

## O Que Isso Habilita

Este é o ponto que interessa a quem pensa em plataforma, e não só a quem usa Terragrunt.

Num template, as convenções deixam de ser documentação e passam a ser padrão executável. Tags obrigatórias, regras de nomes, hooks de validação, arquivos de apoio que todo componente precisa ter: tudo pode morar no template e ser aplicado a cada unit criada.

Ao contrário de um guia de boas práticas, aqui ninguém precisa se lembrar de nada. O caminho mais fácil já entrega o resultado correto, que é a ideia central de um caminho pavimentado.

Há ainda uma ligação com os Stacks, explicados em [Terragrunt Stacks por Dentro: Implícitos vs. Explícitos](https://leonam.io/posts/terragrunt-stacks-por-dentro-implicitos-vs-explicitos/). Naquele texto, o catálogo era um conceito: uma coleção versionada de units. Aqui ele ganha as ferramentas para descobrir e gerar.


## Conclusão

O que esses dois comandos enfrentam não é uma limitação técnica. É um problema de descoberta e de repetição.

Times de infraestrutura costumam saber mais do que conseguem repassar. O módulo certo existe, a convenção já foi combinada, alguém já resolveu aquele caso. Só que a informação não alcança quem precisa dela na hora em que precisa, e o resultado é a cópia da pasta do vizinho.

Transformar esse saber num catálogo navegável e num template executável tem menos a ver com digitar menos e mais a ver com encurtar a distância entre o que o time sabe e o que consegue aplicar de modo consistente. Em organizações grandes, essa distância pesa mais na qualidade da infraestrutura do que o domínio técnico de qualquer ferramenta.