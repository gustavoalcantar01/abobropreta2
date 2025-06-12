const axios = require('axios');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const config = require('./config.json');

const filepath = './tokens.txt';
const RECONNECT_DELAY = 5000; // 5 segundos entre tentativas
const MAX_RECONNECT_ATTEMPTS = 5;

function sort(filepath) {
    const fileContent = fs.readFileSync(filepath, 'utf-8');
    return fileContent.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .sort();
}

async function checkTokens(tokens) {
    const validTokens = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        try {
            const response = await axios.get('https://discord.com/api/v10/users/@me', {
                headers: {
                    Authorization: `${token}`
                }
            });
            console.log(`Token ${i + 1} is valid:`);
            validTokens.push(token);
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.error(`Token ${i + 1} is invalid`);
            } else {
                console.error(`Error checking token ${i + 1}:`, error.message);
            }
        }
    }
    return validTokens;
}

function ws_joiner(token) {
    let reconnectAttempts = 0;
    let ws;
    let heartbeatInterval;
    let reconnectTimeout;

    const auth = {
        op: 2,
        d: {
            token: token,
            properties: {
                $os: 'Linux',
                $browser: 'Firefox',
                $device: 'desktop'
            }
        }
    };

    const vc = {
        op: 4,
        d: {
            guild_id: config.GUILD_ID,
            channel_id: config.VC_CHANNEL,
            self_mute: config.MUTED,
            self_deaf: config.DEAFEN
        }
    };

    function connect() {
        ws = new WebSocket('wss://gateway.discord.gg/?v=9&encoding=json');

        ws.on('open', () => {
            console.log(`[${token.substring(0, 10)}...] Conectado ao WebSocket`);
            ws.send(JSON.stringify(auth));
            ws.send(JSON.stringify(vc));
            reconnectAttempts = 0; // Resetar contador após conexão bem-sucedida
        });

        ws.on('close', (code, reason) => {
            console.log(`[${token.substring(0, 10)}...] Conexão fechada. Código: ${code}, Razão: ${reason}`);
            scheduleReconnect();
        });

        ws.on('error', (error) => {
            console.error(`[${token.substring(0, 10)}...] Erro no WebSocket:`, error.message);
            scheduleReconnect();
        });

        // Lidar com heartbeats para manter a conexão ativa
        ws.on('message', (data) => {
            const payload = JSON.parse(data);
            if (payload.op === 10) { // Hello payload
                const heartbeatInterval = payload.d.heartbeat_interval;
                setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ op: 1, d: null }));
                    }
                }, heartbeatInterval);
            }
        });
    }

    function scheduleReconnect() {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttempts); // Backoff exponencial
            console.log(`[${token.substring(0, 10)}...] Tentando reconectar em ${delay/1000} segundos (Tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            
            clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connect, delay);
        } else {
            console.error(`[${token.substring(0, 10)}...] Máximo de tentativas de reconexão alcançado`);
        }
    }

    // Iniciar a primeira conexão
    connect();

    // Retornar função para limpeza
    return () => {
        clearTimeout(reconnectTimeout);
        clearInterval(heartbeatInterval);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    };
}

async function main() {
    const tokens = sort(filepath);
    const validTokens = await checkTokens(tokens);
    const cleanupFunctions = [];

    // Conectar todos os tokens
    validTokens.forEach(token => {
        const cleanup = ws_joiner(token);
        cleanupFunctions.push(cleanup);
    });

    // Lidar com encerramento do processo
    process.on('SIGINT', () => {
        console.log('\nEncerrando conexões...');
        cleanupFunctions.forEach(cleanup => cleanup());
        process.exit();
    });
}

main();