const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://epicplayplay.cfd/";
const CHANNEL_ID = "premium537";

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
        const response = await axios.get(`https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${CHANNEL_ID}`, {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERER }
        });
        const html = response.data;
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || html.match(/Bearer\s+(eyJ[^"']+)/);
        
        if (!match) throw new Error("No token found");
        
        cachedToken = match[1];
        tokenExpiry = now + (10 * 60 * 1000); 
        return cachedToken;
    } catch (e) {
        console.error("Error getting token:", e.message);
        return cachedToken || ""; 
    }
}

// ==========================================
// 2. BUSCADOR DE SERVIDOR (LA MEJORA V7)
// ==========================================
// Si el servidor oficial falla, probamos estos de reserva
const FALLBACK_SERVERS = [
    "dokko1", "dokko2", "dokko3", "top1", "chevy"
];

async function getWorkingStreamUrl(token) {
    // 1. Preguntar al servidor oficial cuál toca hoy
    let candidates = [];
    try {
        const lookup = await axios.get(`https://chevy.giokko.ru/server_lookup?channel_id=${CHANNEL_ID}`, {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERER }
        });
        const key = lookup.data.server_key;
        if(key) candidates.push(key);
    } catch (e) {
        console.log("⚠️ Lookup falló, usando lista de reserva...");
    }

    // Añadimos los de reserva por si el oficial miente o falla
    candidates = [...candidates, ...FALLBACK_SERVERS];
    // Eliminamos duplicados
    candidates = [...new Set(candidates)];

    console.log(`🔎 Probando servidores: ${candidates.join(", ")}`);

    // 2. Probar uno por uno hasta que uno responda 200 OK
    for (const server of candidates) {
        let testUrl = "";
        if (server === 'top1' || server === 'top1/cdn') {
            testUrl = `https://top1.kiko2.ru/top1/cdn/${CHANNEL_ID}/mono.css`;
        } else {
            // Limpiamos el nombre por si viene sucio
            const cleanServer = server.replace("/cdn", "");
            testUrl = `https://${cleanServer}new.kiko2.ru/${cleanServer}/${CHANNEL_ID}/mono.css?.m3u8`;
        }

        try {
            // Hacemos una petición ligera (HEAD o GET con rango pequeño) para ver si existe
            await axios.get(testUrl, {
                headers: { 
                    "User-Agent": USER_AGENT, 
                    "Referer": REFERER,
                    "Authorization": `Bearer ${token}`,
                    "Cookie": `eplayer_session=${token}`
                },
                timeout: 3000 // Solo esperamos 3 segundos por servidor
            });
            
            console.log(`✅ Servidor encontrado: ${server}`);
            return testUrl; // ¡Encontrado! Devolvemos este.
        } catch (e) {
            console.log(`❌ ${server} falló (${e.response ? e.response.status : 'timeout'})`);
            // Si falla, el bucle continúa con el siguiente
        }
    }

    throw new Error("Ningún servidor funciona ahora mismo");
}

// ==========================================
// 3. DEFINICIÓN DEL MANIFIESTO
// ==========================================
const MANIFEST = {
    id: "org.adrian.carrera.v7",
    version: "3.1.0",
    name: "Carrera Viva (Smart Failover)",
    description: "Conexión V7 con búsqueda automática",
    logo: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs: [{ type: "tv", id: "carrera_catalog", name: "Carrera TV" }]
};

// ==========================================
// 4. RUTAS EXPRESS
// ==========================================

app.get("/", (req, res) => {
    res.send("✅ Servidor V7 Activo (Smart Failover). Añade /manifest.json en Stremio.");
});

app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(MANIFEST);
});

app.get("/catalog/tv/carrera_catalog.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        metas: [{
            id: "carrera_viva",
            type: "tv",
            name: "Carrera Viva (F1)",
            poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
            description: "Directo con búsqueda automática de señal."
        }]
    });
});

app.get("/meta/tv/carrera_viva.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        meta: {
            id: "carrera_viva",
            type: "tv",
            name: "Carrera Viva (F1)",
            poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
            background: "https://img.freepik.com/foto-gratis/coche-carreras-pista_1048-5244.jpg"
        }
    });
});

app.get("/stream/tv/carrera_viva.json", async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const myUrl = `${BASE_URL}/playlist.m3u8`;
    res.json({
        streams: [{
            title: "🔴 LIVE | Auto-Server | 1080p",
            url: myUrl
        }]
    });
});

// ==========================================
// 5. PROXY INTELIGENTE
// ==========================================

app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        // AQUÍ ESTÁ LA MAGIA: Buscamos la URL que sí funciona
        const targetUrl = await getWorkingStreamUrl(token);
        
        console.log(`🔌 Conectando stream real: ${targetUrl}`);

        const response = await axios.get(targetUrl, {
            headers: { 
                "User-Agent": USER_AGENT, 
                "Referer": REFERER, 
                "Authorization": `Bearer ${token}`, 
                "Cookie": `eplayer_session=${token}` 
            }
        });

        let playlist = response.data;
        const encodedToken = encodeURIComponent(token);
        
        playlist = playlist.replace(/(https?:\/\/[^\s]+)/g, (match) => {
            return `${BASE_URL}/segment?target=${encodeURIComponent(match)}&t=${encodedToken}`;
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.set("Access-Control-Allow-Origin", "*");
        res.send(playlist);
    } catch (e) {
        console.error("Playlist Error:", e.message);
        res.status(404).send("#EXTM3U\n#EXT-X-ERROR: Stream not found or offline");
    }
});

app.get("/segment", async (req, res) => {
    const { target, t } = req.query;
    if (!target || !t) return res.status(400).send("Bad Request");

    try {
        const response = await axios({
            method: 'get',
            url: target,
            responseType: 'stream',
            headers: { 
                "User-Agent": USER_AGENT, 
                "Referer": REFERER, 
                "Authorization": `Bearer ${t}`, 
                "Cookie": `eplayer_session=${t}` 
            }
        });
        
        res.set("Content-Type", response.headers["content-type"]);
        res.set("Access-Control-Allow-Origin", "*");
        response.data.pipe(res);
    } catch (e) {
        // console.error("Seg Error");
        res.status(500).end();
    }
});

app.listen(PORT, () => {
    console.log(`✅ Servidor V7 (Smart Failover) corriendo en ${BASE_URL}`);
});
