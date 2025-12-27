const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { addonBuilder } = require("stremio-addon-sdk");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://epicplayplay.cfd/";

// ==========================================
// 1. LÓGICA DEL PROXY (Igual que antes)
// ==========================================
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) return cachedToken;
    console.log("🔄 Renovando Token...");
    try {
        const response = await axios.get("https://epicplayplay.cfd/premiumtv/daddyhd.php?id=premium537", {
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

async function getServerUrl() {
    try {
        const lookup = await axios.get("https://chevy.giokko.ru/server_lookup?channel_id=premium537", {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERER }
        });
        const key = lookup.data.server_key;
        if (key === 'top1/cdn') return `https://top1.kiko2.ru/top1/cdn/premium537/mono.css`;
        return `https://${key}new.kiko2.ru/${key}/premium537/mono.css?.m3u8`;
    } catch (e) {
        console.error("Lookup failed:", e.message);
        return "https://dokko1new.kiko2.ru/dokko1/premium537/mono.css?.m3u8";
    }
}

// ==========================================
// 2. DEFINICIÓN DEL MANIFIESTO
// ==========================================
// Solo usamos el builder para generar el JSON del manifiesto, no para manejar rutas.
const builder = new addonBuilder({
    id: "org.adrian.carrera.manual",
    version: "3.0.0",
    name: "Carrera Viva (Final)",
    description: "Conexión directa V5",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs: [{ type: "tv", id: "carrera_catalog", name: "Carrera TV" }]
});

const MANIFEST = builder.getInterface().manifest;

// ==========================================
// 3. RUTAS EXPRESS MANUALES (Aquí arreglamos el error)
// ==========================================

// A. Ruta Base
app.get("/", (req, res) => {
    res.send("✅ Servidor V5 Activo. Añade /manifest.json en Stremio.");
});

// B. Ruta Manifiesto
app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(MANIFEST);
});

// C. Ruta CATÁLOGO (Lo que muestra el icono en el menú)
// Stremio pide: /catalog/tv/carrera_catalog.json
app.get("/catalog/tv/carrera_catalog.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        metas: [{
            id: "carrera_viva",
            type: "tv",
            name: "Carrera Viva (Directo)",
            poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
            description: "Emisión en directo vía Proxy"
        }]
    });
});

// D. Ruta META (Detalles al hacer clic)
// Stremio pide: /meta/tv/carrera_viva.json
app.get("/meta/tv/carrera_viva.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        meta: {
            id: "carrera_viva",
            type: "tv",
            name: "Carrera Viva (Directo)",
            poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
            background: "https://img.freepik.com/foto-gratis/coche-carreras-pista_1048-5244.jpg",
            description: "Canal en vivo con bypass de seguridad."
        }
    });
});

// E. Ruta STREAM (El enlace del video)
// Stremio pide: /stream/tv/carrera_viva.json
app.get("/stream/tv/carrera_viva.json", async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Aquí generamos el enlace que pasa por NUESTRO proxy
    const myUrl = `${BASE_URL}/playlist.m3u8`;
    
    res.json({
        streams: [{
            title: "🔴 LIVE | 1080p | Proxy Mode",
            url: myUrl
        }]
    });
});

// ==========================================
// 4. RUTAS DEL PROXY (Video Real)
// ==========================================

app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        const targetUrl = await getServerUrl();
        
        console.log(`🔌 Conectando a: ${targetUrl}`); // Log para ver qué pasa

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
        
        // Reemplazar enlaces rusos por enlaces a nuestro servidor
        playlist = playlist.replace(/(https?:\/\/[^\s]+)/g, (match) => {
            return `${BASE_URL}/segment?target=${encodeURIComponent(match)}&t=${encodedToken}`;
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.set("Access-Control-Allow-Origin", "*");
        res.send(playlist);
    } catch (e) {
        console.error("Proxy Playlist Error:", e.message);
        res.status(500).send("Error generating playlist");
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
        // console.error("Segment Error"); // Descomentar solo si hay muchos fallos
        res.status(500).send("Error");
    }
});

app.listen(PORT, () => {
    console.log(`✅ Servidor V5 Manual corriendo en ${BASE_URL}`);
});
