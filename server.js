const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { spawn } = require("child_process");
const https = require("https");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

// --- CONFIGURACIÓN ---
const TOKEN_ID = "537";
const STREAM_ID = "premium537";
const TARGET_PLAYLIST = `https://dokko1new.kiko2.ru/dokko1/${STREAM_ID}/mono.css`;
const JINA_API_KEY = "jina_0aca8b7a41c64d0db846b0369a969256qawCmkgGlS-NnJH2sIfV2pRq0d3p"; 

// Usamos un UA de Linux para coincidir con el sistema operativo de Render
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let GLOBAL_TOKEN = "";

// --- MOTOR CURL (SPAWN) ---
function runCurl(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const args = ['-s', '-L', '--insecure', '--http1.1', '--compressed']; // Añadido compressed
        for (const [key, value] of Object.entries(headers)) {
            args.push('-H');
            args.push(`${key}: ${value}`);
        }
        args.push(url);
        
        const child = spawn('curl', args);
        let stdoutChunks = [];
        let stderrChunks = [];

        child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

        child.on('close', (code) => {
            if (code !== 0) {
                const err = Buffer.concat(stderrChunks).toString();
                // console.error(`Curl Error: ${err}`); // Silenciado para limpieza
                reject(new Error(`Curl code: ${code}`));
            } else {
                resolve(Buffer.concat(stdoutChunks));
            }
        });
    });
}

