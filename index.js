const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const readline = require("readline");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const yts = require('yt-search');
const config = require('./config');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
    });

    // --- LINK SYSTEM ---
    if (!sock.authState.creds.registered) {
        const mode = await question("සම්බන්ධ වන ආකාරය: 1 (QR) හෝ 2 (Pairing Code): ");
        if (mode === '2') {
            let phoneNumber = await question("දුරකථන අංකය (94...): ");
            let code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
            console.log(`\n🔗 Pairing Code එක: ${code}\n`);
        } else {
            sock.ev.on('connection.update', (s) => { if (s.qr) qrcode.generate(s.qr, { small: true }); });
        }
    }

    // --- CONNECT MESSAGE WITH LOGO ---
    sock.ev.on("connection.update", async (u) => {
        if (u.connection === "open") {
            console.log("CONNECTED! ✅");
            await sock.sendMessage(config.SUDO[0] + "@s.whatsapp.net", { 
                image: { url: config.LOGO_URL }, 
                caption: `┏━━━━━━━━━━━━━━━━━━━━━━━━┓\n┃   ✨  *${config.BOT_NAME} IS ONLINE* ✨\n┗━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n👤 *Owner:* ${config.SUDO[0]}\n⚙️ *Mode:* ${config.MODE}\n\n> 𝙳𝙴𝚅𝙾𝙻𝙾𝙿𝙴𝙳 𝙱𝚈 𝙶𝙰𝙶𝙰𝙽𝙰 𝙼𝙰𝙽𝙹𝚄𝙻𝙰©️` 
            });
        }
        if (u.connection === "close") startBot();
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        // --- AUTO REACT ---
        if (config.AUTO_REACT === "true") await sock.sendMessage(from, { react: { text: "❤️", key: msg.key } });

        // --- STYLISH MENU ---
        if (text.startsWith(config.PREFIX)) {
            const command = text.slice(config.PREFIX.length).split(' ')[0].toLowerCase();
            
            if (command === "menu") {
                const menuText = `┏━━━━━━━━━━━━━━━━━━━━━━━━┓\n┃   ✨  *${config.BOT_NAME} MENU* ✨\n┗━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n*┌─── 📥 DOWNLOADS*\n*│* 🎵 ${config.PREFIX}song\n*└──────────────┈╼*\n\n*┌─── 🤖 AI & INFO*\n*│* 🧠 ${config.PREFIX}ai\n*│* ⚡ ${config.PREFIX}alive\n*└──────────────┈╼*\n\n> *${config.footer}*`;
                await sock.sendMessage(from, { 
                    image: { url: config.LOGO_URL }, 
                    caption: menuText 
                }, { quoted: msg });
            }
            
            if (command === "alive") {
                await sock.sendMessage(from, { text: config.ALIVE_MSG }, { quoted: msg });
            }

            if (command === "song") {
                const search = await yts(text.split(' ').slice(1).join(' '));
                const video = search.videos[0];
                await sock.sendMessage(from, { image: { url: video.thumbnail }, caption: `🎵 *Title:* ${video.title}\n\nReply 1 (Doc) / 2 (Audio)` }, { quoted: msg });
            }
        } 
        // --- AI CHAT ---
        else if (config.MODE === "public") {
            try {
                const result = await model.generateContent(text);
                await sock.sendMessage(from, { text: result.response.text() }, { quoted: msg });
            } catch (e) { console.log("AI Error"); }
        }
    });
}

startBot();