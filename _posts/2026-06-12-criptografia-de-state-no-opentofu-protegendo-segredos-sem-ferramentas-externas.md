---
title: "Criptografia de State no OpenTofu: Protegendo Segredos sem Ferramentas Externas"
description: "Como funciona a criptografia nativa de state e plano no OpenTofu: a anatomia do bloco encryption, os key providers disponíveis, a migração de um estado existente e os cuidados com rotação de chaves."
date: 2026-06-12 19:00:00 -0300
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, State, Segurança, DevSecOps, Criptografia, IaC]
icons: [opentofu]
---

## Introdução

Crie um banco de dados com Terraform, defina a senha por variável e depois abra o arquivo de estado, e lá estará a senha, completamente hardcoded, junto com todo o resto que a ferramenta sabe sobre sua infraestrutura.

Isso não é um problema de certa forma. Para comparar o que existe com o que foi declarado, a ferramenta precisa guardar os valores que aplicou de fato. O problema é que praticamente ninguém trata esse arquivo com o cuidado que ele pede.

A resposta de sempre é criptografar o bucket onde o estado fica. Ajuda, mas cobre só parte do problema, e entender essa diferença é o ponto de partida para a sua infra ficar minimamente segura.

O OpenTofu foi por outro caminho, e essa é hoje a funcionalidade que mais o distingue do Terraform: a criptografia acontece dentro da própria ferramenta, antes de o dado sair da sua máquina.

## Por que Criptografar o Bucket não Basta

Ao habilitar criptografia do lado do servidor num bucket, o provedor cifra o arquivo ao gravar em disco e decifra ao entregar. Existe proteção, mas com escopo definido: cobre o dado em repouso na infraestrutura do provedor.

Fora desse escopo ficam várias exposições:

- Qualquer pessoa com permissão de leitura no bucket recebe o arquivo já decifrado.
- O estado trafega e é manipulado em texto claro na sua estação de trabalho e no runner de CI.
- Cópia local, arquivo de plano e backup automático guardam o mesmo conteúdo legível.
- Vazamento de credencial de acesso ao bucket entrega todo o conteúdo, já que a decifragem é transparente para quem tem permissão.

A criptografia nativa muda o ponto onde o dado é cifrado. Sai da ferramenta já protegido, e o backend nunca vê o conteúdo em texto claro. Sem a chave, o arquivo não serve pra nada, mesmo para quem consegue baixá-lo.

## A Anatomia do Bloco encryption

A configuração fica dentro do bloco `terraform`, num bloco `encryption` próprio, com três elementos.

O **key provider** define de onde vem a chave. O **method** define o algoritmo que usa essa chave. Os blocos `state` e `plan` conectam o método ao que você quer proteger.

O exemplo mínimo, usando derivação por senha:

```hcl
variable "passphrase" {
  type      = string
  sensitive = true
}

terraform {
  encryption {
    key_provider "pbkdf2" "chave_principal" {
      passphrase = var.passphrase
    }

    method "aes_gcm" "metodo_padrao" {
      keys = key_provider.pbkdf2.chave_principal
    }

    state {
      method = method.aes_gcm.metodo_padrao
    }
  }
}
```

Tem um requisito prático a respeitar: a senha precisa de no mínimo 16 caracteres.

## Os Key Providers Disponíveis

A escolha do provedor de chave define o modelo operacional de segurança. As opções vão do uso local até serviço gerenciado:

- **PBKDF2.** Deriva a chave de uma senha, localmente. É o mais simples de configurar e não depende de serviço externo.
- **AWS KMS**, **GCP KMS** e **Azure Key Vault.** Delegam a gestão da chave ao serviço gerenciado do provedor.
- **OpenBao.** Integração com o cofre de segredos de código aberto.
- **External.** Permite pegar a chave de um programa externo, para caso não coberto pelos anteriores.

Para produção, serviço gerenciado é preferível, sobretudo pela rotação automática. A configuração com KMS segue a mesma estrutura:

```hcl
terraform {
  encryption {
    key_provider "aws_kms" "chave_prod" {
      kms_key_id = "arn:aws:kms:us-east-1:111122223333:key/abcd-1234"
      key_spec   = "AES_256"
      region     = "us-east-1"
    }

    method "aes_gcm" "metodo_prod" {
      keys = key_provider.aws_kms.chave_prod
    }

    state {
      method   = method.aes_gcm.metodo_prod
      enforced = true
    }
  }
}
```

O atributo `enforced` merece destaque. Ativo, ele faz o OpenTofu recusar gravar ou ler dado não criptografado, o que elimina a chance de alguém desabilitar a proteção por engano.

