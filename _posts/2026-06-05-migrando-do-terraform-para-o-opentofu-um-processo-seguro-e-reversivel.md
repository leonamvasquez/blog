---
title: "Migrando do Terraform para o OpenTofu: Um Processo Seguro e Reversível"
description: "O procedimento completo de migração do Terraform para o OpenTofu: preparação do estado, alinhamento de versões, ajustes de código, validação por plano limpo e o caminho de volta caso algo saia do esperado."
date: 2026-06-05 19:00:00 -0300
categories: [DevOps, IaC, OpenTofu]
tags: [OpenTofu, Terraform, Migração, State, IaC, DevOps]
icons: [opentofu]
---

## Introdução

Trocar o binário é a parte fácil da migração. O que costuma travar a decisão é o arquivo de estado.

A preocupação faz sentido. O estado guarda o registro de tudo que já foi provisionado, e um problema ali não vira só um pipeline vermelho, vira uma ferramenta propondo recriar recursos que estão rodando em produção.

A boa notícia é que existe um procedimento oficial, testado, com etapas bem definidas e um caminho de volta documentado. Ele é mais cuidadoso do que a maioria dos tutoriais sugere, e é justamente esse cuidado que deixa a operação segura.

Vamos percorrer esse procedimento do início ao fim, incluindo o que fazer quando algo não sai como esperado.

## O Princípio: Migrar por Versão Equivalente

Este é o ponto que quase todo tutorial informal erra, vale começar por ele.

A recomendação oficial não é instalar a versão mais nova do OpenTofu e rodar em cima do seu código. É migrar primeiro para a versão do OpenTofu equivalente à sua versão atual de Terraform, e só depois subir para a versão mais recente.

Se você está no Terraform 1.9.x, o caminho é migrar para o OpenTofu 1.9.0 e, com a migração concluída e validada, seguir o guia de atualização até a versão atual.

O motivo é simples. Cada guia de migração é escrito para um par específico de versões, porque as diferenças entre elas são conhecidas e documentadas. Pulando etapas, você mistura numa única operação duas fontes distintas de mudança: a troca de ferramenta e o salto de versão. Se algo quebrar, fica difícil saber qual das duas causou.

Tem ainda um detalhe de precisão: os guias pedem uma versão de patch específica do Terraform, não só a linha menor. Você precisa estar exatamente nessa versão antes de começar.

## O Que Acontece com o Estado

Antes do procedimento, vale entender o que muda no arquivo que gera toda a apreensão.

O OpenTofu lê o estado gerado pelo Terraform direto, sem conversão. O formato é o mesmo, e o campo que indica a versão do formato fica intocado.

O que muda é outro campo, o que registra qual ferramenta escreveu o estado pela última vez. Ele é atualizado quando o OpenTofu grava, o que só acontece no primeiro `apply`. Enquanto você roda apenas `init` e `plan`, nada é escrito.

Essa é a base da reversibilidade. Toda a etapa de validação acontece em modo leitura, e você decide seguir ou parar antes que qualquer alteração seja registrada.

## Passo 1: Plano de Recuperação e Backup

O procedimento oficial abre com uma recomendação que não é burocracia: tenha um plano de recuperação de desastres atualizado e testado.

Na prática, isso são duas coisas.

Se o estado é local, copie o arquivo:

```bash
cp terraform.tfstate terraform.tfstate.backup-pre-migracao
```

Se o estado está num backend remoto, siga o procedimento de backup do próprio backend e, sobretudo, **rode o procedimento de restauração pelo menos uma vez**. Backup nunca testado não é backup, é suposição.

Versione também o código, porque a migração vai pedir pequenas alterações nele.

## Passo 2: Zerar as Mudanças Pendentes

Aplique tudo que estiver pendente usando o Terraform, antes de encostar no OpenTofu:

```bash
terraform apply
```

O objetivo é chegar a um estado limpo, em que o plano não proponha nenhuma alteração. Essa é sua linha de base.

O motivo é de método. Migrando com mudança pendente, você não consegue distinguir o que o OpenTofu propôs por diferença de comportamento do que já estava pendente antes. Sem linha de base, não há comparação válida.

## Passo 3: Alinhar a Versão do Terraform

Confira sua versão atual e ajuste para a exigida pelo guia correspondente:

```bash
terraform version
```

Se estiver abaixo da versão de patch indicada, atualize o Terraform primeiro. Se estiver acima de todas as versões cobertas pelos guias existentes, o caminho recomendado é esperar a publicação do guia adequado, em vez de improvisar.

## Passo 4: Ajustes de Código

Aqui estão as mudanças que a migração pede. Variam conforme a versão de origem, e as mais comuns são:

