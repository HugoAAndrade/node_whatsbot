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

const historicoPorUsuario = {};
const usuariosAtivos = {};

// Limita o histórico para os últimos 6 turnos
function manterUltimosTurnos(historico) {
    return historico.slice(-6);
}

// Função para remover acentos e normalizar texto
function removerAcentos(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Função que chama a API Gemini com contexto
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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`, {
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
const usuariosComMenuAberto = {};

client.on('message', async (message) => {
    console.log('📩 Mensagem recebida:', message.body);

    // Ignorar mensagens de grupos
    if (message.from.endsWith('@g.us')) {
        console.log('🚫 Mensagem de grupo ignorada');
        return;
    }

    const numero = message.from;
    let textoRaw = message.body?.trim();
    if (message.fromMe) return;

    if (message.timestamp && message.timestamp < (Date.now() / 1000) - 10) {
        console.log('⏳ Ignorando mensagem antiga');
        return;
    }

    if (!textoRaw || typeof textoRaw !== 'string') {
        console.log('📎 Ignorando mensagem não-texto');
        return;
    }

    if (textoRaw.toLowerCase() === 'menu') {
        const menuTexto =
            `🤖 *Menu do Bot WhatsApp* 🤖

✅ *1* - Ativar o bot
❌ *2* - Desativar o bot

➡️ *Digite o número da opção desejada para continuar.*

*Dica:* Para abrir esse menu a qualquer momento, envie *menu*.`;
        usuariosComMenuAberto[numero] = true;  // Marca menu aberto para esse usuário
        await client.sendMessage(numero, menuTexto);
        return;
    }

    // Só processa "1" ou "2" se o menu estiver aberto para esse usuário
    if (usuariosComMenuAberto[numero]) {
        if (textoRaw === '1') {
            usuariosAtivos[numero] = true;
            await client.sendMessage(numero, '✅ Bot ativado! Pode mandar suas perguntas.');
            usuariosComMenuAberto[numero] = false; // Fecha o menu
            return;
        }
        if (textoRaw === '2') {
            delete usuariosAtivos[numero];
            await client.sendMessage(numero, '❌ Bot desativado! Para ativar, envie "menu".');
            usuariosComMenuAberto[numero] = false; // Fecha o menu
            return;
        }
        // Se digitou outra coisa com menu aberto, não entende e manda mensagem padrão
        await client.sendMessage(numero, '❓ Opção inválida. Por favor, digite *1* ou *2*.');
        return;
    }

    // Remove acentos para outras comparações e uso com Gemini
    const texto = removerAcentos(textoRaw.toLowerCase());

    // Se o bot não estiver ativado, não responde nada
    if (!usuariosAtivos[numero]) {
        return;
    }

    // Usuário está ativo, conversa com Gemini
    try {
        const respostaIA = await gerarRespostaGemini(numero, texto);
        await client.sendMessage(numero, respostaIA);
    } catch (error) {
        console.error('❌ Erro ao gerar resposta:', error.message);
        await client.sendMessage(numero, '⚠️ Algo deu errado... tenta de novo 😬');
    }
});


client.initialize();
