const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// Headers estándar para parecer un navegador real
const UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const Referer = "https://epicplayplay.cfd/";

const builder = new addonBuilder({
    id: "org.adrian.carrera.auto",
    version: "1.0.2",
    name: "Carrera Viva (Smart-Link)",
    description: "Con auto-token y server-lookup dinámico",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs: [
        {
            type: "tv",
            id: "carrera_catalog",
            name: "Carrera TV",
            extra: [{ name: "search", isRequired: false }]
        }
    ]
});

// --- MENU (Igual que antes) ---
builder.defineCatalogHandler((args) => {
    if (args.id === "carrera_catalog") {
        return Promise.resolve({
            metas: [{
                id: "carrera_viva_channel",
                type: "tv",
                name: "Carrera Viva Directo",
                poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
                description: "Emisión en directo F1"
            }]
        });
    }
    return Promise.resolve({ metas: [] });
});

builder.defineMetaHandler((args) => {
    if (args.id === "carrera_viva_channel") {
        return Promise.resolve({
            meta: {
                id: "carrera_viva_channel",
                type: "tv",
                name: "Carrera Viva Directo",
                poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
                background: "https://img.freepik.com/foto-gratis/coche-carreras-pista_1048-5244.jpg",
            }
        });
    }
    return Promise.resolve({ meta: {} });
});

// --- LÓGICA DEL STREAM (Aquí está la mejora) ---
const TARGET_URL = "https://epicplayplay.cfd/premiumtv/daddyhd.php?id=premium537";
const CHANNEL_ID = "premium537"; // El ID del canal que vimos en el HTML

builder.defineStreamHandler(async (args) => {
    if (args.id === "carrera_viva_channel") {
        try {
            console.log("🚀 Iniciando proceso de extracción...");

            // PASO 1: Obtener el TOKEN de la web HTML
            // ------------------------------------------------
            const responseHtml = await axios.get(TARGET_URL, {
                headers: { "User-Agent": UserAgent, "Referer": Referer }
            });
            const html = responseHtml.data;

            // Regex mejorado: Busca exactamente 'const AUTH_TOKEN = "..."'
            // Esto es mucho más preciso que buscar solo "Bearer"
            const tokenRegex = /const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/;
            const matchToken = html.match(tokenRegex);

            if (!matchToken) {
                console.error("❌ ERROR CRÍTICO: No encontré el AUTH_TOKEN en el HTML.");
                // Intentamos un plan B de regex por si acaso
                const fallbackRegex = /Bearer\s+(eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+)/;
                const matchFallback = html.match(fallbackRegex);
                if (!matchFallback) throw new Error("Token no encontrado ni con plan A ni B");
                var freshToken = matchFallback[1];
            } else {
                var freshToken = matchToken[1];
            }
            console.log("✅ Token encontrado (inicio):", freshToken.substring(0, 10) + "...");


            // PASO 2: Preguntar qué SERVIDOR usar (Server Lookup)
            // ------------------------------------------------
            // La web hace esto: fetch('https://chevy.giokko.ru/server_lookup?channel_id=premium537')
            console.log("🌍 Consultando servidor activo...");
            const lookupUrl = `https://chevy.giokko.ru/server_lookup?channel_id=${CHANNEL_ID}`;
            
            const responseLookup = await axios.get(lookupUrl, {
                headers: { "User-Agent": UserAgent, "Referer": Referer }
            });
            
            const serverKey = responseLookup.data.server_key; // Ej: "dokko1" o "top1"
            console.log("✅ Servidor activo hoy:", serverKey);

            // PASO 3: Construir la URL final del video
            // ------------------------------------------------
            // Lógica extraída del script original:
            // si es 'top1/cdn' -> usa top1.kiko2.ru
            // si no -> usa [serverKey]new.kiko2.ru
            
            let finalUrl = "";
            if (serverKey === 'top1/cdn') {
                finalUrl = `https://top1.kiko2.ru/top1/cdn/${CHANNEL_ID}/mono.css`;
            } else {
                finalUrl = `https://${serverKey}new.kiko2.ru/${serverKey}/${CHANNEL_ID}/mono.css?.m3u8`;
            }

            console.log("🔗 URL Generada:", finalUrl);

            // PASO 4: Devolver a Stremio
            // ------------------------------------------------
            return {
                streams: [
                    {
                        title: `🔴 LIVE | ${serverKey} | 1080p`,
                        url: finalUrl,
                        behaviorHints: {
                            notWebReady: true,
                            proxyHeaders: {
                                "request": {
                                    "Authorization": `Bearer ${freshToken}`,
                                    "Referer": Referer,
                                    "Origin": "https://epicplayplay.cfd",
                                    "User-Agent": UserAgent
                                }
                            }
                        }
                    }
                ]
            };

        } catch (error) {
            console.error("❌ ERROR:", error.message);
            // Si falla, mostramos un error en Stremio
            return { streams: [{ title: "⚠️ Error: " + error.message, url: "" }] };
        }
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
