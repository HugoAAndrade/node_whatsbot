require('dotenv').config({ silent: true });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

console.log('🚀 Iniciando bot WhatsApp...');

const LOCK_FILE = path.join(__dirname, '.bot.lock');

function processoEhDoBot(pid) {
    try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\u0000/g, ' ');
        return cmdline.includes('node') && cmdline.includes('index.js');
    } catch {
        return false;
    }
}

function limparLocksChromiumOrfaos() {
    const sessionDir = path.join(__dirname, '.wwebjs_auth', 'session');
    const arquivos = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];

    for (const nomeArquivo of arquivos) {
        const caminho = path.join(sessionDir, nomeArquivo);
        if (fs.existsSync(caminho)) {
            try {
                fs.unlinkSync(caminho);
            } catch (error) {
                console.error(`⚠️ Não foi possível remover ${nomeArquivo}:`, error?.message || error);
            }
        }
    }
}

function criarLock() {
    if (fs.existsSync(LOCK_FILE)) {
        const pidAnterior = Number(fs.readFileSync(LOCK_FILE, 'utf8'));
        if (pidAnterior) {
            try {
                process.kill(pidAnterior, 0);
                if (processoEhDoBot(pidAnterior)) {
                    console.error(`❌ Já existe outra instância do bot rodando (PID ${pidAnterior}).`);
                    process.exit(1);
                }

                fs.unlinkSync(LOCK_FILE);
            } catch {
                fs.unlinkSync(LOCK_FILE);
            }
        } else {
            fs.unlinkSync(LOCK_FILE);
        }
    }

    fs.writeFileSync(LOCK_FILE, String(process.pid));
}

function removerLock() {
    if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
    }
}

criarLock();

let tentativaReconexao = 0;
let inicializando = false;
const mensagensProcessadas = new Map();

// API Key da Gemini
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('❌ API Key da Gemini não encontrada.');
    process.exit(1);
}

// Inicializa o WhatsApp Client com Puppeteer customizado
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

client.on('qr', (qr) => {
    console.log('🧩 Evento QR recebido.');
    qrcode.generate(qr, { small: true });
    console.log('📱 Escaneie o QR code acima com seu WhatsApp.');
});

