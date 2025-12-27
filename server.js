const express = require("express");
const cors = require("cors");
const axios = require("axios");
const https = require("https");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://epicplayplay.cfd/";
const CHANNEL_ID = "premium537";

const agent = new https.Agent({ rejectUnauthorized: false });

// 1. OBTENER TOKEN
async function getToken() {
    try {
        const response = await axios.get(`https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${CHANNEL_ID}`, {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERER },
            httpsAgent: agent
        });
        const html = response.data;
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || html.match(/Bearer\s+(eyJ[^"']+)/);
        if (!match) throw new Error("Token no encontrado");
        return match[1];
    } catch (e) {
        console.error("❌ Error Token:", e.message);
        return "";
    }
}

// 2. BUSCADOR DE URL (Sin Cookies)
async function getWorkingStreamUrl(token) {
    let servers = [];
    
    // Intento de Lookup Oficial
    try {
        const lookup = await axios.get(`https://chevy.giokko.ru/server_lookup?channel_id=${CHANNEL_ID}`, {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERER },
            httpsAgent: agent
        });
        if(lookup.data.server_key) {
            console.log(`ℹ️ Oficial: ${lookup.data.server_key}`);
            servers.push(lookup.data.server_key);
        }
    } catch (e) {}

    // Lista completa de intentos
    const allServers = [...new Set([...servers, "dokko1", "dokko2", "top1", "chevy"])];

    for (const server of allServers) {
        // Construimos las URLs posibles
        let urls = [];
        const clean = server.replace("/cdn", "");
        
        // URL Tipo A: dokko1new.kiko2.ru
        urls.push(`https://${clean}new.kiko2.ru/${clean}/${CHANNEL_ID}/mono.css?.m3u8`);
        // URL Tipo B: top1...
        urls.push(`https://${clean}.kiko2.ru/${clean}/cdn/${CHANNEL_ID}/mono.css`);

        for (const url of urls) {
            try {
                // PRUEBA SIN COOKIES, SOLO TOKEN
                await axios.head(url, {
                    headers: { 
                        "User-Agent": USER_AGENT, 
                        "Referer": REFERER,
                        "Origin": REFERER,
                        "Authorization": `Bearer ${token}`
                        // ¡COOKIE QUITADA!
                    },
                    httpsAgent: agent,
                    timeout: 4000
                });
                
                console.log(`✅ ¡CONECTADO!: ${url}`);
                return url;
            } catch (e) {
                const status = e.response ? e.response.status : 'timeout';
                console.log(`❌ Fallo en ${server}: ${status}`); 
                // Si sale 403 = IP Bloqueada o Token malo
                // Si sale 404 = URL incorrecta
            }
        }
    }
    throw new Error("Imposible conectar");
}

// 3. RUTAS EXPRESS
app.get("/", (req, res) => res.send("✅ V9 Activo"));

app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.adrian.carrera.v9",
        version: "3.3.0",
        name: "Carrera Viva (No Cookie)",
        resources: ["catalog", "meta", "stream"],
        types: ["tv"],
        catalogs: [{ type: "tv", id: "carrera_catalog", name: "Carrera TV" }]
    });
});

app.get("/catalog/tv/carrera_catalog.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ metas: [{ id: "carrera_viva", type: "tv", name: "Carrera Viva", poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg" }] });
});

app.get("/meta/tv/carrera_viva.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ meta: { id: "carrera_viva", type: "tv", name: "Carrera Viva", poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg" } });
});

app.get("/stream/tv/carrera_viva.json", async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "🔴 LIVE | No-Cookie", url: `${BASE_URL}/playlist.m3u8` }] });
});

// 4. PROXY (SIN COOKIES)
app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        const targetUrl = await getWorkingStreamUrl(token);
        
        console.log(`🔌 Streaming: ${targetUrl}`);

        const response = await axios.get(targetUrl, {
            headers: { 
                "User-Agent": USER_AGENT, 
                "Referer": REFERER, 
                "Authorization": `Bearer ${token}`
            },
            httpsAgent: agent
        });

        let playlist = response.data;
        const encodedToken = encodeURIComponent(token);
        playlist = playlist.replace(/(https?:\/\/[^\s]+)/g, (match) => `${BASE_URL}/segment?target=${encodeURIComponent(match)}&t=${encodedToken}`);

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.set("Access-Control-Allow-Origin", "*");
        res.send(playlist);
    } catch (e) {
        console.error("Playlist Error:", e.message);
        res.status(500).send("Error");
    }
});

app.get("/segment", async (req, res) => {
    const { target, t } = req.query;
    if (!target) return res.status(400).send("Bad Request");

    try {
        const response = await axios({
            method: 'get',
            url: target,
            responseType: 'stream',
            headers: { 
                "User-Agent": USER_AGENT, 
                "Referer": REFERER, 
                "Authorization": `Bearer ${t}`
            },
            httpsAgent: agent
        });
        res.set("Content-Type", response.headers["content-type"]);
        res.set("Access-Control-Allow-Origin", "*");
        response.data.pipe(res);
    } catch (e) {
        res.status(500).end();
    }
});

app.listen(PORT, () => console.log(`✅ V9 Corriendo en ${BASE_URL}`));
