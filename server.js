const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { addonBuilder } = require("stremio-addon-sdk");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;
// Detectar URL de Render o usar localhost
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://epicplayplay.cfd/";

// ==========================================
// 1. LÓGICA DEL PROXY (Robar el video)
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
        
        if (!match) throw new Error("No token found in HTML");
        
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
// 2. DEFINICIÓN DEL ADDON
// ==========================================
const builder = new addonBuilder({
    id: "org.adrian.carrera.proxy",
    version: "2.2.0",
    name: "Carrera Viva (Proxy V4)",
    description: "Proxy Tunneling Final",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs: [{ type: "tv", id: "carrera_catalog", name: "Carrera TV" }]
});

builder.defineCatalogHandler((args) => {
    return Promise.resolve({
        metas: [{
            id: "carrera_viva",
            type: "tv",
            name: "Carrera Viva (Proxy)",
            poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
            description: "Live Proxy Mode"
        }]
    });
});

builder.defineMetaHandler((args) => {
    return Promise.resolve({
        meta: {
            id: "carrera_viva",
            type: "tv",
            name: "Carrera Viva (Proxy)",
            poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg"
        }
    });
});

builder.defineStreamHandler(async (args) => {
    if (args.id === "carrera_viva") {
        const myUrl = `${BASE_URL}/playlist.m3u8`;
        return { streams: [{ title: "🔴 LIVE | Proxy Mode", url: myUrl }] };
    }
    return { streams: [] };
});

const addonInterface = builder.getInterface();

// ==========================================
// 3. RUTAS EXPRESS (La solución al Error 500)
// ==========================================

// A. Ruta Base (Para que no de error al entrar al link principal)
app.get("/", (req, res) => {
    res.send("✅ Servidor Activo. Copia el link y añade /manifest.json para Stremio.");
});

// B. Ruta del Manifiesto (Stremio la pide primero)
app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(addonInterface.manifest);
});

// C. Ruta para Catalog, Meta y Stream (Stremio las pide después)
app.get("/:resource/:type/:id/:extra?.json", (req, res, next) => {
    const { resource, type, id, extra } = req.params;
    
    // Si la ruta es playlist.m3u8, pasa al siguiente manejador (el proxy)
    if (resource === 'playlist.m3u8' || resource === 'segment') {
        return next();
    }

    const args = {
        resource,
        type,
        id,
        extra: extra ? JSON.parse(decodeURIComponent(extra)) : {}
    };

    addonInterface.get(args)
        .then(resp => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.json(resp);
        })
        .catch(err => {
            console.error("Error en Addon Handler:", err);
            res.status(500).json({ error: "Internal Error" });
        });
});

// D. RUTAS DEL PROXY DE VIDEO (Donde ocurre la magia)
app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        const targetUrl = await getServerUrl();
        
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
        console.error("Proxy Segment Error:", e.message);
        res.status(500).send("Error fetching segment");
    }
});

// Arrancar servidor
app.listen(PORT, () => {
    console.log(`✅ Add-on Proxy V4 corriendo en ${BASE_URL}`);
});
