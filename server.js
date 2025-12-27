const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const builder = new addonBuilder({
    id: "org.adrian.carrera.auto",
    version: "1.0.1", // He subido la versión
    name: "Carrera Viva (Auto-Renew)",
    description: "Canal directo con auto-token",
    resources: ["catalog", "meta", "stream"], // Añadido catalog y meta
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

// --- 1. CONFIGURACIÓN DEL MENÚ (CATÁLOGO) ---
// Esto hace que aparezca el icono en Stremio
builder.defineCatalogHandler((args) => {
    // Si entran en la sección de tu addon, mostramos el canal
    if (args.id === "carrera_catalog") {
        return Promise.resolve({
            metas: [
                {
                    id: "carrera_viva_channel",
                    type: "tv",
                    name: "Carrera Viva Directo",
                    poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg", // Puedes cambiar esta foto
                    description: "Emisión en directo con token dinámico."
                }
            ]
        });
    }
    return Promise.resolve({ metas: [] });
});

// --- 2. CONFIGURACIÓN DE DETALLES (META) ---
// Esto muestra la info cuando haces clic en el poster
builder.defineMetaHandler((args) => {
    if (args.id === "carrera_viva_channel") {
        return Promise.resolve({
            meta: {
                id: "carrera_viva_channel",
                type: "tv",
                name: "Carrera Viva Directo",
                poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg",
                background: "https://img.freepik.com/foto-gratis/coche-carreras-pista_1048-5244.jpg",
                description: "Emisión exclusiva en directo.",
                releaseInfo: "2024-2025",
            }
        });
    }
    return Promise.resolve({ meta: {} });
});

// --- 3. CONFIGURACIÓN DEL VIDEO (STREAM) ---
// Aquí es donde robamos el token
const TARGET_URL = "https://epicplayplay.cfd/premiumtv/daddyhd.php?id=premium537";

builder.defineStreamHandler(async (args) => {
    if (args.id === "carrera_viva_channel") {
        try {
            console.log("🔄 Solicitando nuevo token a la web original...");
            
            // A. Visitamos la web
            const response = await axios.get(TARGET_URL, {
                headers: {
                    "User-Agent": UserAgent,
                    "Referer": "https://epicplayplay.cfd/"
                }
            });

            const html = response.data;

            // B. Buscamos el token con Regex
            const tokenRegex = /Bearer\s+(eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+)/;
            const match = html.match(tokenRegex) || html.match(/AUTH_TOKEN\s*=\s*"([^"]+)"/);

            if (!match) {
                console.error("❌ No se pudo encontrar el token en el HTML");
                return { streams: [] }; // Devolver vacío si falla
            }

            const token = match[1];
            console.log("✅ Token fresco:", token.substring(0, 15) + "...");

            // C. Devolvemos el stream
            return {
                streams: [
                    {
                        title: "🔴 LIVE | 1080p | Auto-Renew",
                        url: "https://dokko1new.kiko2.ru/dokko1/premium537/mono.css?.m3u8",
                        behaviorHints: {
                            notWebReady: true,
                            proxyHeaders: {
                                "request": {
                                    "Authorization": `Bearer ${token}`,
                                    "Referer": "https://epicplayplay.cfd/",
                                    "Origin": "https://epicplayplay.cfd",
                                    "User-Agent": UserAgent
                                }
                            }
                        }
                    }
                ]
            };

        } catch (error) {
            console.error("Error obteniendo el stream:", error.message);
            return { streams: [] };
        }
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
