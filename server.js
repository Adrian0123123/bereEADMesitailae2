const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { exec } = require("child_process");
const https = require("https");

const app = express();
app.use(cors());

// EN RENDER, EL PUERTO VIENE EN LA VARIABLE DE ENTORNO
const PORT = process.env.PORT || 7000;

// --- CONFIGURACIÓN EXACTA DE LA V21 LOCAL ---
const TOKEN_ID = "537";           // ID para generar el token (Fix del error E4)
const STREAM_ID = "premium537";   // ID para la lista m3u8
const TARGET_PLAYLIST = `https://dokko1new.kiko2.ru/dokko1/${STREAM_ID}/mono.css`;

// User-Agent idéntico al de Fiddler
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// --- MOTOR CURL (Adaptado para Linux/Render) ---
function runCurl(url, headers = {}) {
    return new Promise((resolve, reject) => {
        // -s: silencioso, -L: seguir redirecciones, --insecure: saltar errores SSL
        let cmd = `curl -s -L --insecure `;
        
        for (const [key, value] of Object.entries(headers)) {
            // Escapamos comillas dobles para que el shell de Linux no explote
            const safeValue = value.replace(/"/g, '\\"');
            cmd += `-H "${key}: ${safeValue}" `;
        }
        
        cmd += `"${url}"`;

        // Aumentamos el buffer para listas grandes
        exec(cmd, { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) { 
                console.error("CURL Error:", stderr ? stderr.toString() : error.message);
                reject(error); 
                return; 
            }
            resolve(stdout);
        });
    });
}

// 1. OBTENER TOKEN (Vía CURL)
async function getToken() {
    try {
        console.log(`☁️ Cloud: Generando token para ID ${TOKEN_ID}...`);
        const buffer = await runCurl(`https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${TOKEN_ID}`, {
            "User-Agent": UA,
            "Referer": "https://epicplayplay.cfd/"
        });
        
        const html = buffer.toString();
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || 
                      html.match(/Bearer\s+(eyJ[^"']+)/);
                      
        if (!match) throw new Error("No se encontró token en la respuesta HTML");
        return match[1];
    } catch (e) {
        console.error("❌ Error Token:", e.message);
        return "";
    }
}

// --- FUNCIÓN PARA DETECTAR LA URL DE RENDER ---
function getBaseUrl(req) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    return `${protocol}://${host}`;
}

// 2. MANIFIESTO STREMIO
app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.adrian.cloud.v23",
        version: "1.0.0",
        name: "Carrera Viva (Cloud Fix)",
        description: "Versión Cloud basada en la V21 local",
        resources: ["catalog", "meta", "stream"],
        types: ["tv"],
        catalogs: [{ type: "tv", id: "carrera_catalog", name: "Carrera TV" }]
    });
});

app.get("/catalog/tv/carrera_catalog.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ metas: [{ id: "carrera_viva", type: "tv", name: "Carrera Viva", poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg" }] });
});

app.get("/meta/tv/carrera_viva.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ meta: { id: "carrera_viva", type: "tv", name: "Carrera Viva", poster: "https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg" } });
});

app.get("/stream/tv/carrera_viva.json", async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const baseUrl = getBaseUrl(req);
    res.json({ streams: [{ title: "🔴 LIVE | Render Cloud", url: `${baseUrl}/playlist.m3u8` }] });
});

// 3. PROCESADOR DE LISTA (CURL)
app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        if(!token) throw new Error("Fallo al obtener token");

        console.log(`☁️ Cloud: Descargando lista m3u8...`);
        const buffer = await runCurl(TARGET_PLAYLIST, {
            "User-Agent": UA,
            "Referer": "https://epicplayplay.cfd/",
            "Origin": "https://epicplayplay.cfd",
            "Authorization": `Bearer ${token}`
        });

        let playlist = buffer.toString();
        const encodedToken = encodeURIComponent(token);
        const baseUrl = getBaseUrl(req); // Usamos la URL pública de Render
        
        // REESCRITURA LLAVE (Va al proxy tipo 'key')
        playlist = playlist.replace(/URI="(https?:\/\/[^"]+)"/g, (match, url) => {
            return `URI="${baseUrl}/proxy?target=${encodeURIComponent(url)}&t=${encodedToken}&type=key"`;
        });

        // REESCRITURA VIDEO (Va al proxy tipo 'video')
        playlist = playlist.replace(/^(https?:\/\/[^\s]+)$/gm, (match) => {
            return `${baseUrl}/proxy?target=${encodeURIComponent(match)}&t=${encodedToken}&type=video`;
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.set("Access-Control-Allow-Origin", "*");
        res.send(playlist);

    } catch (e) {
        console.error("🔥 Error Playlist:", e.message);
        res.status(500).send("#EXTM3U\n#EXT-X-ERROR: " + e.message);
    }
});

// 4. PROXY HÍBRIDO (La joya de la corona)
app.get("/proxy", async (req, res) => {
    const { target, t, type } = req.query;

    // --- CASO A: LLAVE (SEGURIDAD ALTA - USA CURL) ---
    if (type === 'key') {
        console.log(`🔐 Cloud: Pidiendo LLAVE a Rusia...`);
        try {
            const buffer = await runCurl(target, {
                "User-Agent": UA,
                "Referer": "https://epicplayplay.cfd/",
                "Origin": "https://epicplayplay.cfd",
                "Cookie": `eplayer_session=${t}`,
                "Authorization": `Bearer ${t}` // ¡ESTO ES LO QUE FALTABA ANTES!
            });

            // Verificación de tamaño (El famoso error de 46 bytes)
            if (buffer.length !== 16) {
                console.log(`⚠️ ALERTA CLOUD: La llave mide ${buffer.length} bytes (Debería ser 16).`);
                console.log(`   Contenido: "${buffer.toString()}"`);
                // Si falla, es probable que la IP de Render esté bloqueada
                return res.status(500).end(); 
            }

            console.log(`🔓 Cloud: ¡Llave OK! (16 bytes)`);
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Content-Type", "application/octet-stream");
            return res.send(buffer);

        } catch (e) {
            console.error("❌ Fallo Llave:", e.message);
            return res.status(500).end();
        }
    }

    // --- CASO B: VIDEO (VELOCIDAD ALTA - USA AXIOS) ---
    if (type === 'video') {
        try {
            const response = await axios({
                method: 'get',
                url: target,
                responseType: 'stream',
                headers: { 
                    "User-Agent": UA, 
                    "Accept": "*/*" 
                },
                // Desactivamos SSL para evitar errores de certificados intermedios
                httpsAgent: new https.Agent({ rejectUnauthorized: false }) 
            });

            res.set("Content-Type", "video/mp2t");
            res.set("Access-Control-Allow-Origin", "*");
            response.data.pipe(res);
        } catch (e) {
            // console.error("Error Video Segment (AWS)");
            res.status(500).end();
        }
    }
});

app.listen(PORT, () => {
    console.log(`✅ SERVIDOR CLOUD INICIADO EN PUERTO ${PORT}`);
});
