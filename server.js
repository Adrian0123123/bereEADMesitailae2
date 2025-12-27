const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { addonBuilder } = require("stremio-addon-sdk");

const app = express();
app.use(cors());

// --- CONSTANTES ---
const PORT = process.env.PORT || 7000;
// URL base de tu servidor (Render la asignará automáticamente, pero necesitamos detectarla)
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://epicplayplay.cfd/";

// Cache simple para no pedir el token en cada segmento (dura 10 mins)
let cachedToken = null;
let tokenExpiry = 0;

// --- FUNCIÓN PARA OBTENER EL TOKEN (Scraping) ---
async function getToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) return cachedToken;

    console.log("🔄 Renovando Token...");
    try {
        const response = await axios.get("https://epicplayplay.cfd/premiumtv/daddyhd.php?id=premium537", {
            headers: { "User-Agent": USER_AGENT, "Referer": REFERER }
        });
        
        const html = response.data;
        const tokenRegex = /const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/;
        const match = html.match(tokenRegex) || html.match(/Bearer\s+(eyJ[^"']+)/);
        
        if (!match) throw new Error("No token found");
        
        cachedToken = match[1];
        tokenExpiry = now + (10 * 60 * 1000); // Guardar por 10 min
        return cachedToken;
    } catch (e) {
        console.error("Error getting token:", e.message);
        return cachedToken || ""; // Devolver el viejo si falla
    }
}

// --- FUNCIÓN PARA BUSCAR EL SERVIDOR (Server Lookup) ---
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
        // Fallback por si acaso
        return "https://dokko1new.kiko2.ru/dokko1/premium537/mono.css?.m3u8";
    }
}

// --- CONFIGURACIÓN DEL ADDON ---
const builder = new addonBuilder({
    id: "org.adrian.carrera.proxy",
    version: "2.0.5",
    name: "Carrera Viva (Proxy Mode)",
    description: "Proxy Tunneling para saltar bloqueo 403",
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
            description: "Funciona 100% pasando por Proxy."
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
        // En lugar de dar la URL rusa, damos LA URL DE NUESTRO PROPIO SERVIDOR
        // Stremio -> Render (/playlist.m3u8)
        const myUrl = `${BASE_URL}/playlist.m3u8`;
        return {
            streams: [{
                title: "🔴 LIVE | Proxy Mode",
                url: myUrl
            }]
        };
    }
    return { streams: [] };
});

// --- RUTAS DEL SERVIDOR EXPRESS (LA MAGIA) ---

// 1. Ruta para servir el MANIFEST (lista de reproducción modificada)
app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        const targetUrl = await getServerUrl();
        
        // Descargamos el m3u8 original
        const response = await axios.get(targetUrl, {
            headers: {
                "User-Agent": USER_AGENT,
                "Referer": REFERER,
                "Authorization": `Bearer ${token}`,
                "Cookie": `eplayer_session=${token}`
            }
        });

        let playlist = response.data;

        // REESCRIBIMOS EL M3U8:
        // Buscamos todas las URLs (https://chevy...) y las cambiamos por NUESTRA url (/segment?url=...)
        // Así Stremio nos pedirá los trozos a nosotros, no a los rusos.
        const encodedToken = encodeURIComponent(token);
        
        // Regex para capturar líneas que empiezan por http
        playlist = playlist.replace(/(https?:\/\/[^\s]+)/g, (match) => {
            return `${BASE_URL}/segment?target=${encodeURIComponent(match)}&t=${encodedToken}`;
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.send(playlist);

    } catch (e) {
        console.error("Error proxying playlist:", e.message);
        res.status(500).send("Error fetching playlist");
    }
});

// 2. Ruta para servir los SEGMENTOS (Video)
app.get("/segment", async (req, res) => {
    const target = req.query.target;
    const token = req.query.t;

    if (!target || !token) return res.status(400).send("Missing params");

    try {
        // Hacemos un Stream (tubería) directo desde Rusia a Stremio
        const response = await axios({
            method: 'get',
            url: target,
            responseType: 'stream', // Importante: bajamos el video como flujo de datos
            headers: {
                "User-Agent": USER_AGENT,
                "Referer": REFERER,
                "Authorization": `Bearer ${token}`,
                "Cookie": `eplayer_session=${token}`
            }
        });

        // Copiamos los headers del video original
        res.set("Content-Type", response.headers["content-type"]);
        
        // Conectamos la tubería
        response.data.pipe(res);

    } catch (e) {
        console.error("Error proxying segment:", e.message);
        res.status(500).send("Error fetching segment");
    }
});

// Conectar el SDK de Stremio al servidor Express
const addonInterface = builder.getInterface();
app.use((req, res, next) => {
    if (req.path.startsWith("/playlist") || req.path.startsWith("/segment")) {
        next();
    } else {
        // El resto de rutas las maneja el SDK de Stremio
        addonInterface(req, res, next);
    }
});

app.listen(PORT, () => {
    console.log(`✅ Add-on Proxy corriendo en ${BASE_URL}`);
});
