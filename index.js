require('dotenv').config({ silent: true });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

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
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('📱 Escaneie o QR code acima com seu WhatsApp.');
});

client.on('ready', () => {
    console.log('🤖 Bot WhatsApp + Gemini está online!');
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

// Escuta mensagens
client.on('message', async (message) => {
    const numero = message.from;
    const textoRaw = message.body?.trim();

    if (message.fromMe) return;
    if (!textoRaw || typeof textoRaw !== 'string') return;
    if (message.from.endsWith('@g.us')) return; // Ignora grupos
    if (message.timestamp && message.timestamp < (Date.now() / 1000) - 10) return; // Mensagens antigas

    // Menu do bot - verificação robusta
    const textoNormalizado = removerAcentos(textoRaw).toLowerCase().trim();
    if (textoNormalizado === 'menu') {
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
});

client.initialize();