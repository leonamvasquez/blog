---
title: "Arquitetura Híbrida: Unificando a Conectividade entre Kubernetes e VMs com Consul"
date: 2026-01-29 23:36:17 -0300
description: "Aprenda como unificar a conectividade entre Kubernetes e máquinas virtuais (VMs) utilizando o HashiCorp Consul como Service Mesh híbrido e Service Discovery centralizado."
categories: [Architecture, Consul, Kubernetes]
tags: [Consul, Kubernetes, Hybrid Cloud, Service Mesh, Networking, Legacy Modernization]
---
## Introdução

A narrativa de *Cloud Native* muitas vezes sugere um mundo ideal onde 100% da infraestrutura reside em clusters Kubernetes modernos e efêmeros. Na prática, essa realidade é rara.

A maioria das organizações opera em um cenário **híbrido (Brownfield)**: microsserviços modernos rodando em Kubernetes precisam se comunicar com bancos de dados, mainframes e aplicações monolíticas legadas que ainda residem em Máquinas Virtuais (VMs) ou Bare Metal.

O desafio arquitetural surge, quase sempre, na camada de rede. O Kubernetes opera sobre uma rede de *overlay* (CNI), frequentemente isolada da rede física (*underlay*, VLANs ou VPCs) onde vivem as VMs. Conectar esses dois mundos por meio de regras estáticas de firewall, rotas manuais e DNS customizado tende a gerar soluções frágeis, difíceis de manter e pouco escaláveis.

Este artigo explora como o **HashiCorp Consul** pode atuar como um *control plane* unificado, permitindo que serviços em Kubernetes e em VMs se descubram e se comuniquem de forma transparente, respeitando a realidade híbrida das organizações.

## O Desafio da Dissonância de Redes

Ao tentar conectar um Pod no Kubernetes a um serviço rodando em uma VM, algumas barreiras estruturais surgem imediatamente:

1. **Endereçamento Efêmero**
   IPs de Pods mudam constantemente a cada *deploy* ou *reschedule*. Firewalls e ACLs baseados em IP não acompanham essa volatilidade.

2. **Service Discovery Isolado**
   O DNS do Kubernetes (kube-dns / CoreDNS) conhece apenas recursos internos do cluster. Uma VM externa não resolve, de forma nativa, nomes como app.svc.cluster.local.

3. **Ausência de Identidade Compartilhada**
   Não existe, por padrão, uma identidade comum que permita autenticação e autorização consistente entre serviços legados e workloads modernos.

Grande parte das soluções de *Service Mesh* foca prioritariamente no Kubernetes, tratando VMs como exceções ou exigindo a criação de *gateways* dedicados para integrar o mundo externo. O Consul adota uma abordagem diferente: **agnóstica de plataforma**.

## Consul: Um Plano de Controle Orientado a Serviços

A filosofia central do Consul é simples e poderosa: **a unidade fundamental da arquitetura é o serviço, não o IP nem a plataforma onde ele executa**.

Ao abstrair a complexidade da rede subjacente, o Consul fornece uma visão lógica e consistente de todo o ambiente distribuído.

### 1. VMs como Recursos Nativos na Malha

Diferente de abordagens que dependem exclusivamente de componentes específicos de Kubernetes, uma VM pode participar da malha do Consul simplesmente executando o **Consul Agent**.

Esse agente:

* Registra serviços locais (por exemplo, `legacy-billing` ou `oracle-db`) no catálogo global
* Executa *health checks* locais
* Associa identidade e metadados ao serviço

Para o Consul, não importa se o serviço roda em um container, em uma VM moderna ou em um servidor Linux de 2015: ele é apenas mais um serviço disponível na malha.

### 2. Sincronização de Catálogo com Kubernetes

No lado do Kubernetes, o Consul fornece o componente **`consul-k8s`**, responsável por integrar o cluster ao plano de controle global.

Uma de suas funcionalidades mais importantes é o **Catalog Sync**, que funciona de forma bidirecional:

