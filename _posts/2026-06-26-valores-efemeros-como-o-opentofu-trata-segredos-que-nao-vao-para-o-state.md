---
title: "Valores Efêmeros: Como o OpenTofu Trata Segredos que Não Vão para o State"
description: "Entenda os valores efêmeros do OpenTofu: a diferença entre sensitive e ephemeral, variáveis e saídas efêmeras, recursos efêmeros e atributos write-only, com os contextos onde cada um pode ser usado."
date: 2026-06-26 19:00:00 -0300
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, State, Segurança, DevSecOps, Segredos, IaC]
icons: [opentofu]
---

## Introdução

Marcar uma variável como `sensitive` resolve bem menos do que parece. O valor para de aparecer na saída do terminal, mas segue gravado no arquivo de estado, em texto claro, disponível pra quem conseguir abrir o arquivo.

A confusão é comum e faz sentido. A palavra sugere proteção, quando na real ela só oculta da exibição.

O OpenTofu 1.11 trouxe resposta de outra natureza pra esse problema. Em vez de esconder o valor depois de gravado, ele deixa certo dado nunca ser gravado. São os valores efêmeros, que existem só em memória durante uma única execução.

## Sensitive e Ephemeral: a Diferença

Vale fixar a distinção antes de qualquer código, porque ela organiza o resto todo.

Um valor marcado como `sensitive` é persistido normalmente no estado e nos arquivos de plano. A marcação muda só a forma como ele aparece, trocando o conteúdo por um marcador na saída dos comandos.

Um valor efêmero não é persistido. Vive na memória durante a execução e some no final. Não vai pro snapshot do estado nem pro arquivo de plano.

São mecanismos complementares, não concorrentes. Um protege contra exposição visual, o outro contra persistência.

## Variáveis Efêmeras

A declaração é direta, com atributo próprio:

```hcl
variable "chave_de_acesso" {
  type      = string
  ephemeral = true
  sensitive = true
}

variable "chave_secreta" {
  type      = string
  ephemeral = true
  sensitive = true
}
```

O uso típico é alimentar a configuração de um provider com credencial temporária, obtida na hora da execução:

```hcl
provider "aws" {
  access_key = var.chave_de_acesso
  secret_key = var.chave_secreta
}
```

A credencial passa pela ferramenta, autentica e não deixa rastro no estado.

## Recursos Efêmeros

Além de receber valor por variável, a ferramenta consegue buscar ativamente. O bloco `ephemeral` funciona parecido com fonte de dado: lê o recurso, disponibiliza o resultado e encerra quando não é mais necessário.

```hcl
ephemeral "aws_secretsmanager_secret_version" "senha_banco" {
  secret_id = "producao/banco/senha"
}
```

Tudo que vem na resposta de um recurso efêmero fica automaticamente marcado como efêmero, o que impede o uso acidental num contexto que persistiria o valor.

Vale notar uma dependência prática: recurso efêmero exige provider atualizado pra suportar. Nem todo provider oferece esse tipo, então convém checar a documentação do seu antes de planejar a adoção.

## Atributos Write-Only

Esse é o complemento que fecha o ciclo. Valores efêmeros resolvem a entrada de segredo, mas e quando você precisa **gravar** um segredo num recurso, tipo a senha de um banco?

Os atributos write-only existem pra isso. Aceitam um valor na configuração e transmitem ao provider, mas o comportamento deles em relação ao estado é peculiar:

- O atributo existe só na seção de configuração do recurso.
- No estado e no plano, ele fica sempre registrado como nulo.
- O provider sempre devolve nulo, mesmo tendo recebido valor real.
- Pode receber tanto valor comum quanto efêmero, diferente do atributo normal, que não aceita valor efêmero.

Como o valor não vai pro plano, a ferramenta não tem como perceber que mudou. A solução adotada pelos providers é um argumento de versão junto:

```hcl
resource "aws_ssm_parameter" "senha" {
  name = "/producao/banco/senha"
  type = "SecureString"

  value_wo         = ephemeral.aws_secretsmanager_secret_version.senha_banco.secret_string
  value_wo_version = 1
}
```

Pra atualizar o segredo, você incrementa o número da versão. Sem essa mudança, a ferramenta não gera diferença nenhuma, porque não enxerga o conteúdo.

## Onde Valores Efêmeros Podem Ser Usados

Essa é a parte que mais gera erro na adoção, e a lista é fechada. Um valor efêmero pode aparecer em:

- Outros recursos efêmeros
- Variáveis efêmeras
- Saídas efêmeras
- Locais
- Configuração de providers
- Provisionadores
- Blocos de conexão de recursos
- Atributos write-only

Qualquer uso fora desses contextos dá erro. Na prática, você não consegue jogar um valor efêmero num argumento comum de recurso, porque esse argumento seria persistido. A restrição é o próprio mecanismo de garantia.

## Saídas Efêmeras

Saída também pode ser efêmera, com uma limitação relevante: **só vale em módulo filho**.

```hcl
# modules/leitor-de-segredos/outputs.tf
output "credenciais" {
  value     = ephemeral.aws_secretsmanager_secret_version.senha_banco.secret_string
  ephemeral = true
}
```

A restrição faz sentido. Saída de módulo raiz é registrada no estado por definição, então deixar ela efêmera criaria contradição.

O padrão útil aqui é encapsular a obtenção de segredo num módulo dedicado, que expõe por saída efêmera pro módulo chamador consumir em provider ou atributo write-only.

## Um Fluxo Completo

Juntando as peças, o caminho de um segredo fica assim: um recurso efêmero busca a credencial no cofre, ela alimenta a configuração de um provider ou é gravada por um atributo write-only, e nada disso aparece no estado no final.

O contraste com o fluxo antigo é o ponto central. Antes, o mesmo segredo passaria por variável comum, seria usado num argumento normal e ficaria registrado em texto claro no arquivo de estado, esperando alguém encontrar.

## Cuidados

Três pontos antes de adotar.

**Depende do provider.** Recurso efêmero e atributo write-only precisam de suporte explícito no provider. O recurso da linguagem existe, mas sem o provider correspondente ele não se materializa.

**A versão precisa ser gerenciada.** O argumento de versão que acompanha atributo write-only vira responsabilidade sua. Esquecer de incrementar significa que o segredo novo simplesmente não é aplicado, sem erro aparente.

**Não substitui a criptografia do estado.** As duas coisas resolvem problema diferente. Valor efêmero evita que certo dado seja gravado; criptografia protege tudo que precisa ser gravado. O estado segue com identificador, configuração e atributo que descreve sua infraestrutura em detalhe.

## Conclusão

Por anos, a orientação sobre segredo em Infraestrutura como Código foi basicamente defensiva: restrinja acesso ao estado, criptografe o bucket, evite gravar o que der. Todas partiam da premissa de que o segredo ia acabar no arquivo de qualquer jeito.

Os valores efêmeros mudam essa premissa. A pergunta deixa de ser como proteger o que foi gravado e passa a ser o que realmente precisa ser gravado.

Essa é a diferença entre mitigar risco e eliminar. Um segredo que nunca chegou ao arquivo não vaza por ele, não precisa ser rotacionado por precaução quando alguém ganha acesso ao bucket e não aparece em backup antigo que ninguém lembra que existe. É proteção que não depende de ninguém acertar a configuração depois.
