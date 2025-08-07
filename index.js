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
function manterUltimosTurnos(historico, maxTurnos = 6) {
    return historico.slice(-maxTurnos);
}

// Função que chama a API Gemini com contexto
async function gerarRespostaGemini(numero, novaMensagem) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

    // Inicializa histórico se não existir
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

    // Adiciona a nova mensagem do usuário ao histórico
    historicoPorUsuario[numero].push({
        role: 'user',
        parts: [{ text: novaMensagem }]
    });

    const body = {
        contents: manterUltimosTurnos(historicoPorUsuario[numero])
    };

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
    const resposta = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Não entendi sua pergunta.';

    // Adiciona a resposta da IA ao histórico
    historicoPorUsuario[numero].push({
        role: 'model',
        parts: [{ text: resposta }]
    });

    return resposta;
}

// Escuta mensagens
client.on('message_create', async (message) => {
    if (message.fromMe) return; // ⛔ Ignora mensagens que você mesmo enviou

    const textoParaIA = message.body?.trim();
    const numero = message.from;

    if (!textoParaIA) {
        await client.sendMessage(numero, 'Manda alguma coisa pra eu responder 😅');
        return;
    }

    try {
        const respostaIA = await gerarRespostaGemini(numero, textoParaIA);
        await client.sendMessage(numero, respostaIA);
    } catch (error) {
        console.error('❌ Erro ao gerar resposta:', error.message);
        await client.sendMessage(numero, 'Algo bugou aqui... tenta de novo 😬');
    }
});


client.initialize();