client.on('ready', () => {
    console.log('🤖 Bot WhatsApp + Gemini está online!');
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Carregando WhatsApp Web: ${percent}% | ${message}`);
});

client.on('authenticated', () => {
    console.log('🔐 Sessão autenticada com sucesso.');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação do WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
    console.error('⚠️ WhatsApp desconectado. Motivo:', reason);
    setTimeout(() => {
        iniciarCliente();
    }, 5000);
});

// Histórico e controle de usuários
const historicoPorUsuario = {};
const usuariosAtivos = {};
const usuariosComMenuAberto = {};

// Limita o histórico para os últimos 6 turnos
function manterUltimosTurnos(historico) {
    return historico.slice(-6);
}

// Remove acentos e normaliza texto
function removerAcentos(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function obterChaveMensagem(message) {
    return message?.id?._serialized || `${message?.from || ''}|${message?.timestamp || ''}|${message?.body || ''}`;
}

function jaFoiProcessada(message) {
    const chave = obterChaveMensagem(message);
    if (!chave) return false;

    if (mensagensProcessadas.has(chave)) {
        return true;
    }

    mensagensProcessadas.set(chave, Date.now());

    const agora = Date.now();
    for (const [ch, ts] of mensagensProcessadas.entries()) {
        if (agora - ts > 120000) {
            mensagensProcessadas.delete(ch);
        }
    }

    return false;
}

// Chama a API Gemini
async function gerarRespostaGemini(numero, novaMensagem) {
    if (!historicoPorUsuario[numero]) {
        historicoPorUsuario[numero] = [
            {
                role: 'user',
                parts: [
                    {
                        text: `Você é um assistente de WhatsApp com a seguinte personalidade:
- Nome: Hugo
- Estilo: Desenvolvedor Full Stack com uma personalidade séria e simpática.
- Tecnologias que domina: JavaScript, Docker, PHP, Node.js, React, CSS, Magento, WordPress.
- Objetivo: Ajudar com clareza, de forma profissional, mas sempre leve e objetiva.`
                    }
                ]
            }
        ];
    }

    historicoPorUsuario[numero].push({
        role: 'user',
        parts: [{ text: novaMensagem }]
    });

    const body = {
        contents: manterUltimosTurnos(historicoPorUsuario[numero])
    };

    console.log('📨 Enviando para Gemini:', JSON.stringify(body, null, 2));

    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const erroTexto = await response.text();
        console.error('❌ Erro da Gemini API:', erroTexto);
        throw new Error('Erro na chamada da API Gemini');
    }

    const data = await response.json();
    const resposta = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Não entendi sua pergunta.';

    historicoPorUsuario[numero].push({
        role: 'assistant',
        parts: [{ text: resposta }]
    });

    return resposta;
}

// Handler único para mensagens
async function processarMensagem(message, origemEvento) {
    const numero = message.from;
    const textoRaw = message.body?.trim();

    if (message.fromMe) return;
    if (client.info?.wid?._serialized && numero === client.info.wid._serialized) return;
    if (!textoRaw || typeof textoRaw !== 'string') return;
    if (message.from.endsWith('@g.us')) return; // Ignora grupos
    if (message.timestamp && message.timestamp < (Date.now() / 1000) - 10) return; // Mensagens antigas
    if (jaFoiProcessada(message)) return;

    console.log('📨 Mensagem recebida via', origemEvento, '| texto:', textoRaw, '| de:', numero);

    // Menu do bot - verificação robusta
    const textoNormalizado = removerAcentos(textoRaw).toLowerCase().trim();
    console.log('📝 Texto normalizado:', textoNormalizado);
    if (textoNormalizado === 'menu') {
        console.log('✅ Menu detectado!');
        const menuTexto =
`🤖 *Menu do Bot WhatsApp* 🤖

✅ *1* - Ativar o bot
❌ *2* - Desativar o bot

➡️ *Digite o número da opção desejada para continuar.*

*Dica:* Para abrir esse menu a qualquer momento, envie *menu*.`;

        usuariosComMenuAberto[numero] = true;
        try {
            await client.sendMessage(numero, menuTexto);
        } catch (error) {
            console.error('❌ Erro ao enviar menu:', error.message);
        }
        return;
    }

    // Processa opções do menu
    if (usuariosComMenuAberto[numero]) {
        if (textoRaw === '1') {
            usuariosAtivos[numero] = true;
            await client.sendMessage(numero, '✅ Bot ativado! Pode mandar suas perguntas.');
        } else if (textoRaw === '2') {
            delete usuariosAtivos[numero];
            await client.sendMessage(numero, '❌ Bot desativado! Para ativar, envie "menu".');
        } else {
            await client.sendMessage(numero, '❓ Opção inválida. Por favor, digite *1* ou *2*.');
            return;
        }
        usuariosComMenuAberto[numero] = false;
        return;
    }

    // Se o bot não estiver ativo para esse usuário, não responde
    if (!usuariosAtivos[numero]) return;

    // Remove acentos e conversa com Gemini
    const texto = removerAcentos(textoRaw.toLowerCase());

    try {
        const respostaIA = await gerarRespostaGemini(numero, texto);
        await client.sendMessage(numero, respostaIA);
    } catch (error) {
        console.error('❌ Erro ao gerar resposta:', error.message);
        await client.sendMessage(numero, '⚠️ Algo deu errado... tenta de novo 😬');
    }
}

// Escuta mensagens de ambos os eventos para compatibilidade entre versões
client.on('message', async (message) => {
    await processarMensagem(message, 'message');
});

client.on('message_create', async (message) => {
    await processarMensagem(message, 'message_create');
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ unhandledRejection:', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ uncaughtException:', error?.message || error);
    const mensagem = String(error?.message || error || '').toLowerCase();
    if (mensagem.includes('target closed') || mensagem.includes('execution context was destroyed')) {
        console.log('🔁 Detectada queda do navegador, tentando reconectar...');
        setTimeout(() => {
            iniciarCliente();
        }, 5000);
    }
});

let encerrando = false;
async function encerrar(signal) {
    if (encerrando) return;
    encerrando = true;
    console.log(`🛑 Recebido ${signal}. Encerrando bot com segurança...`);
    try {
        await client.destroy();
    } catch (error) {
        console.error('⚠️ Erro ao destruir client:', error?.message || error);
    } finally {
        removerLock();
        process.exit(0);
    }
}

process.on('SIGINT', () => {
    encerrar('SIGINT');
});

process.on('SIGTERM', () => {
    encerrar('SIGTERM');
});

process.on('exit', () => {
    removerLock();
});

async function iniciarCliente() {
    if (inicializando) return;

    try {
        inicializando = true;
        limparLocksChromiumOrfaos();
        await client.initialize();
        tentativaReconexao = 0;
        console.log('✅ client.initialize() concluído.');
    } catch (error) {
        tentativaReconexao += 1;
        const mensagemErro = String(error?.message || error || '');
        console.error(`❌ Falha no client.initialize() (tentativa ${tentativaReconexao}):`, mensagemErro);

        if (mensagemErro.includes('The browser is already running for')) {
            console.log('🧹 Lock do Chromium detectado, limpando artefatos de sessão...');
            limparLocksChromiumOrfaos();
        }

        setTimeout(() => {
            iniciarCliente();
        }, 5000);
    } finally {
        inicializando = false;
    }
}

iniciarCliente();