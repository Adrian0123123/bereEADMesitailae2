const express = require("express");
const cors = require("cors");
const axios = require("axios");
const https = require("https"); // Para saltar errores de certificado SSL

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// USER AGENT REAL DE CHROME WINDOWS
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Lista de referers permitidos (si uno falla, probamos otro)
const REFERERS = [
    "https://epicplayplay.cfd/",
    "https://thedaddy.to/",
    "https://daddylive.mp/"
];

const CHANNEL_ID = "premium537";

// Agente HTTPS que ignora certificados raros (común en servidores rusos)
const agent = new https.Agent({  
  rejectUnauthorized: false
});

// ==========================================
// 1. GESTIÓN DE TOKENS
// ==========================================
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) return cachedToken;
    
    console.log("🔄 Renovando Token...");
    try {
        // Usamos el primer referer para obtener el token
        const response = await axios.get(`https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${CHANNEL_ID}`, {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERERS[0] },
            httpsAgent: agent
        });
        
        const html = response.data;
        // Regex mejorada para capturar cualquier variación
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || 
                      html.match(/Bearer\s+(eyJ[^"']+)/) ||
                      html.match(/token\s*:\s*["'](eyJ[^"']+)["']/);
        
        if (!match) throw new Error("No se pudo extraer el token del HTML");
        
        cachedToken = match[1];
        tokenExpiry = now + (10 * 60 * 1000); 
        return cachedToken;
    } catch (e) {
        console.error("❌ Error obteniendo token:", e.message);
        return cachedToken || ""; 
    }
}

// ==========================================
// 2. BUSCADOR DE SERVIDOR (BRUTE FORCE)
// ==========================================
const SERVERS_LIST = [
    "dokko1", "dokko2", "dokko3", "dokko4", // Servidores dokko
    "top1", "top2",                         // Servidores top
    "chevy", "ford"                         // Servidores antiguos
];

async function getWorkingStreamUrl(token) {
    // 1. Intentamos consultar el Lookup oficial primero
    let prioritizedServers = [];
    try {
        const lookup = await axios.get(`https://chevy.giokko.ru/server_lookup?channel_id=${CHANNEL_ID}`, {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERERS[0], "Origin": REFERERS[0] },
            httpsAgent: agent
        });
        if(lookup.data && lookup.data.server_key) {
            console.log(`ℹ️ Lookup oficial dice: ${lookup.data.server_key}`);
            prioritizedServers.push(lookup.data.server_key);
        }
    } catch (e) {
        console.log("⚠️ Lookup oficial falló, usando fuerza bruta.");
    }

    // Combinamos oficial + lista manual
    const candidates = [...new Set([...prioritizedServers, ...SERVERS_LIST])];
    
    console.log(`🔎 Iniciando escaneo de servidores...`);

    for (const server of candidates) {
        // Construimos 2 variantes de URL por cada servidor
        let urlsToTry = [];
        
        // Variante A: dokko1new.kiko2.ru
        const cleanServer = server.replace("/cdn", "");
        urlsToTry.push(`https://${cleanServer}new.kiko2.ru/${cleanServer}/${CHANNEL_ID}/mono.css?.m3u8`);
        
        // Variante B: top1.kiko2.ru (Sin 'new')
        urlsToTry.push(`https://${cleanServer}.kiko2.ru/${cleanServer}/cdn/${CHANNEL_ID}/mono.css`);

        for (const testUrl of urlsToTry) {
            try {
                // Probamos con HEAD para ser rápidos
                await axios.head(testUrl, {
                    headers: { 
                        "User-Agent": USER_AGENT, 
                        "Referer": REFERERS[0],
                        "Origin": REFERERS[0],
                        "Authorization": `Bearer ${token}`
                    },
                    httpsAgent: agent,
                    timeout: 2500
                });
                
                console.log(`✅ ¡BINGO! Servidor encontrado: ${testUrl}`);
                return testUrl; // Retornamos la primera que funcione
            } catch (e) {
                // Si falla, solo logueamos en modo debug corto
                // console.log(`❌ Falló: ${testUrl} (${e.response?.status || 'timeout'})`);
            }
        }
    }

    console.error("❌ TODOS los servidores fallaron.");
    throw new Error("Stream offline o bloqueado");
}

// ==========================================
// 3. RUTAS EXPRESS
// ==========================================

app.get("/", (req, res) => res.send("✅ Proxy V8 Activo."));

app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.adrian.carrera.v8",
        version: "3.2.0",
        name: "Carrera Viva (BruteForce)",
        description: "Búsqueda intensiva de servidores",
        logo: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
        resources: ["catalog", "meta", "stream"],
        types: ["tv"],
        catalogs: [{ type: "tv", id: "carrera_catalog", name: "Carrera TV" }]
    });
});

app.get("/catalog/tv/carrera_catalog.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ metas: [{ id: "carrera_viva", type: "tv", name: "Carrera Viva (F1)", poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg" }] });
});

app.get("/meta/tv/carrera_viva.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ meta: { id: "carrera_viva", type: "tv", name: "Carrera Viva (F1)", poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg" } });
});

app.get("/stream/tv/carrera_viva.json", async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "🔴 LIVE | Auto-Scan | 1080p", url: `${BASE_URL}/playlist.m3u8` }] });
});

// ==========================================
// 4. PROXY DE VIDEO (FINAL)
// ==========================================

app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        // Buscamos la URL válida
        const targetUrl = await getWorkingStreamUrl(token);
        
        console.log(`🔌 Streaming desde: ${targetUrl}`);

        const response = await axios.get(targetUrl, {
            headers: { 
                "User-Agent": USER_AGENT, 
                "Referer": REFERERS[0], 
                "Authorization": `Bearer ${token}`,
                "Cookie": `eplayer_session=${token}` // Importante para dokko servers
            },
            httpsAgent: agent
        });

        let playlist = response.data;
        const encodedToken = encodeURIComponent(token);
        
        // Reescritura de segmentos
        playlist = playlist.replace(/(https?:\/\/[^\s]+)/g, (match) => {
            return `${BASE_URL}/segment?target=${encodeURIComponent(match)}&t=${encodedToken}`;
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.set("Access-Control-Allow-Origin", "*");
        res.send(playlist);

    } catch (e) {
        console.error("Playlist Error (Final):", e.message);
        res.status(500).send("#EXTM3U\n#EXT-X-ERROR: Stream Offline");
    }
});

app.get("/segment", async (req, res) => {
    const { target, t } = req.query;
    if (!target) return res.status(400).send("Bad Request");

    try {
        // Rotamos referers si falla (básico)
        const response = await axios({
            method: 'get',
            url: target,
            responseType: 'stream',
            headers: { 
                "User-Agent": USER_AGENT, 
                "Referer": REFERERS[0], 
                "Authorization": `Bearer ${t}`,
                "Cookie": `eplayer_session=${t}`
            },
            httpsAgent: agent
        });
        
        res.set("Content-Type", response.headers["content-type"]);
        res.set("Access-Control-Allow-Origin", "*");
        response.data.pipe(res);
    } catch (e) {
        // Silencioso para no saturar logs
        res.status(500).end();
    }
});

app.listen(PORT, () => {
    console.log(`✅ Servidor V8 (BruteForce) corriendo en ${BASE_URL}`);
});
