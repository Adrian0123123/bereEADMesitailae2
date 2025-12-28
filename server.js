const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { exec } = require("child_process");
const https = require("https");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

// --- CONFIGURACIÓN ---
const TOKEN_ID = "537";
const STREAM_ID = "premium537";
const TARGET_PLAYLIST = `https://dokko1new.kiko2.ru/dokko1/${STREAM_ID}/mono.css`;
const JINA_API_KEY = "jina_0aca8b7a41c64d0db846b0369a969256qawCmkgGlS-NnJH2sIfV2pRq0d3p"; 

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
            if (error) { reject(error); return; }
            resolve(stdout);
        });
    });
}

async function getToken() {
    try {
        const buffer = await runCurl(`https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${TOKEN_ID}`, {
            "User-Agent": UA,
            "Referer": "https://epicplayplay.cfd/"
        });
        const html = buffer.toString();
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || html.match(/Bearer\s+(eyJ[^"']+)/);
        if (!match) throw new Error("No token found");
        return match[1];
    } catch (e) {
        console.error("❌ Error Token:", e.message);
        return "";
    }
}

// --- NUEVA LÓGICA DE LIMPIEZA AGRESIVA ---
async function getPlaylistViaJina(targetUrl) {
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    const headers = { "User-Agent": UA, "X-Retain-Images": "none" };
    if (JINA_API_KEY) headers["Authorization"] = `Bearer ${JINA_API_KEY}`;

    try {
        const response = await axios.get(jinaUrl, { headers });
        const rawText = response.data;

        // 1. Separar por líneas
        const lines = rawText.split('\n');
        
        // 2. Filtrar solo líneas válidas de M3U8
        const cleanLines = lines.filter(line => {
            const trimmed = line.trim();
            // Nos quedamos solo con lo que empieza por # (comandos) o http (enlaces)
            return trimmed.startsWith('#') || trimmed.startsWith('http');
        });

        // 3. Asegurar que la primera línea sea #EXTM3U (Vital para Stremio)
        if (cleanLines.length > 0 && !cleanLines[0].includes("#EXTM3U")) {
            cleanLines.unshift("#EXTM3U");
        }

        // 4. Reconstruir
        return cleanLines.join('\n');

    } catch (e) {
        throw new Error(`Jina Failed: ${e.message}`);
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
        id: "org.adrian.cloud.v30",
        version: "5.0.0",
        name: "Carrera Viva (Jina Perfect Cleaner)",
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
    res.json({ streams: [{ title: "🔴 LIVE | Jina V30", url: `${baseUrl}/playlist.m3u8` }] });
});

app.get("/playlist.m3u8", async (req, res) => {
    try {
        console.log("☁️ Stremio pide lista...");
        const token = await getToken();
        
        // Obtenemos y LIMPIAMOS la lista de Jina
        let playlist = await getPlaylistViaJina(TARGET_PLAYLIST);

        // Verificación de seguridad
        if (!playlist.includes("#EXTINF")) {
            console.error("❌ La lista limpiada parece vacía o inválida.");
            return res.status(500).send("#EXTM3U\n#EXT-X-ERROR: Empty List from Jina");
        }

        const encodedToken = encodeURIComponent(token);
        const baseUrl = getBaseUrl(req);
        
        console.log(`📝 Lista limpia y válida (${playlist.length} chars). Reescribiendo...`);

        // REESCRITURA
        playlist = playlist.replace(/URI="(https?:\/\/[^"]+)"/g, (match, url) => {
            return `URI="${baseUrl}/proxy?target=${encodeURIComponent(url)}&t=${encodedToken}&type=key"`;
        });

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

app.get("/proxy", async (req, res) => {
    const { target, t, type } = req.query;

    if (type === 'key') {
        // AQUÍ ES LA PRUEBA DE FUEGO DEL BLOQUEO DE IP
        console.log(`🔐 Stremio pide LLAVE...`); 
        try {
            const buffer = await runCurl(target, {
                "User-Agent": UA,
                "Referer": "https://epicplayplay.cfd/",
                "Origin": "https://epicplayplay.cfd",
                "Cookie": `eplayer_session=${t}`,
                "Authorization": `Bearer ${t}`
            });

            if (buffer.length !== 16) {
                console.log(`⚠️ Llave corrupta o bloqueo IP (${buffer.length} bytes).`);
                return res.status(500).end(); 
            }

            console.log(`🔓 ¡Llave OK!`);
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Content-Type", "application/octet-stream");
            return res.send(buffer);

        } catch (e) {
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
    console.log(`✅ CLOUD V30 (CLEANER) ACTIVO`);
});
