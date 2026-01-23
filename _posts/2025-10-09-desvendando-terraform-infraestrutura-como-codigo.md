---
title: "Desvendando o Terraform: O que é Infraestrutura como Código (IaC)?"
description: "O que é Terraform e Infraestrutura como Código? Aprenda os conceitos fundamentais de IaC, a diferença entre modelos declarativo e imperativo, e como o Terraform materializa o estado desejado da sua infraestrutura."
date: 2025-10-10 11:00:00 +0000
categories: [DevOps, IaC, Terraform]
tags: [DevOps, IaC, Terraform, O que é Terraform, Infraestrutura como Código, HCL, HashiCorp, Cloud, Tutorial Terraform]
---

## Introdução

Este artigo tem como foco a infraestrutura de servidores e a automação da criação e manutenção desses ambientes. Ao longo do texto, vamos olhar só para a infraestrutura, deixando de lado, por enquanto, outras camadas como containers e orquestradores. A ideia aqui é ajudar você a entender de forma clara o paradigma de Infraestrutura como Código (IaC), sem misturar conceitos que, apesar de relacionados, fazem parte de áreas diferentes.


## A Filosofia da Infraestrutura como Código (IaC)

Infraestrutura como Código não é só uma técnica, mas um campo de conhecimento que marca uma mudança de paradigma em como ambientes computacionais são gerenciados. Antes, equipes criavam e mantinham servidores, redes e outros recursos com configurações feitas à mão, muitas vezes seguindo procedimentos operacionais ou wikis internas. Esse jeito de trabalhar, além de estar sujeito a erros humanos, dificultava repetir processos e controlar mudanças.

Quando migramos para o modelo de IaC, trazemos práticas do desenvolvimento de software: versionamento, testes e repetição. O ambiente deixa de ser um conjunto de recursos criados manualmente e passa a ser descrito por arquivos de código, que podem ser revisados, testados e auditados. É importante separar, nesse contexto, o "deploy da infraestrutura" do "deploy da aplicação". Quando falamos de IaC, estamos falando só do provisionamento e configuração dos recursos que sustentam o ambiente, como servidores, redes, bancos de dados e serviços de plataforma. O código da aplicação entra depois, rodando sobre essa base já pronta.


## Modelos de IaC: O Declarativo vs. O Imperativo (Contextualizando o Terraform)

Existem diferentes jeitos de implementar IaC, sendo os principais o modelo imperativo e o modelo declarativo. O modelo imperativo, como o Ansible, segue uma sequência de comandos: "instale o pacote X", "configure o serviço Y", "reinicie o servidor Z". O foco está no passo a passo, e o resultado depende da ordem dessas ações.

No modelo declarativo, o objetivo é descrever como a infraestrutura deve estar no final do processo. O usuário define, por meio de arquivos de configuração, o estado desejado do ambiente. A ferramenta é que cuida de transformar o estado atual no estado desejado, calculando e executando o que for preciso para chegar lá. O Terraform é a principal referência desse modelo, permitindo que o profissional descreva o ambiente ideal e deixe para a ferramenta o trabalho de convergência.


## Terraform: Materializando o Estado Desejado

O Terraform usa a linguagem HCL (HashiCorp Configuration Language) para descrever o estado desejado da infraestrutura. O fluxo de trabalho do Terraform é um exemplo prático do modelo declarativo. Ao rodar o comando `terraform plan`, a ferramenta compara o estado atual dos recursos com o que está definido nos arquivos de configuração, mostrando ao usuário um plano de execução que detalha as diferenças e as ações necessárias para alinhar os dois estados. O comando `terraform apply` executa as operações propostas, reduzindo a diferença entre o ambiente real e o ambiente ideal a zero.

Esse processo não é só automação de tarefas, mas sim a aplicação de um conceito: a infraestrutura passa a ser tratada como software, sujeita às mesmas práticas de controle, revisão e auditoria.


## Conclusão

Infraestrutura como Código muda completamente a maneira como ambientes computacionais são gerenciados, trazendo para a infraestrutura práticas já consagradas no desenvolvimento de software. O modelo declarativo, que o Terraform coloca em prática, permite que profissionais descrevam ambientes complexos de forma precisa, versionável e auditável. Entender essa abordagem é o primeiro passo para dominar o provisionamento de infraestrutura e construir ambientes escaláveis, confiáveis e reutilizáveis.

---

## Leia Também

Se você gostou deste artigo, confira os outros posts da série sobre Terraform:

- [Terraform State: O que é, por que é importante e como gerenciá-lo?](/posts/terraform-state-o-que-e-por-que-e-importante-e-como-gerencia-lo/)
- [Terraform Além do Básico: count, for_each e Condicionais](/posts/terraform-alem-do-basico-count-foreach-condicionais/)
- [Refatorando Código Terraform para Módulos Locais](/posts/refatorando-codigo-terraform-abstrair-monolitos-para-modulos-locais/)
