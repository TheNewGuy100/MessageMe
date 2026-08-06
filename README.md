# Message Manager

Aplicativo desktop para centralizar Instagram e WhatsApp, acompanhar conversas, configurar automacoes e organizar fluxos visuais.

## Stack

- Electron 43
- Vue 3 + Composition API
- TypeScript
- Vite + electron-vite
- SQLite com `better-sqlite3`
- Vue Flow para o editor visual de fluxos
- WebViews oficiais para Instagram e WhatsApp

## Rodar

```powershell
npm install
npm run dev
```

Build de producao:

```powershell
npm run build
```

## Arquitetura

### Processo principal

- `src/main/index.ts`: ciclo de vida do Electron e janela principal.
- `src/main/ipc.ts`: canais IPC entre renderer e processo principal.
- `src/main/official-views.ts`: WebViews oficiais, audio, zoom, badge, polling e automacao do Instagram.
- `src/main/database.ts`: SQLite, configuracoes, agendamentos, fluxos, estados e logs.
- `src/main/automation/controller.ts`: contrato e orquestrador comum de adapters por plataforma.

### Renderer

- `src/renderer/App.vue`: dialogs de automacao, dashboard, logs e agendamentos.
- `src/renderer/components/Sidebar.vue`: menu lateral principal.
- `src/renderer/components/WebViewsHeader.vue`: controles das WebViews e automacao global.
- `src/renderer/components/FlowNode.vue`: node semantico customizado do Vue Flow.

## Dashboard

O Dashboard e aberto pelo menu lateral e atualiza os dados a cada 5 segundos enquanto estiver aberto.

Metricas atuais:

- Total de nao lidas.
- Conversas do Instagram.
- Solicitacoes e conversas ocultas do Instagram.
- Nao lidas do WhatsApp.
- Estado da automacao.
- Distribuicao visual das conversas do Instagram.

Relatorios de vendas ainda nao possuem uma fonte de pedidos conectada. A area existe com estado vazio para receber essa integracao sem exibir numeros ficticios.

## Automacoes

### Controle global

- O switch global ativa ou pausa a automacao.
- O estado e persistido no SQLite.
- Grupos sao bloqueados antes do envio.
- Mensagens processadas e estados por conversa sao persistidos.
- O ciclo evita execucoes concorrentes.

### Mensagens automaticas por horario

A aba `Mensagens automaticas` permite cadastrar varias mensagens com horarios diarios.

Exemplos:

- `23:00` ate `09:00`: mensagem de indisponibilidade.
- `09:00` ate `11:00`: mensagem de bom dia.
- `11:00` ate `13:00`: mensagem de boa tarde.

Periodos que atravessam meia-noite sao suportados. Periodos sobrepostos sao destacados na interface. Uma resposta sem horario pode ser usada como fallback.

### Fluxos visuais

O editor usa Vue Flow. Os tipos de node sao:

- `trigger`: inicio.
- `message`: processo ou mensagem.
- `condition`: decisao.
- `fallback`: caminho alternativo.
- `end`: fim.

Recursos:

- Pan, zoom, minimap e fullscreen apenas do canvas.
- Nodes customizados com cores e formas semanticas.
- Selecao com painel de propriedades.
- Criacao e remocao de conexoes.
- `Delete` e `Backspace` removem nodes ou conexoes selecionadas.
- Nodes novos usam o node selecionado como origem da conexao.
- Posicoes sao preservadas e colisao e considerada ao posicionar novos nodes.
- Validacao de inicio, fim, decisoes, alcance e conexoes invalidas.

O grafo e salvo como `nodes` e `edges` dentro da definicao JSON do fluxo. A interface ainda esta mais avancada que o interpretador completo de todos os tipos de edge; a execucao deve continuar usando o mesmo grafo canonico.

### Orquestrador por plataforma

`AutomationController` fornece uma invocacao comum:

```ts
automationController.run()
```

Cada plataforma possui um adapter registrado. O Instagram possui o runner funcional atual. O adapter do WhatsApp esta preparado na arquitetura, mas a leitura/envio automatico do WhatsApp ainda precisa ser implementada.

Regras que devem permanecer compartilhadas entre adapters:

- Bloqueio manual por conversa.
- Horarios.
- Deduplicacao.
- Estados por conversa.
- Fallbacks.
- Logs.
- Fila e protecao contra concorrencia.

## Banco de dados

Arquivo:

```text
<Electron userData>\data\message-manager.db
```

Tabelas principais:

- `store`: configuracoes e estado persistente da aplicacao.
- `scheduled_messages`: mensagens agendadas.
- `automation_flows`: fluxos visuais.
- `conversation_states`: estado de cada conversa por plataforma.
- `processed_messages`: deduplicacao de mensagens processadas.
- `automation_logs`: historico de envios e falhas.

## Logs e diagnostico

- `automation-debug.log`: diagnostico tecnico do runner do Instagram.
- DevTools das WebViews: `Ctrl+Shift+I`.
- Dialog `Logs`: logs normais, DevLogs, busca, limpeza e reset de runtime.

Nao registrar conteudo completo de mensagens em logs de diagnostico.

## WhatsApp e chamadas

O WhatsApp atual usa WebView2/Chromium para a camada web. O aplicativo oficial do Windows usa componentes nativos privados, incluindo `WhatsAppNative.Voip` e `WinRTAdapter`, para chamadas.

O prototipo WebView2 confirmou que camera, microfone e WebRTC funcionam fora do aplicativo oficial, mas a ponte VoIP nativa nao e exposta. Por isso, chamadas devem continuar sendo abertas pelo WhatsApp oficial; o Message Manager pode centralizar mensagens e automacoes.

## Estado atual e proximos passos

- Completar o adapter de automacao do WhatsApp.
- Adicionar bloqueio manual por conversa para Instagram e WhatsApp.
- Conectar uma fonte de pedidos aos relatorios de vendas.
- Fazer o interpretador percorrer integralmente edges e decisoes do fluxo visual.
- Adicionar testes de regras de horario, deduplicacao e isolamento entre plataformas.
