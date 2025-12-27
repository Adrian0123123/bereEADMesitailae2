const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// Headers "Fijos" para simular ser un PC con Windows
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://epicplayplay.cfd/";
const ORIGIN = "https://epicplayplay.cfd";

const builder = new addonBuilder({
    id: "org.adrian.carrera.final",
    version: "1.0.3",
    name: "Carrera Viva (Full Headers)",
    description: "Con inyección completa de headers y cookies",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs: [{
        type: "tv",
        id: "carrera_catalog",
        name: "Carrera TV",
        extra: [{ name: "search", isRequired: false }]
    }]
});

// --- MENÚ Y DETALLES (Igual que antes) ---
builder.defineCatalogHandler((args) => {
    if (args.id === "carrera_catalog") {
        return Promise.resolve({
            metas: [{
                id: "carrera_viva_channel",
                type: "tv",
                name: "Carrera Viva Directo",
                poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
                description: "Emisión Directa F1"
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

// --- GENERADOR DE CLIENT TOKEN FALSO ---
// El servidor pide una "huella digital". Vamos a crear una falsa pero válida.
function generateFakeClientToken(channelKey) {
    // Simulamos los datos que usa el script original para crear el token
    const ts = Math.floor(Date.now() / 1000) + 3600; // Timestamp futuro
    const screen = "1920x1080";
    const fingerprint = `${USER_AGENT}|${screen}|UTC|en-US`;
    const signData = `${channelKey}|ES|${ts}|${USER_AGENT}|${fingerprint}`;
    // Convertimos a Base64 (btoa en navegador, Buffer en Node)
    return Buffer.from(signData).toString('base64');
}

// --- LÓGICA DEL STREAM ---
const TARGET_URL = "https://epicplayplay.cfd/premiumtv/daddyhd.php?id=premium537";
const CHANNEL_ID = "premium537"; 

builder.defineStreamHandler(async (args) => {
    if (args.id === "carrera_viva_channel") {
        try {
            console.log("🚀 Iniciando extracción V3 (Full Headers)...");

            // 1. Obtener HTML y Token
            const responseHtml = await axios.get(TARGET_URL, {
                headers: { "User-Agent": USER_AGENT, "Referer": REFERER }
            });
            const html = responseHtml.data;

            // Regex para buscar el Token
            const tokenRegex = /const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/;
            const matchToken = html.match(tokenRegex) || html.match(/Bearer\s+(eyJ[^"']+)/);
            
            if (!matchToken) throw new Error("No se encontró el Token");
            const freshToken = matchToken[1];
            console.log("✅ Token:", freshToken.substring(0, 10) + "...");

            // 2. Server Lookup
            const lookupUrl = `https://chevy.giokko.ru/server_lookup?channel_id=${CHANNEL_ID}`;
            const responseLookup = await axios.get(lookupUrl, {
                headers: { "User-Agent": USER_AGENT, "Referer": REFERER }
            });
            const serverKey = responseLookup.data.server_key;
            console.log("✅ Servidor:", serverKey);

            // 3. Construir URL
            let finalUrl = "";
            if (serverKey === 'top1/cdn') {
                finalUrl = `https://top1.kiko2.ru/top1/cdn/${CHANNEL_ID}/mono.css`;
            } else {
                finalUrl = `https://${serverKey}new.kiko2.ru/${serverKey}/${CHANNEL_ID}/mono.css?.m3u8`;
            }

            // 4. Generar Credenciales Extra (Aquí estaba el fallo antes)
            const fakeClientToken = generateFakeClientToken(CHANNEL_ID);

            // 5. Devolver Stream con TODOS los headers
            return {
                streams: [
                    {
                        title: `🔴 LIVE | ${serverKey} | 1080p`,
                        url: finalUrl,
                        behaviorHints: {
                            notWebReady: true,
                            // Stremio a veces ignora proxyHeaders en Android, pero es nuestra mejor baza
                            proxyHeaders: {
                                "request": {
                                    "Authorization": `Bearer ${freshToken}`,
                                    "X-Channel-Key": CHANNEL_ID,
                                    "X-Client-Token": fakeClientToken,
                                    "X-User-Agent": USER_AGENT,
                                    "Cookie": `eplayer_session=${freshToken}`, // ¡CRÍTICO!
                                    "Referer": REFERER,
                                    "Origin": ORIGIN,
                                    "User-Agent": USER_AGENT
                                }
                            }
                        }
                    }
                ]
            };

        } catch (error) {
            console.error("❌ ERROR:", error.message);
            return { streams: [] };
        }
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
