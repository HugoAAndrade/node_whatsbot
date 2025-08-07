require('dotenv').config({ quiet: true });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('❌ API Key da Gemini não encontrada.');
    process.exit(1);
}

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('📱 Escaneie o QR code acima com seu WhatsApp.');
});

client.on('ready', () => {
    console.log('🤖 Bot WhatsApp + Gemini está online!');
});

// Histórico em memória por usuário
const historicoPorUsuario = {};

// Limita o histórico para os últimos 6 turnos
function manterUltimosTurnos(historico) {
    return historico.slice(-6);
}

// Função que chama a API Gemini com contexto
async function gerarRespostaGemini(numero, novaMensagem) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

    const response = await fetch(`${url}?key=${API_KEY}`, {
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

    console.log('📩 Resposta da Gemini:', JSON.stringify(data, null, 2));

    const resposta = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Não entendi sua pergunta.';

    historicoPorUsuario[numero].push({
        role: 'assistant',
        parts: [{ text: resposta }]
    });

    return resposta;
}

// Escuta mensagens
client.on('message', async (message) => {
    console.log('📩 Mensagem recebida:', message.body);

    // 1. Ignorar mensagens do próprio bot
    if (message.fromMe) return;

    // 2. Ignorar mensagens antigas (mais de 10 segundos)
    if (message.timestamp && message.timestamp < (Date.now() / 1000) - 10) {
        console.log('⏳ Ignorando mensagem antiga');
        return;
    }

    // 3. Ignorar mensagens sem texto (áudio, imagem, etc.)
    if (!message.body || typeof message.body !== 'string') {
        console.log('📎 Ignorando mensagem não-texto');
        return;
    }

    // Aqui segue o fluxo normal
    const textoParaIA = message.body.trim();
    const numero = message.from;

    try {
        const respostaIA = await gerarRespostaGemini(numero, textoParaIA);
        await client.sendMessage(numero, respostaIA);
    } catch (error) {
        console.error('❌ Erro ao gerar resposta:', error.message);
        await client.sendMessage(numero, 'Algo bugou aqui... tenta de novo 😬');
    }
});

client.initialize();