// --- 1. OBTENER TOKEN VIA JINA (LA CLAVE DEL ÉXITO) ---
async function getToken() {
    console.log("🔄 [TOKEN] Solicitando vía Jina AI (IP Limpia)...");
    
    // URL del generador de tokens
    const targetUrl = `https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${TOKEN_ID}`;
    // Cache buster para que Jina no nos de una versión vieja
    const jinaUrl = `https://r.jina.ai/${targetUrl}?_=${Date.now()}`;
    
    const headers = { 
        "User-Agent": UA, 
        "X-Respond-With": "text", // Queremos el HTML crudo
        "X-Retain-Images": "none"
    };
    if (JINA_API_KEY) headers["Authorization"] = `Bearer ${JINA_API_KEY}`;

    try {
        const response = await axios.get(jinaUrl, { headers });
        const html = response.data;
        
        // Buscamos el token en el HTML que nos trae Jina
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || html.match(/Bearer\s+(eyJ[^"']+)/);
        
        if (!match) {
            console.error("❌ Jina no encontró el token en el HTML.");
            // console.log("HTML Parcial:", html.substring(0, 200));
            throw new Error("Token not found via Jina");
        }
        
        const rawToken = match[1];
        GLOBAL_TOKEN = rawToken.trim();
        
        console.log(`✅ [TOKEN] Obtenido vía Jina. Len: ${GLOBAL_TOKEN.length}`);
        return GLOBAL_TOKEN;
        
    } catch (e) {
        console.error("❌ Falló Jina Token, probando método local (posible token sucio)...");
        // Fallback al método CURL local (que probablemente da token sucio, pero es mejor que nada)
        try {
            const buffer = await runCurl(targetUrl, { "User-Agent": UA, "Referer": "https://epicplayplay.cfd/" });
            const html = buffer.toString();
            const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || html.match(/Bearer\s+(eyJ[^"']+)/);
            if(match) {
                GLOBAL_TOKEN = match[1].trim();
                console.log("⚠️ [TOKEN] Usando token local (Riesgo de ban).");
                return GLOBAL_TOKEN;
            }
        } catch(ex) {}
        return "";
    }
}

// --- 2. OBTENER LISTA VIA JINA ---
async function getPlaylistViaJina(targetUrl) {
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    const headers = { "User-Agent": UA, "X-Retain-Images": "none", "X-Respond-With": "text" };
    if (JINA_API_KEY) headers["Authorization"] = `Bearer ${JINA_API_KEY}`;

    try {
        const response = await axios.get(jinaUrl, { headers });
        let text = response.data;
        const startIndex = text.indexOf("#EXTM3U");
        if (startIndex === -1) throw new Error("Jina invalid m3u8");
        text = text.substring(startIndex);
        text = text.replace(/```/g, "");
        return text;
    } catch (e) {
        throw new Error(`Jina List Error: ${e.message}`);
    }
}

function getBaseUrl(req) {
    const host = req.headers.host;
    if (host.includes("onrender.com")) return `https://${host}`;
    return `http://${host}`;
}

app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.adrian.cloud.v38",
        version: "13.0.0",
        name: "Carrera Viva (Jina Full Proxy)",
        resources: ["catalog", "meta", "stream"],
        types: ["tv"],
        catalogs: [{ type: "tv", id: "carrera_catalog", name: "Carrera TV" }]
    });
});

app.get("/catalog/tv/carrera_catalog.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ metas: [{ id: "carrera_viva", type: "tv", name: "Carrera Viva", poster: "[https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg](https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg)" }] });
});

app.get("/meta/tv/carrera_viva.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ meta: { id: "carrera_viva", type: "tv", name: "Carrera Viva", poster: "[https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg](https://img.freepik.com/vector-gratis/fondo-carreras-formula-1-bandera-cuadros_1017-31486.jpg)" } });
});

app.get("/stream/tv/carrera_viva.json", async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const baseUrl = getBaseUrl(req);
    res.json({ streams: [{ title: "🔴 LIVE | V38 Jina Full", url: `${baseUrl}/playlist.m3u8` }] });
});

app.get("/playlist.m3u8", async (req, res) => {
    try {
        console.log("☁️ [STREMIO] Pide lista...");
        await getToken(); // Intentamos obtener token limpio via Jina
        
        let playlist = "";
        try {
            playlist = await getPlaylistViaJina(TARGET_PLAYLIST);
        } catch (e) {
            // Fallback Curl (probablemente bloqueado)
            const buffer = await runCurl(TARGET_PLAYLIST, { "User-Agent": UA, "Referer": "[https://epicplayplay.cfd/](https://epicplayplay.cfd/)", "Authorization": `Bearer ${GLOBAL_TOKEN}` });
            playlist = buffer.toString();
        }

        if (!playlist.includes("#EXTM3U")) return res.status(500).send("#EXTM3U\n#EXT-X-ERROR: Blocked");

        const baseUrl = getBaseUrl(req);
        console.log(`📝 [LISTA] OK. Usando memoria global.`);

        playlist = playlist.replace(/URI="(https?:\/\/[^"]+)"/g, (match, url) => {
            return `URI="${baseUrl}/proxy?target=${encodeURIComponent(url)}&type=key"`;
        });

        playlist = playlist.replace(/^(https?:\/\/[^\s]+)$/gm, (match) => {
            return `${baseUrl}/proxy?target=${encodeURIComponent(match)}&type=video`;
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.set("Access-Control-Allow-Origin", "*");
        res.send(playlist);

    } catch (e) {
        res.status(500).send("#EXTM3U\n#EXT-X-ERROR: " + e.message);
    }
});

app.get("/proxy", async (req, res) => {
    const { target, type } = req.query;

    if (type === 'key') {
        console.log(`🔐 [PROXY] Pidiendo LLAVE...`); 

        if (!GLOBAL_TOKEN) await getToken();

        try {
            // Volvemos a CURL para la llave, con headers muy controlados
            // Axios nos daba 400 duro. Curl con spawn tiene mejor manejo de TLS a veces.
            const buffer = await runCurl(target, {
                "User-Agent": UA,
                "Referer": "[https://epicplayplay.cfd/](https://epicplayplay.cfd/)",
                "Origin": "[https://epicplayplay.cfd](https://epicplayplay.cfd)",
                "Cookie": `eplayer_session=${GLOBAL_TOKEN}`,
                "Authorization": `Bearer ${GLOBAL_TOKEN}`
            });

            if (buffer.length !== 16) {
                console.log(`⚠️ ERROR (${buffer.length} bytes): ${buffer.toString()}`);
                return res.status(500).end();
            }

            console.log(`🔓 ¡Llave OK!`);
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Content-Type", "application/octet-stream");
            return res.send(buffer);

        } catch (e) {
            console.error("Key Error:", e.message);
            return res.status(500).end();
        }
    }

    if (type === 'video') {
        try {
            const response = await axios({
                method: 'get',
                url: target,
                responseType: 'stream',
                headers: { "User-Agent": UA, "Accept": "*/*" },
                httpsAgent: new https.Agent({ rejectUnauthorized: false }) 
            });
            res.set("Content-Type", "video/mp2t");
            res.set("Access-Control-Allow-Origin", "*");
            response.data.pipe(res);
        } catch (e) { res.status(500).end(); }
    }
});

app.listen(PORT, () => {
    console.log(`✅ CLOUD V38 (JINA FULL) ACTIVO`);
});
