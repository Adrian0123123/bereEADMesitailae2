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
        // Buscamos el token con varios patrones por seguridad
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || html.match(/Bearer\s+(eyJ[^"']+)/);
        
        if (!match) throw new Error("No token found in HTML");
        
        cachedToken = match[1];
        tokenExpiry = now + (10 * 60 * 1000); // Guardar en memoria 10 min
        return cachedToken;
    } catch (e) {
        console.error("Error getting token:", e.message);
        return cachedToken || ""; // Si falla, intenta devolver el viejo
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
// 2. DEFINICIÓN DEL ADDON (Menú de Stremio)
// ==========================================
const builder = new addonBuilder({
    id: "org.adrian.carrera.proxy",
    version: "2.1.5",
    name: "Carrera Viva (Proxy V3)",
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
        // Aquí redirigimos a NUESTRO servidor proxy
        const myUrl = `${BASE_URL}/playlist.m3u8`;
        return { streams: [{ title: "🔴 LIVE | Proxy Mode", url: myUrl }] };
    }
    return { streams: [] };
});

const addonInterface = builder.getInterface();

// ==========================================
// 3. RUTAS DEL SERVIDOR (Express)
// ==========================================

// A. RUTA BASE
app.get("/", (req, res) => {
    res.send("✅ Servidor Proxy Activo. Usa /manifest.json en Stremio.");
});

// B. RUTAS DEL PROXY (Aquí ocurre la magia del video)
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
        
        // Reemplazamos los links rusos por links a nuestro /segment
        playlist = playlist.replace(/(https?:\/\/[^\s]+)/g, (match) => {
            return `${BASE_URL}/segment?target=${encodeURIComponent(match)}&t=${encodedToken}`;
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
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
        response.data.pipe(res);
    } catch (e) {
        console.error("Proxy Segment Error:", e.message);
        res.status(500).send("Error fetching segment");
    }
});

// C. RUTAS DE STREMIO (Conectadas MANUALMENTE para evitar errores)

// 1. El Manifiesto
app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Importante para Stremio
    res.json(addonInterface.manifest);
});

// 2. Manejador de recursos (Catalog, Meta, Stream)
app.get("/:resource/:type/:id/:extra?.json", (req, res) => {
    const { resource, type, id, extra } = req.params;
    
    // Ignoramos si la ruta choca con playlist.m3u8 (por seguridad)
    if (resource === 'playlist.m3u8') return;

    const args = {
        resource,
        type,
        id,
        extra: extra ? JSON.parse(decodeURIComponent(extra)) : {}
    };

    addonInterface.get(args)
        .then(resp => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (resp.redirect) {
                res.redirect(resp.redirect);
            } else {
                res.json(resp);
            }
        })
        .catch(err => {
            console.error("Addon Handler Error:", err);
            res.status(500).json({ err: "Handler error" });
        });
});

// Arrancar servidor
app.listen(PORT, () => {
    console.log(`✅ Add-on Proxy corriendo en ${BASE_URL}`);
});
