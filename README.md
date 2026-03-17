# WhatsApp Bot + Gemini

Bot de WhatsApp feito em Node.js usando `whatsapp-web.js` e integração com a API Gemini.

## Funcionalidades

- Gera QR Code no terminal para autenticação do WhatsApp.
- Ativação e desativação do bot por usuário via menu.
- Ignora mensagens de grupos.
- Mantém contexto curto de conversa (últimos 6 turnos) por usuário.
- Usa a API Gemini (`gemini-2.0-flash`) para responder mensagens.

## Pré-requisitos

- Node.js 18+
- NPM
- Conta com chave de API da Gemini
- WhatsApp no celular para escanear o QR Code

## Instalação

```bash
npm install
```

## Configuração

Crie (ou edite) o arquivo `.env` na raiz do projeto com:

```env
GEMINI_API_KEY=sua_chave_aqui
```

## Como rodar localmente

```bash
node index.js
```

Ao iniciar, será exibido um QR Code no terminal. Escaneie com o WhatsApp para conectar.

## Como usar no WhatsApp

1. Envie `menu` para o número conectado.
2. Envie `1` para **ativar** o bot.
3. Envie `2` para **desativar** o bot.
4. Com o bot ativo, envie qualquer mensagem para receber resposta da Gemini.

## Scripts disponíveis

No `package.json` existe apenas:

```bash
npm test
```

Atualmente esse comando retorna erro padrão (`"Error: no test specified"`), pois ainda não há testes configurados.

## Rodando com Docker

### Build da imagem

```bash
docker build -t whatsapp-bot .
```

### Executar container

```bash
docker run --rm -it --env-file .env whatsapp-bot
```

> Observação: como o bot depende de autenticação por QR Code e sessão local, rodar em container pode exigir ajustes extras para persistência da sessão (`.wwebjs_auth`) entre execuções.

## Estrutura principal

- `index.js`: lógica principal do bot, menu e integração com Gemini.
- `Dockerfile`: configuração para build e execução com Docker.
- `package.json`: dependências e scripts do projeto.
