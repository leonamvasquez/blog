---
title: "Distribuindo Módulos OpenTofu como Artefatos OCI"
description: "Como usar registries OCI para distribuir módulos e providers no OpenTofu: a nova origem oci://, o espelho de providers, autenticação no registry e quando essa abordagem compensa."
date: 2026-07-03 19:00:00 -0300
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, OCI, Módulos, Registry, Supply Chain, IaC]
icons: [opentofu]
---

## Introdução

Pergunte pra qualquer time onde ficam os módulos de infraestrutura e a resposta quase sempre é a mesma: num repositório Git, referenciado por uma tag.

É padrão tão comum que raramente alguém questiona. E funciona, até você precisar rodar a ferramenta num ambiente sem acesso à internet pública, ou explicar por que o runner de CI precisa de chave SSH com leitura em vários repositórios.

O OpenTofu 1.10 abriu outro caminho, e aproveita infraestrutura que a maioria das organizações já mantém: o registry de containers.

## O Incômodo do Git como Registry

Vale nomear o problema antes da solução, porque nem todo time sente essas dores no mesmo grau.

Usar Git como mecanismo de distribuição traz fricções conhecidas:

- **Autenticação.** Cada runner precisa de credencial com leitura nos repositórios de módulo, o que costuma virar chave SSH espalhada por pipeline.
- **Tag é mutável.** Nada impede alguém de mover uma tag pra outro commit. A versão que você testou pode não ser a versão que aplicou.
- **Ambiente isolado.** Em rede sem saída pra internet, replicar repositório Git é trabalho extra.
- **Procedência.** Não existe mecanismo padrão de assinatura e verificação integrado ao fluxo.

Nenhuma dessas fricções é impeditiva sozinha. Juntas, porém, explicam por que organização grande acaba construindo camada própria de distribuição.

## O Que Muda com OCI

A sigla OCI vem de Open Container Initiative, o padrão por trás das imagens de container. O ponto central é que registry OCI não guarda só imagem: guarda artefato genérico, e módulo de infraestrutura pode ser um deles.

A vantagem prática é que você já tem essa infraestrutura. ECR, Harbor, GHCR, ACR, GCR ou qualquer registry compatível com a versão 1.1.0 do protocolo de distribuição serve, com controle de acesso, replicação e auditoria já configurados.

Existe uma assimetria importante entre os dois casos de uso, e ela costuma ser mal entendida:

- **Para módulo**, o registry OCI é **origem primária**. Você referencia o módulo direto por ele.
- **Para provider**, o registry OCI é só **espelho**. A origem declarada segue sendo o endereço tradicional, e a instalação é redirecionada por configuração.

## Módulos: a Origem oci://

Do lado dos módulos, a mudança é um tipo novo de endereço de origem:

```hcl
module "vpc" {
  source = "oci://example.com/modules/vpc/aws"

  name = "producao"
  cidr = "10.0.0.0/16"
}
```

O endereço identifica o domínio do registry, o nome do repositório e a versão desejada, que pode vir por tag ou pelo digest do manifesto.

Usar digest é o que resolve a mutabilidade mencionada acima. Tag pode ser reapontada; digest é o resumo criptográfico do conteúdo, e apontar pra ele significa apontar pra exatamente aquele artefato, sempre.

Pra ambiente com requisito rígido de reprodutibilidade, essa é a diferença que mais pesa frente ao fluxo baseado em Git.

## Providers: Só Espelho

Do lado dos providers, o modelo é outro. A configuração não fica no código da infraestrutura, e sim na configuração da própria ferramenta:

```hcl
# ~/.tofurc
provider_installation {
  oci_mirror {
    repository_template = "example.com/opentofu-providers/${namespace}/${type}"
    include             = ["registry.opentofu.org/*/*"]
  }
}
```

O modelo de resolução funciona assim: o endereço de origem do provider é quebrado em partes, e essas partes preenchem o template pra formar o endereço do repositório no registry.

Um provider declarado como `hashicorp/tls` corresponde ao endereço completo no registry oficial, o que satisfaz a regra acima. Ele passa então a ser instalado do repositório correspondente no seu registry, com `hashicorp` de namespace e `tls` de tipo.

Pra restringir o espelho a um conjunto específico e manter o resto vindo da origem tradicional, combine com a exclusão correspondente:

```hcl
provider_installation {
  oci_mirror {
    repository_template = "registry.example.com/providers/${namespace}/${type}"
    include             = ["registry.example.com/minhaorg/*"]
  }

  direct {
    exclude = ["registry.example.com/minhaorg/*"]
  }
}
```

O código da infraestrutura fica intocado. Quem clona o repositório sem essa configuração continua baixando os providers da origem padrão, o que mantém a portabilidade.

## Autenticação

Este é o ponto onde a integração se paga. A ferramenta reaproveita a credencial que você já usa pro registry.

Existem dois caminhos. O primeiro é a descoberta automática de credencial no formato usado pelas ferramentas de container, o que significa que uma sessão já autenticada costuma bastar. O segundo é declaração explícita na configuração da ferramenta, pra caso em que você quer controlar qual credencial vale em qual registry.

Em pipeline, isso normalmente elimina um passo inteiro. O runner já autentica no registry pra outras finalidades, e essa mesma autenticação serve pra instalação de módulos e providers.

## Publicando um Módulo

A publicação usa o ferramental padrão do ecossistema OCI, tipicamente a ferramenta de linha de comando pra artefato genérico:

```bash
# Empacota o módulo
zip -r vpc-modulo.zip ./modules/vpc

# Publica no registry como artefato
oras push example.com/modules/vpc/aws:v1.4.0 vpc-modulo.zip
```

O artefato precisa seguir o formato esperado pela ferramenta, incluindo o tipo de mídia correto no manifesto. Consulte a documentação sobre pacote de módulo em registry OCI antes de montar seu pipeline de publicação, porque é esse detalhe que decide se a ferramenta reconhece o artefato.

Uma vez o pipeline funcionando, publicar módulo vira só mais um passo de build, equivalente a publicar imagem.

## Quando Isso Compensa

Sendo direto, essa abordagem não é pra todo mundo.

**Faz sentido quando:**

- Você opera em ambiente isolado da internet e já replica o registry de containers.
- A organização tem requisito de procedência e quer assinar e verificar artefato de infraestrutura como faz com imagem.
- Existe volume grande de módulo interno e a gestão de acesso via Git virou problema.
- Você quer imutabilidade real de versão, com referência por digest.

**Não faz sentido quando:**

- O time é pequeno, os módulos são poucos e o fluxo com Git resolve.
- Não existe registry OCI em operação, porque introduzir um só pra isso soma mais complexidade do que remove.

Uma observação de método: mesmo quando faz sentido, migre aos poucos. Comece publicando um módulo estável e de uso amplo, valide o fluxo completo de publicação e consumo, e só depois mova o resto.

## Conclusão

O que essa integração faz, no fundo, é parar de tratar infraestrutura como caso especial.

Imagem de container tem registry, versionamento por digest, controle de acesso, replicação, assinatura e verificação. Módulo de infraestrutura, historicamente, tinha um repositório Git e uma convenção de tag. Duas categorias de artefato com necessidade quase idêntica, resolvidas de jeitos bem diferentes.

Aproximar as duas significa que investimento feito na cadeia de suprimentos de software passa a valer também pra infraestrutura, sem ferramental paralelo. Pra organização que leva procedência a sério, esse é ganho maior que a simples conveniência de reaproveitar um registry já existente.
