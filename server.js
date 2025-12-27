const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { exec } = require("child_process");
const https = require("https");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

const TOKEN_ID = "537";
const STREAM_ID = "premium537";
const TARGET_PLAYLIST = `https://dokko1new.kiko2.ru/dokko1/${STREAM_ID}/mono.css`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function runCurl(url, headers = {}) {
    return new Promise((resolve, reject) => {
        let cmd = `curl -s -L --insecure `;
        for (const [key, value] of Object.entries(headers)) {
            const safeValue = value.replace(/"/g, '\\"');
            cmd += `-H "${key}: ${safeValue}" `;
        }
        cmd += `"${url}"`;

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

async function getToken() {
    try {
        console.log(`☁️ Cloud: Generando token para ID ${TOKEN_ID}...`);
        const buffer = await runCurl(`https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${TOKEN_ID}`, {
            "User-Agent": UA,
            "Referer": "https://epicplayplay.cfd/"
        });
        const html = buffer.toString();
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || html.match(/Bearer\s+(eyJ[^"']+)/);
        if (!match) throw new Error("No token found via CURL");
        return match[1];
    } catch (e) {
        console.error("❌ Error Token:", e.message);
        return "";
    }
}

// --- FORZADO DE HTTPS ---
function getBaseUrl(req) {
    const host = req.headers.host;
    // En Render siempre forzamos HTTPS, no nos fiamos del protocolo interno
    if (host.includes("onrender.com")) {
        return `https://${host}`;
    }
    return `http://${host}`;
}

app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.adrian.cloud.v24",
        version: "1.1.0",
        name: "Carrera Viva (HTTPS Force)",
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
    res.json({ streams: [{ title: "🔴 LIVE | HTTPS Force", url: `${baseUrl}/playlist.m3u8` }] });
});

app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        if (!token) throw new Error("Sin token");

        console.log(`☁️ Cloud: Descargando lista m3u8...`);
        const buffer = await runCurl(TARGET_PLAYLIST, {
            "User-Agent": UA,
            "Referer": "https://epicplayplay.cfd/",
            "Origin": "https://epicplayplay.cfd",
            "Authorization": `Bearer ${token}`
        });

        let playlist = buffer.toString();
        
        // --- DEBUG: VERIFICAR CONTENIDO ---
        if (!playlist.includes("#EXTM3U")) {
            console.error("❌ ALERTA: Lo que bajamos NO es una lista válida. Contenido:");
            console.log(playlist.substring(0, 200)); // Muestra el error si lo hay
            return res.status(500).send("Error descarga lista");
        }

        const encodedToken = encodeURIComponent(token);
        const baseUrl = getBaseUrl(req);
        
        playlist = playlist.replace(/URI="(https?:\/\/[^"]+)"/g, (match, url) => {
            return `URI="${baseUrl}/proxy?target=${encodeURIComponent(url)}&t=${encodedToken}&type=key"`;
        });

        playlist = playlist.replace(/^(https?:\/\/[^\s]+)$/gm, (match) => {
            return `${baseUrl}/proxy?target=${encodeURIComponent(match)}&t=${encodedToken}&type=video`;
        });

        // --- DEBUG: VER QUÉ URLS ESTAMOS ESCRIBIENDO ---
        console.log(`📝 Escribiendo lista con base: ${baseUrl}`);
        // console.log(playlist.substring(0, 300)); // Descomentar si sigue fallando

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.set("Access-Control-Allow-Origin", "*");
        res.send(playlist);

    } catch (e) {
        console.error("🔥 Error Playlist:", e.message);
        res.status(500).send("#EXTM3U\n#EXT-X-ERROR: " + e.message);
    }
});

app.get("/proxy", async (req, res) => {
    const { target, t, type } = req.query;

    if (type === 'key') {
        console.log(`🔐 Cloud: Pidiendo LLAVE a Rusia...`);
        try {
            const buffer = await runCurl(target, {
                "User-Agent": UA,
                "Referer": "https://epicplayplay.cfd/",
                "Origin": "https://epicplayplay.cfd",
                "Cookie": `eplayer_session=${t}`,
                "Authorization": `Bearer ${t}`
            });

            if (buffer.length !== 16) {
                console.log(`⚠️ ALERTA CLOUD: La llave mide ${buffer.length} bytes.`);
                // console.log(`Contenido: ${buffer.toString()}`);
                return res.status(500).end(); 
            }

            console.log(`🔓 Cloud: ¡Llave OK!`);
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Content-Type", "application/octet-stream");
            return res.send(buffer);

        } catch (e) {
            console.error("❌ Fallo Llave:", e.message);
            return res.status(500).end();
        }
    }

    if (type === 'video') {
        try {
            // Usamos Axios con headers mínimos para AWS
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
        } catch (e) {
            // Silencio para no llenar logs
            res.status(500).end();
        }
    }
});

app.listen(PORT, () => {
    console.log(`✅ SERVIDOR V24 (HTTPS FORCE) EN PUERTO ${PORT}`);
});