## Migrando um Estado Existente

Aqui fica a parte que mais gera dúvida. Se seu estado já existe e está em texto claro, a ferramenta não consegue simplesmente passar a decifrá-lo, porque não há nada cifrado ali.

O mecanismo que resolve isso é o bloco `fallback`, que funciona como segundo método de leitura. Se o método principal falhar, o OpenTofu tenta o alternativo.

A migração se declara assim:

```hcl
terraform {
  encryption {
    method "unencrypted" "migracao" {}

    key_provider "pbkdf2" "chave_principal" {
      passphrase = var.passphrase
    }

    method "aes_gcm" "metodo_padrao" {
      keys = key_provider.pbkdf2.chave_principal
    }

    state {
      method = method.aes_gcm.metodo_padrao

      fallback {
        method = method.unencrypted.migracao
      }
    }
  }
}
```

A leitura passa pelo método alternativo, que interpreta o arquivo como texto claro. A gravação passa pelo método principal, já cifrada. Um único comando faz a transição:

```bash
tofu apply
```

Concluída a migração, tire o bloco `fallback` e o método não criptografado, e considere ligar o `enforced`. Enquanto o fallback existir, a ferramenta segue aceitando estado em texto claro.

Para confirmar o resultado, baixe o arquivo do backend e olhe o formato. Ele deve deixar de ser um JSON legível.

## Protegendo Também o Plano

Um detalhe que passa batido: o arquivo de plano carrega os mesmos valores sensíveis do estado, porque descreve exatamente o que vai ser aplicado.

Se você salva plano em arquivo, comum em pipeline que separa validação de aplicação, proteja com a mesma configuração:

```hcl
    plan {
      method   = method.aes_gcm.metodo_padrao
      enforced = true
    }
```

Existe ainda o bloco `remote_state_data_sources`, para quando uma configuração lê o estado cifrado de outra. Sem ele, a leitura entre projetos falha.

## O Caminho de Volta

A reversão usa o mesmo mecanismo, invertido. Você declara o método não criptografado como principal e o cifrado como alternativo:

```hcl
    state {
      method   = method.unencrypted.migracao
      enforced = false

      fallback {
        method = method.aes_gcm.metodo_padrao
      }
    }
```

A leitura decifra, a gravação sai em texto claro. A mesma técnica serve para trocar de key provider: reverta para texto claro e cifre de novo com a chave nova, ou aponte o fallback para o provedor antigo enquanto o principal já usa o novo.

Saber que existe caminho de volta é o que torna razoável adotar criptografia em ambiente que já está em produção.

## Rotação e o Problema da Saturação de Chave

Este é o alerta técnico que a documentação faz e que raramente aparece em tutorial.

O algoritmo usado é seguro e padrão de indústria, mas sofre de saturação de chave: uso prolongado da mesma chave estática degrada a proteção com o tempo.

Duas estratégias resolvem isso:

- Usar provedor baseado em derivação, com senha longa e complexa.
- Usar serviço gerenciado de chaves com rotação automática configurada.

Chave curta e estática é o pior cenário. Dá sensação de proteção sem entregar de fato.

## Cuidados Operacionais

Três pontos que merecem decisão consciente antes da adoção.

**Perder a chave é perder o estado.** Não existe recuperação. O procedimento de backup precisa incluir a chave, não só o arquivo cifrado.

**A senha não pode morar no código.** A configuração pode vir de variável de ambiente própria, o que mantém a senha fora do repositório e permite reusar a mesma definição entre ambientes.

**A equipe inteira precisa da chave.** Todo mundo que roda a ferramenta, incluindo o runner de CI, precisa de acesso. Isso vira a distribuição da chave um problema de gestão de segredos, que agora você precisa resolver.

## Conclusão

A criptografia nativa do estado corrige uma incoerência antiga da Infraestrutura como Código. Passamos anos tratando o estado como arquivo de configuração, quando ele sempre foi um repositório de secrets.

O ganho genuíno é o deslocamento da fronteira de confiança. Você deixa de confiar no backend, nas permissões do bucket e em quem tem acesso a eles, e passa a confiar só em quem detém a chave. É superfície menor e mais fácil de auditar.

O custo também é real, e vale dizer com clareza: você troca um problema por outro. Sai o estado legível e entra a responsabilidade de gerir, distribuir e rotacionar uma chave da qual todo seu histórico de infraestrutura depende. É uma troca vantajosa, mas só quando essa gestão é feita com o mesmo rigor que a proteção do próprio estado exigia.
