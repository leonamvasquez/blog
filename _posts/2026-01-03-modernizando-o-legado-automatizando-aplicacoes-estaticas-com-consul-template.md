---
title: "Modernizando o Legado: Automatizando Aplicações Estáticas (NGINX/HAProxy) com Consul-Template"
date: 2025-12-10 09:00:00 -0300
categories: [DevOps, Automation, Consul]
tags: [DevOps, Consul, NGINX, HAProxy, Automation, Legacy Modernization]
---

## Introdução

A promessa da infraestrutura moderna é a dinamicidade: serviços escalam automaticamente, IPs mudam e containers são orquestrados em tempo real. Ferramentas como o HashiCorp Consul foram criadas para gerenciar esse caos através de Service Discovery via DNS ou API.

No entanto, a realidade da maioria das empresas inclui uma vasta camada de "infraestrutura legada" ou tecnologias tradicionais que não foram desenhadas para esse mundo efêmero. Servidores web como **NGINX**, balanceadores como **HAProxy** ou até aplicações antigas em Java/PHP geralmente dependem de **arquivos de configuração estáticos** no disco.

Como fazer com que um NGINX, que espera uma lista fixa de IPs em seu arquivo `nginx.conf`, descubra automaticamente que novos containers da aplicação subiram no cluster?

Este artigo explora o **Consul-Template**, uma ferramenta agnóstica e poderosa que atua como a ponte entre a dinamicidade do Consul e a estabilidade de softwares baseados em arquivos estáticos.

## O Conflito: Dinâmico vs. Estático

Imagine um cenário comum de Load Balancing com NGINX. Para balancear carga entre três servidores de aplicação, sua configuração `upstream` se parece com isso:

```nginx
upstream backend {
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
    server 10.0.0.3:8080;
}
```

Se o Auto Scaling Group adicionar um quarto servidor (10.0.0.4), o NGINX não saberá da existência dele. Se o servidor 10.0.0.1 morrer, o NGINX continuará enviando tráfego para ele (causando erros 502 Bad Gateway) até que um operador humano edite o arquivo e recarregue o serviço.

Tentar resolver isso com scripts cron ou automações frágeis é um anti-padrão. Precisamos de uma solução que "assista" o estado do cluster e reaja imediatamente.

## A Solução: Consul-Template

O `consul-template` é um binário autônomo (daemon) criado pela HashiCorp. Sua função é simples, mas vital: ele consulta dados do Consul (Serviços, Key-Value Store, Vault Secrets), renderiza um arquivo de configuração baseado em um modelo (template) e, opcionalmente, executa um comando de reload.

O fluxo de trabalho é contínuo:

1. **Watch**: O daemon monitora o cluster Consul em tempo real.
2. **Change**: Quando ocorre uma mudança (ex: um novo serviço "backend" é registrado), ele detecta o evento.
3. **Render**: Ele reescreve o arquivo de configuração local (ex: `/etc/nginx/conf.d/default.conf`) usando os novos dados.
4. **Execute**: Ele roda um comando arbitrário para aplicar a mudança (ex: `nginx -s reload`).

## Implementação Prática

Para automatizar o NGINX do exemplo anterior, deixamos de editar o arquivo `.conf` diretamente e passamos a editar um arquivo de template (`.ctmpl`).

A sintaxe utilizada é a **Go Template** (a mesma usada no Helm e Kubernetes).

### O Template (nginx.conf.ctmpl)

Em vez de IPs fixos, usamos a função `range` para iterar sobre todos os serviços saudáveis registrados no Consul:

```nginx
upstream backend {
  {{ range service "backend-api" }}
    server {{ .Address }}:{{ .Port }};
  {{ end }}
}

server {
    listen 80;
    location / {
        proxy_pass http://backend;
    }
}
```

### A Execução

Iniciamos o processo do `consul-template` apontando para o template, o destino final e o comando de reload:

```bash
consul-template \
  -template "/tmp/nginx.conf.ctmpl:/etc/nginx/conf.d/default.conf:nginx -s reload"
```

A partir desse momento, a automação está ativa.

1. Se 10 novos containers `backend-api` subirem, o Consul detecta.
2. O `consul-template` recebe a notificação.
3. Ele escreve as 10 novas linhas `server IP:PORT;` no arquivo do NGINX.
4. Ele executa o reload do NGINX.

Tudo isso acontece em milissegundos, sem intervenção humana e sem downtime (devido à natureza do reload do NGINX).

## Indo Além do Service Discovery

A beleza do Consul-Template é que ele não serve apenas para listas de IPs. Ele pode ser usado para injetar **Configurações Dinâmicas** vindas do Consul KV.

Imagine controlar o comportamento do NGINX via Consul:

```nginx
location / {
    {{ if key "config/nginx/maintenance_mode" | parseBool }}
        return 503 "Estamos em manutenção";
    {{ else }}
        proxy_pass http://backend;
    {{ end }}
}
```

Neste exemplo, um operador pode ativar o "Modo Manutenção" apenas alterando uma chave no Consul KV, e todos os servidores NGINX do parque serão atualizados instantaneamente.

## Conclusão

Modernizar a infraestrutura não significa necessariamente reescrever todas as aplicações para serem nativas de nuvem ou substituir tecnologias robustas como NGINX e HAProxy por Service Meshes complexos.

O Consul-Template atua como um **facilitador de modernização**. Ele permite que ferramentas "legadas" (baseadas em arquivos estáticos) ganhem superpoderes dinâmicos, integrando-se perfeitamente a ambientes de Auto Scaling e Containers.

Essa abordagem oferece o melhor dos dois mundos: a estabilidade e performance de ferramentas maduras, com a agilidade e automação de uma arquitetura baseada em Service Discovery.