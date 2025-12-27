const express = require("express");
const cors = require("cors");
const axios = require("axios");
const https = require("https");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// CAMBIO CLAVE: Usamos el dominio principal de la red DaddyLive
const REFERER = "https://thedaddy.to/";
const ORIGIN = "https://thedaddy.to";
const CHANNEL_ID = "premium537";

const agent = new https.Agent({ rejectUnauthorized: false });

// 1. OBTENER TOKEN
async function getToken() {
    try {
        // Hacemos la petición fingiendo venir de DaddyLive
        const response = await axios.get(`https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${CHANNEL_ID}`, {
            headers: { 
                "User-Agent": USER_AGENT, 
                "Referer": REFERER,
                "Origin": ORIGIN
            },
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

// 2. BUSCADOR DE URL
async function getWorkingStreamUrl(token) {
    let servers = [];
    try {
        const lookup = await axios.get(`https://chevy.giokko.ru/server_lookup?channel_id=${CHANNEL_ID}`, {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERER, "Origin": ORIGIN },
            httpsAgent: agent
        });
        if(lookup.data.server_key) servers.push(lookup.data.server_key);
    } catch (e) {}

    const allServers = [...new Set([...servers, "dokko1", "dokko2", "top1", "chevy"])];

    for (const server of allServers) {
        let urls = [];
        const clean = server.replace("/cdn", "");
        
        // Probamos las dos variantes de URL conocidas
        urls.push(`https://${clean}new.kiko2.ru/${clean}/${CHANNEL_ID}/mono.css?.m3u8`);
        urls.push(`https://${clean}.kiko2.ru/${clean}/cdn/${CHANNEL_ID}/mono.css`);

        for (const url of urls) {
            try {
                // RESTAURAMOS LA COOKIE (A veces es necesaria si el referer es correcto)
                await axios.head(url, {
                    headers: { 
                        "User-Agent": USER_AGENT, 
                        "Referer": REFERER,
                        "Origin": ORIGIN,
                        "Authorization": `Bearer ${token}`,
                        "Cookie": `eplayer_session=${token}`
                    },
                    httpsAgent: agent,
                    timeout: 3500
                });
                console.log(`✅ CONEXIÓN EXITOSA: ${url}`);
                return url;
            } catch (e) {
                // Ignoramos errores para seguir probando
            }
        }
    }
    throw new Error("Bloqueo de IP detectado");
}

// 3. RUTAS EXPRESS
app.get("/", (req, res) => res.send("✅ V10 Activo (Referer DaddyLive)"));

app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.adrian.carrera.v10",
        version: "3.4.0",
        name: "Carrera Viva (Cloud Bypass)",
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
    res.json({ streams: [{ title: "🔴 LIVE | Cloud-Bypass", url: `${BASE_URL}/playlist.m3u8` }] });
});

// 4. PROXY
app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        const targetUrl = await getWorkingStreamUrl(token);
        
        console.log(`🔌 Streaming: ${targetUrl}`);

        const response = await axios.get(targetUrl, {
            headers: { 
                "User-Agent": USER_AGENT, 
                "Referer": REFERER, 
                "Origin": ORIGIN,
                "Authorization": `Bearer ${token}`,
                "Cookie": `eplayer_session=${token}`
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
        console.error("Proxy Error:", e.message);
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
                "Origin": ORIGIN,
                "Authorization": `Bearer ${t}`,
                "Cookie": `eplayer_session=${t}`
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

app.listen(PORT, () => console.log(`✅ V10 Corriendo en ${BASE_URL}`));