* **Kubernetes → Consul**
  Serviços do cluster são automaticamente detectados e registrados no catálogo do Consul, tornando-os visíveis para workloads externos.

* **Consul → Kubernetes**
  Serviços externos (rodando em VMs ou Bare Metal) são sincronizados para dentro do Kubernetes, onde o Consul cria recursos de `Service` (`ClusterIP` ou `ExternalName`) que representam esses endpoints.

Essa sincronização elimina a necessidade de manter DNS paralelos ou configurações manuais duplicadas.

## O Fluxo de Conectividade na Prática

O impacto dessa arquitetura é a transparência operacional. Um fluxo típico de comunicação ocorre da seguinte forma:

1. Um microsserviço no Kubernetes precisa consumir um serviço legado.
2. A aplicação realiza uma chamada para `http://legacy-billing`.
3. O CoreDNS resolve esse nome, pois o Consul sincronizou o serviço para dentro do cluster.
4. O Kubernetes roteia a chamada para o IP real da VM (ou para o proxy sidecar, caso a malha esteja ativa).
5. O tráfego cruza a fronteira entre *overlay* e *underlay* sem dependência de IPs estáticos ou regras específicas por Pod.

O resultado é uma comunicação previsível, sem *hardcode* de endereços e com menor acoplamento à topologia física da rede.

## Segurança com Consul Connect (Service Mesh)

Ao ativar o **Consul Connect**, a arquitetura híbrida evolui para um modelo **Zero Trust**, inclusive para workloads legados.

Nesse cenário, um proxy Envoy é executado ao lado da aplicação na VM. A comunicação passa a seguir o fluxo:

`Pod (Envoy) → mTLS criptografado → VM (Envoy) → Aplicação Local`

Isso permite aplicar **Intentions**, que funcionam como políticas de autorização orientadas a serviço, por exemplo:

> Permitir que o serviço `frontend` (Kubernetes) acesse `legacy-billing` (VM), negando qualquer outra comunicação.

### Considerações Operacionais

Apesar dos ganhos significativos em segurança e observabilidade, a introdução de proxies em VMs legadas exige planejamento. Aplicações sensíveis à latência, ambientes com baixa maturidade em observabilidade ou times pouco acostumados a *troubleshooting* distribuído podem enfrentar desafios adicionais.

## Facilitando o Padrão Strangler Fig

Do ponto de vista estratégico, essa integração viabiliza de forma prática o padrão **Strangler Fig**.

Funcionalidades de um monolito legado podem ser gradualmente migradas para microsserviços no Kubernetes, enquanto o Consul controla o *service discovery* e o roteamento.

Com recursos como **Traffic Splitting**, é possível redirecionar uma pequena porcentagem do tráfego para novas implementações, validando comportamento e performance antes de uma migração completa, evitando abordagens de *Big Bang*.

## Quando o Consul Pode Não Ser a Melhor Escolha

Embora poderoso, o Consul não é uma solução universal.

Em ambientes pequenos, com poucos serviços legados, baixa taxa de mudança e comunicação simples entre sistemas, a adoção do Consul pode introduzir mais complexidade operacional do que benefícios imediatos.

Times sem maturidade em automação, observabilidade e gestão de ambientes distribuídos podem ter dificuldade em extrair todo o valor da malha de serviços. Nesses casos, soluções mais simples baseadas em DNS ou roteamento estático podem ser suficientes.

## Conclusão

O Kubernetes não deve ser tratado como uma ilha isolada. Em organizações reais, a modernização da infraestrutura passa, inevitavelmente, pela convivência entre o novo e o legado.

O valor do Consul está em oferecer um **caminho pragmático** para essa transição, abstraindo a complexidade de rede e fornecendo uma visão única de todos os serviços, independentemente da plataforma onde executam.

Mais do que conectar Kubernetes e VMs, o Consul permite que equipes foquem na evolução gradual da arquitetura e na entrega de valor ao negócio, em vez de gastar energia gerenciando tabelas de roteamento, regras de firewall e configurações manuais de DNS.