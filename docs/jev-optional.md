# Jev opcional no FXMIND

O FXMIND funciona 100% sem Jev. As decisões locais permanecem a fonte padrão.
Jev é uma segunda camada *opt-in*, apenas para desempate semântico; não executa
alterações nem substitui as evidências exigidas pelos gates do FXMIND.

## Configuração

Crie/edite o arquivo **local** `fxmind/.env` (ignorando pelo Git):

```dotenv
FXMIND_JEV_ENABLED=false
FXMIND_JEV_API_KEY=
FXMIND_JEV_MIN_CONFIDENCE=0.75
FXMIND_JEV_TIMEOUT_MS=2500
FXMIND_JEV_MEMORY_ENABLED=false
```

1. Cole a chave no `FXMIND_JEV_API_KEY=` no arquivo local, sem compartilhá-la no chat ou Git.
2. Mude `FXMIND_JEV_ENABLED=true` para ativar a classificação híbrida.
3. Opcionalmente mude `FXMIND_JEV_MEMORY_ENABLED=true` para habilitar a escolha semântica entre até três memórias pré-selecionadas pela busca local.
4. Reinicie o processo do painel/MCP/CLI para garantir o uso dos valores atuais.

Variáveis de ambiente de processo têm prioridade sobre `.env`. Também é aceito
`TYPESAFE_API_KEY` como alternativa à chave `FXMIND_JEV_API_KEY`.
O arquivo de configuração fica no diretório do pacote FXMIND, não no frontend
nem em cada repositório consumidor.

## Comportamento

- **Desligado ou sem chave:** zero chamadas externas; comportamento local original.
- **Classificação:** apenas solicitações com heurística incerta e sem playbook válido são consultadas em `jev-latest`. Playbook validado e classificação local de alta confiança não geram chamadas.
- **Memória:** ranking lexical local primeiro; se houver dois ou mais resultados, Jev opcionalmente escolhe qual tópico deve aparecer primeiro. Não envia o corpo da memória nem código-fonte. Mantém o orçamento local.
- **Baixa confiança, timeout, HTTP 4xx/5xx, conexão indisponível ou resposta inesperada:** devolve a decisão local, sem travar o agente.
- **Gate V/C:** permanecem com verificação real, resultados observados e revisão independente, sem delegação de aprovação ao Jev.

A requisição é feita **somente pelo backend Node**, via HTTPS para
`https://api.typesafe.ai/v1/systemone`. O frontend não recebe a chave.
O formato da API usa `model`, `state` e `questions` do tipo `choice`.
Veja: https://github.com/typesafe-ai/typesafe-sdk-js

## Testar

```powershell
cd F:\FXMIND\fxmind
npm test
node -e "console.log(require('./scripts/lib/jev').jevStatus())"
```

O comando de status indica apenas se a integração está configurada/ativa;
nunca imprime a chave. Testes usam respostas simuladas e não consomem API.
Sem uma chave preenchida, o teste de conexão real fica pendente.

Para desligar instantaneamente: `FXMIND_JEV_ENABLED=false`, sem editar código.