- **Backend S3.** Se você usa a opção de pular a verificação de checksum, tire-a. O OpenTofu não precisa dela.
- **Endpoints e SSO.** Se você define endpoints personalizados por essa via ou pela variável de ambiente correspondente, remova a configuração e valide se o comportamento se mantém.
- **Bloco `removed`.** O comportamento difere do equivalente no Terraform. Revise a documentação e ajuste, tirando o bloco de ciclo de vida associado.
- **Testes nativos.** Se você usa a funcionalidade de teste com sobrescrita de recurso ou dado dentro de um provider simulado, vai precisar reestruturar esses testes.

Consulte o guia da sua versão específica, porque a lista completa depende dela. Trate esta seção como lembrete do tipo de ajuste esperado, não como inventário definitivo.

## Passo 5: Inicializar e Comparar

Agora sim, o OpenTofu entra em cena:

```bash
tofu init
tofu plan
```

O resultado esperado do plano é nenhuma alteração. Se aparecer mudança inesperada, não siga adiante. A orientação oficial é clara nesse ponto: falhando qualquer etapa, volte para o Terraform e investigue antes de continuar.

Vale registrar o plano em arquivo para comparar depois:

```bash
terraform plan -no-color > plano-terraform.txt
tofu plan -no-color > plano-tofu.txt
diff plano-terraform.txt plano-tofu.txt
```

Diferença de formatação é normal. Recurso marcado para criação, alteração ou destruição, não.

## Passo 6: Aplicar e Só Então Atualizar

Com o plano limpo, aplique:

```bash
tofu apply
```

É nesse momento que o estado passa a registrar o OpenTofu como ferramenta gravadora.

Em seguida, faça uma alteração pequena e sem criticidade, tipo adicionar uma tag num recurso, e aplique de novo. Isso confirma que a ferramenta consegue gerenciar sua infraestrutura daqui pra frente, não só ler o que já existe.

Concluída a validação, aí sim atualize o OpenTofu para a versão mais recente, seguindo o guia de atualização do próprio projeto. Essa ordem importa.

## Como Reverter

A reversão é procedimento documentado, não improviso. Se algo sair do esperado:

1. **Pare de usar o OpenTofu imediatamente.** Não tente corrigir com mais comandos.
2. **Faça outro backup** do estado atual e do código.
3. **Desfaça as alterações de código** feitas no Passo 4.
4. **Rode `terraform init`** e, em seguida, `terraform plan`.
5. **Confirme que nenhuma mudança inesperada aparece** no plano.
6. **Execute `terraform apply`** e verifique que roda sem alterações.
7. **Teste com uma mudança pequena** e sem criticidade, para confirmar que o fluxo voltou ao normal.

Se a causa parecer defeito da ferramenta, o projeto pede que o problema seja reportado no repositório. Isso ajuda quem vier depois.

## Erros Comuns

Dois problemas concentram a maior parte dos relatos.

**Provider indisponível no registry.** A mensagem indica falha ao consultar os pacotes de provider disponíveis. Significa que um provider declarado na sua configuração não existe no registry do OpenTofu. A orientação é voltar para o Terraform e revisar essa dependência.

**Falha ao carregar o schema do provider.** Acontece quando o estado ainda não foi gravado pelo OpenTofu e a configuração declara a origem do provider com o nome completo do registry do Terraform. A correção é simplificar a declaração, usando só a organização e o nome do provider, sem o prefixo do registry.

## Migração Gradual

Uma última recomendação de método: não migre tudo de uma vez.

Comece pelo repositório menos crítico, de preferência um ambiente de desenvolvimento com poucos recursos. Percorra o procedimento inteiro, incluindo o teste da reversão. A cada repositório seguinte, o processo fica mais rápido, porque os ajustes de código específicos da sua organização já são conhecidos.

Essa cadência transforma uma migração arriscada numa sequência de operações previsíveis.

## Conclusão

Vale separar duas perguntas que costumam se confundir nessa discussão. Uma é se a migração é tecnicamente viável. A outra é se ela deve ser feita.

A primeira está respondida. O procedimento existe, é oficial, tem etapas definidas e um caminho de volta documentado. Toda a fase de validação acontece em modo leitura, e o estado só é escrito quando você decide seguir adiante. O risco não está na ferramenta, está em pular etapas: migrar com mudança pendente, saltar versão ou tratar o backup como formalidade.

A segunda pergunta é sua, e não tem resposta única. Depende do modelo de negócio da sua empresa, das funcionalidades de que você depende hoje e do peso que previsibilidade de licenciamento tem no seu planejamento de médio prazo.

O que um procedimento bem definido faz é tirar o medo da equação. Enquanto a migração parece um salto no escuro, a conversa fica presa em impressão e preferência. Quando ela vira uma sequência conhecida e reversível, a escolha entre as duas ferramentas deixa de ser aposta e passa a ser comparação. E comparação se resolve com critério.
