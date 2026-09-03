---
title: "Como o OpenTofu Funciona: Arquitetura, Comandos e Compatibilidade com o Terraform"
description: "Entenda a arquitetura interna do OpenTofu, o fluxo de execução dos comandos tofu init, plan e apply, e o mapa preciso do que é idêntico, do que exige atenção e do que existe apenas em um dos projetos."
date: 2026-05-22 19:00:00 -0300
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, Terraform, IaC, Providers, State, DevOps]
icons: [opentofu]
---

## Introdução

Este artigo tem como foco o funcionamento interno do OpenTofu: como a ferramenta está organizada por dentro, o que acontece a cada comando executado e até onde vai a compatibilidade com o Terraform.

A proposta é partir do funcionamento e só depois chegar às comparações. A ideia é entender como a ferramenta opera, para decidir com base nisso, e não em opiniões de terceiros. O pano de fundo histórico do projeto ficou no artigo anterior da série, [OpenTofu: O que o Fork do Terraform Significa para a Sua Infraestrutura](https://leonam.io/posts/opentofu-o-que-o-fork-do-terraform-significa-para-sua-infraestrutura/).

## O Que é o OpenTofu

O OpenTofu é uma ferramenta de Infraestrutura como Código. Você descreve como quer que a infraestrutura esteja ao final do processo em arquivos de configuração e a ferramenta cuida de levar o ambiente real até esse ponto. O projeto é mantido pela Linux Foundation, sob a licença de código aberto MPL 2.0.

O modelo é declarativo. Você não escreve o passo a passo para criar um servidor, apenas declara que ele deve existir, com certas características. Calcular o que precisa acontecer para a realidade bater com essa descrição fica por conta da ferramenta.

Três elementos sustentam esse funcionamento:

- **A linguagem.** HCL, onde você declara o que deve existir.
- **O estado.** Registro do que a ferramenta já provisionou e já conhece.
- **O motor.** Compara configuração com estado, calcula a diferença e aplica na ordem certa.
Quem já mexe com Terraform reconhece essa descrição na hora, e a razão é simples: o OpenTofu veio do próprio código do Terraform em 2023 e manteve suas bases técnicas. Saber onde essa herança começa e onde ela para é o que permite operar a ferramenta com segurança.

## A Arquitetura: Core e Providers

O OpenTofu herdou por completo o modelo de arquitetura do Terraform, o que explica boa parte da compatibilidade que se vê na prática. O sistema se divide em duas camadas, cada uma com sua responsabilidade.

O **Core** é o binário principal, escrito em Go. Não conhece nada de nuvens específicas. Cabe a ele:

- Interpretar a configuração escrita em HCL.
- Montar o grafo de dependências entre os recursos declarados.
- Comparar o estado desejado com o estado registrado e calcular o plano de execução.
- Cuidar do arquivo de estado e do backend onde ele fica salvo.
Os **providers** são os plugins que conhecem cada API específica: AWS, Azure, Google Cloud, Kubernetes. Rodam como processos separados e falam com o Core por um protocolo baseado em gRPC.

Essa separação explica por que o mesmo binário de provider atende aos dois projetos. O provider não distingue se está falando com Terraform ou OpenTofu, porque o contrato entre as camadas não mudou. Para quem quiser se aprofundar nesse mecanismo, o assunto está detalhado em [Estendendo o Terraform: Entendendo como um Provider Funciona](https://leonam.io/posts/estendendo-terraform-como-provider-funciona-quando-criar-o-seu/).

## O Fluxo de Execução

Os três comandos centrais seguem exatamente a mesma sequência de operações do Terraform. Vale acompanhar de perto, porque é ali que aparecem os poucos pontos de divergência.

```bash
tofu init
tofu plan
tofu apply
```

**Na inicialização**, o OpenTofu lê o bloco `required_providers`, resolve as versões compatíveis, baixa os binários dos providers e grava as escolhas no arquivo de lock. Também configura o backend remoto e prepara o diretório de trabalho local.

**No planejamento**, o Core carrega o estado atual, pergunta aos providers a situação real de cada recurso, compara com o que a configuração declara e monta o plano. Nada é executado nessa etapa.

**Na aplicação**, o plano é percorrido respeitando a ordem do grafo de dependências, e o estado é atualizado ao fim de cada operação bem-sucedida.

O modelo mental é o mesmo do Terraform. Quem já opera IaC não precisa aprender nada novo para começar.

## Compatibilidade: O Que É Idêntico

Aqui está o núcleo da questão prática. Estes elementos funcionam sem alteração nenhuma:

1. **A linguagem HCL.** Blocos, expressões, funções e meta-argumentos são os mesmos. O bloco de configuração até continua se chamando `terraform`, o que preserva a compatibilidade do código já existente.
2. **A estrutura de arquivos.** O diretório de trabalho segue sendo `.terraform`, o estado local segue em `terraform.tfstate` e o arquivo de lock segue em `.terraform.lock.hcl`.
3. **O formato do estado.** Um estado gerado pelo Terraform é lido pelo OpenTofu, e o caminho inverso também funciona em configurações padrão.
4. **Os backends remotos.** S3, Azure Blob, GCS e os demais operam com a mesma configuração de sempre.
5. **Os módulos.** Módulos publicados para Terraform funcionam sem qualquer adaptação, incluindo os do registry público.
6. **Os providers.** Os mesmos binários atendem aos dois projetos.
Na prática, uma configuração escrita há três anos roda no OpenTofu sem tocar em uma linha. Essa compatibilidade não é promessa de marketing: é consequência direta de o projeto ter nascido do próprio código do Terraform.

## Compatibilidade: O Que Exige Atenção

### O registry de providers

O OpenTofu mantém registry próprio, e é dali que os providers são baixados por padrão. O provider continua o mesmo; o que muda é o endereço de origem.

Esse detalhe aparece no arquivo de lock, que passa a registrar a nova origem:

```hcl
# .terraform.lock.hcl após tofu init
provider "registry.opentofu.org/hashicorp/aws" {
  version     = "5.40.0"
  constraints = "~> 5.0"
  hashes      = [
    "h1:...",
    "zh:...",
  ]
}
```

Como os hashes registrados dizem respeito ao pacote obtido, um arquivo de lock gerado pelo Terraform pode falhar na verificação ao ser usado com o OpenTofu. A correção é simples: regenerar o lock com `tofu init` e versionar o resultado.

Em pipelines que rodam em plataformas diferentes da estação de trabalho, vale gerar os hashes para todos os alvos de uma vez só:

```bash
tofu providers lock \
  -platform=linux_amd64 \
  -platform=darwin_arm64
```

### O marcador de versão no estado

No primeiro `apply` rodado com o OpenTofu, o campo que registra a versão da ferramenta no arquivo de estado é atualizado. É o único registro que muda numa configuração padrão, e isso não trava a leitura do estado por nenhuma das duas ferramentas.

Mesmo assim, trate como alteração real: faça backup do estado antes de qualquer migração, como faria antes de qualquer operação que o modifique.

### Versões de protocolo e recursos recentes

Providers muito recentes podem adotar recursos de protocolo que apareceram primeiro em uma das duas ferramentas. Configurações que usam recursos de linguagem lançados só em versões novas do Terraform também pedem checagem individual.

A regra prática é simples: quanto mais recente e específico o recurso usado, maior a necessidade de validar antes de migrar.

## O Que Existe Apenas no OpenTofu

Desde 2024 o projeto vem entregando recursos sem equivalente no Terraform de código aberto. Um resumo dos principais:

- **Criptografia nativa do estado**, que dispensa ferramenta externa para proteger dado sensível em repouso.
- **Avaliação antecipada de variáveis**, que permite parametrizar a configuração de backend e a origem de módulos.
- **Iteração em providers** com `for_each`, útil em cenários multi-região e multi-conta.
- **Distribuição via registries OCI**, no mesmo padrão usado por imagens de container.
- **Valores efêmeros**, que não ficam persistidos no arquivo de estado.
Um detalhe de convivência vale registro: o OpenTofu reconhece arquivos com extensão `.tofu`, que têm precedência sobre o arquivo `.tf` equivalente. Isso permite manter uma configuração comum às duas ferramentas e isolar, em arquivos separados, o código que usa recursos exclusivos.

Cada um desses recursos merece tratamento próprio e será tema de artigos específicos nesta série.

## Verificando a Compatibilidade na Prática

A forma certa de avaliar compatibilidade não é ler tabela, é medir no seu próprio código. O procedimento é curto:

```bash
# 1. Preserve o estado atual antes de qualquer coisa
terraform state pull > backup-estado.json

# 2. Registre o plano gerado pela ferramenta atual
terraform plan -no-color > plano-terraform.txt

# 3. Inicialize com o OpenTofu e gere o plano equivalente
tofu init
tofu plan -no-color > plano-tofu.txt

# 4. Compare os dois planos
diff plano-terraform.txt plano-tofu.txt
```

O esperado é não ver diferença relevante em termos de recursos criados, alterados ou destruídos. Diferença de formatação de saída é normal. Recurso marcado para recriação, não.

Esse teste leva poucos minutos e troca qualquer suposição por evidência sobre a sua própria base de código.

## Conclusão

O OpenTofu funciona como o Terraform porque veio dele e manteve as fronteiras que importam: a linguagem, o formato do estado e o contrato com os providers. As divergências existem, são poucas e conhecidas, e se concentram no registry, no arquivo de lock e nos recursos criados depois da bifurcação.

Vale registrar uma implicação prática disso: como Core e providers seguem um contrato estável, o binário que executa o plano virou peça substituível da sua plataforma. Quem já mantém essa separação consegue avaliar as duas ferramentas em paralelo, com custo baixo de reversão.
