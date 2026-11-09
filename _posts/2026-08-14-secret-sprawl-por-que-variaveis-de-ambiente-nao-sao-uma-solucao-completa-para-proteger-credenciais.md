---
title: "Secret Sprawl: Por que Variáveis de Ambiente não são uma Solução Completa para Proteger Credenciais"
description: "Entenda o que as variáveis de ambiente resolvem de fato, onde elas param, e quais três atributos faltam para que uma credencial seja realmente gerenciada: expiração, escopo e auditoria."
date: 2026-08-14 19:00:00 -0300
categories: [DevSecOps, Segurança, Vault]
tags: [Secrets, DevSecOps, Vault, Segurança, 12-Factor, DevOps]
icons: [vault]
---

## Introdução

Tirar a senha do código e colocá-la em uma variável de ambiente é um progresso real. Ela sai do histórico do Git, deixa de aparecer em revisões de código e passa a variar por ambiente sem que o código mude.

Essa prática consolidou-se por bons motivos, e a recomendação de separar configuração de código continua válida.

O problema é que a maioria das equipes trata esse passo como solução final. A credencial saiu do repositório, logo está protegida. Na prática, ela apenas mudou de lugar, e o lugar novo tem propriedades que raramente são examinadas.

## O Que a Variável Resolve

Vale ser justo com o mecanismo antes de criticá-lo, porque ele resolve coisas concretas.

A variável de ambiente separa o valor do código. Permite que a mesma imagem ou o mesmo artefato rode em ambientes diferentes. Evita o pior dos cenários, que é a credencial versionada e distribuída para todo mundo que clona o repositório.

Nada disso é pouco. O ponto deste artigo não é que a prática esteja errada, e sim que ela cobre apenas a primeira camada de um problema com várias.

## Onde Ela Para

As exposições que permanecem costumam surpreender quem nunca parou para listá-las.

**Processos filhos herdam tudo.** Qualquer processo lançado a partir do seu herda o ambiente inteiro. Um script auxiliar, uma ferramenta de build, uma biblioteca que executa um comando externo: todos recebem a credencial, mesmo que não tenham nada a ver com ela.

**O ambiente é legível no sistema.** Em sistemas Linux, o ambiente de um processo fica acessível através do sistema de arquivos virtual. O acesso é restrito ao dono do processo e ao usuário administrador, o que já é uma proteção, mas significa que qualquer coisa rodando com essa identidade enxerga o valor.

**Ferramentas de inspeção mostram tudo.** O comando que inspeciona um container exibe as variáveis definidas. A especificação de um pod em um orquestrador também. Quem tem permissão para listar esses objetos tem a credencial.

**Logs e falhas vazam ambiente.** Rastreamentos de pilha, relatórios de erro e saídas de depuração frequentemente despejam o ambiente completo. Basta uma biblioteca com log verboso para que a credencial apareça em um sistema de observabilidade que muito mais gente acessa.

**O escopo é o processo inteiro.** Não existe granularidade. Se a aplicação precisa de uma credencial para uma operação específica, essa credencial fica visível durante toda a execução, para todo o código, incluindo as dependências de terceiros que você não escreveu.

## O Termo: Secret Sprawl

A soma dessas características produz o fenômeno que dá nome ao artigo.

O **secret sprawl** é a dispersão descontrolada de credenciais. A mesma senha acaba replicada na configuração do CI, no gerenciador de segredos do orquestrador, no arquivo local de um desenvolvedor, em uma anotação de documentação interna e em uma conversa antiga de chat.

Nenhuma dessas cópias é registrada em lugar nenhum. Quando chega o momento de rotacionar a credencial, a pergunta que trava tudo é simples e sem resposta: onde ela está em uso?

O resultado típico é a rotação que não acontece. A equipe sabe que deveria trocar, não sabe o que vai quebrar, e a credencial permanece válida indefinidamente.

## Os Três Atributos que Faltam

Para enxergar o problema com clareza, ajuda compará-lo com o que uma credencial bem gerenciada oferece.

**Expiração.** Uma variável de ambiente não tem prazo. O valor vale até alguém decidir trocá-lo, o que depende de disciplina humana em vez de mecanismo. Uma credencial com validade curta transforma vazamento em problema temporário.

**Escopo.** O valor na variável é o mesmo para todos os usos. Não há como conceder permissão de leitura para um caminho e de escrita para outro, nem restringir por operação. A credencial carrega todo o poder que ela tem, sempre.

**Auditoria.** Não existe registro de quem leu a variável, quando, ou para quê. Após um incidente, não há como determinar se a credencial foi efetivamente usada de forma indevida ou apenas exposta.

Essa tríade é um critério útil. Quando faltam os três, você tem um valor guardado, não uma credencial gerenciada.

## O Que Vem Depois

A resposta madura para isso não é guardar o mesmo valor em um lugar melhor, e sim mudar a natureza da credencial.

Três movimentos, em ordem de maturidade:

1. **Centralizar.** Um cofre de segredos passa a ser a fonte única, com controle de acesso e registro de leitura. O segredo ainda é estático, mas ao menos existe uma resposta para onde ele está.
2. **Tornar dinâmico.** Em vez de guardar uma senha, o sistema gera uma credencial sob demanda, com validade curta e vinculada a quem pediu. Rotação deixa de ser uma tarefa e passa a ser o comportamento padrão.
3. **Eliminar o segredo.** A carga de trabalho prova sua identidade por outro meio e troca essa prova por acesso temporário. Não existe valor para guardar, vazar ou rotacionar.

Esse terceiro estágio já apareceu aqui em dois contextos diferentes. Do lado da execução de infraestrutura, em [Autenticação Dinâmica Multi-Conta: O Fim das Credenciais Estáticas no Terragrunt](/posts/autenticacao-dinamica-multi-conta-o-fim-das-credenciais-estaticas-no-terragrunt/). Do lado do estado, em [Valores Efêmeros: Como o OpenTofu Trata Segredos que Não Vão para o State](/posts/valores-efemeros-como-o-opentofu-trata-segredos-que-nao-vao-para-o-state/).

O princípio é o mesmo nos dois casos, e será o fio condutor dos próximos artigos desta série.

## Quando a Variável Ainda Serve

Sendo honesto, ela continua tendo lugar.

Para desenvolvimento local, com credenciais de brinquedo apontando para serviços de teste, a complexidade adicional raramente se justifica. Para configuração que não é sensível, como região, nível de log ou nome do ambiente, a variável é exatamente a ferramenta certa.

E há um caso em que ela permanece mesmo na arquitetura madura: como último salto. Um cofre obtém a credencial dinâmica e a injeta no processo através do ambiente, no momento da execução. A diferença está na origem e no prazo, não no mecanismo de entrega.

A distinção que importa não é se a credencial passa pelo ambiente, e sim se ela nasceu lá e vai permanecer lá.

## Conclusão

Boa parte das práticas de segurança que adotamos resolvem o problema visível e deixam intacto o problema estrutural. Tirar a senha do código elimina a exposição mais óbvia e cria a sensação de que o assunto está encerrado.

A pergunta que revela se ele está mesmo encerrado é direta: se essa credencial vazasse agora, quanto tempo levaria para você saber, e o que precisaria ser feito?

Quando a resposta envolve descobrir todos os lugares onde ela foi copiada, torcer para não quebrar nada e não ter como verificar se houve uso indevido, o problema não foi resolvido. Ele foi movido para um lugar onde incomoda menos, que é um resultado diferente e bem menos confortável do que costuma parecer.
