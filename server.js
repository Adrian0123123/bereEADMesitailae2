const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const builder = new addonBuilder({
    id: "org.adrian.carrera.auto",
    version: "1.0.0",
    name: "Carrera Viva (Auto-Renew)",
    resources: ["stream"],
    types: ["tv"],
    catalogs: []
});

// URL exacta de donde sacaste el código HTML
const TARGET_URL = "https://epicplayplay.cfd/premiumtv/daddyhd.php?id=premium537"; // Asegúrate de que esta URL es la correcta

builder.defineStreamHandler(async (args) => {
    if (args.type === "tv" && args.id === "carrera_viva") {
        try {
            console.log("🔄 Solicitando nuevo token a la web original...");
            
            // 1. Visitamos la web como si fuéramos un navegador
            const response = await axios.get(TARGET_URL, {
                headers: {
                    "User-Agent": UserAgent,
                    "Referer": "https://epicplayplay.cfd/"
                }
            });

            const html = response.data;

            // 2. Usamos una expresión regular para CAZAR el token JWT
            // Buscamos el patrón "eyJ..." típico de los tokens
            const tokenRegex = /Bearer\s+(eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+)/;
            const match = html.match(tokenRegex) || html.match(/AUTH_TOKEN\s*=\s*"([^"]+)"/);

            if (!match) {
                console.error("❌ No se pudo encontrar el token en el HTML");
                return { streams: [] };
            }

            const token = match[1];
            console.log("✅ Token fresco conseguido:", token.substring(0, 20) + "...");

            // 3. Devolvemos el stream a Stremio con el token nuevo
            return {
                streams: [
                    {
                        title: "🟢 LIVE | 1080p | Auto-Token",
                        url: "https://dokko1new.kiko2.ru/dokko1/premium537/mono.css?.m3u8", // Nota: A veces el subdominio 'dokko1new' cambia, lo ideal sería extraerlo también del HTML.
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
