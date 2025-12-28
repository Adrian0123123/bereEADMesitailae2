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
        // console.log("🔍 Paso 1: Token..."); 
        const buffer = await runCurl(`https://epicplayplay.cfd/premiumtv/daddyhd.php?id=${TOKEN_ID}`, {
            "User-Agent": UA,
            "Referer": "https://epicplayplay.cfd/"
        });
        const html = buffer.toString();
        const match = html.match(/const\s+AUTH_TOKEN\s*=\s*["'](eyJ[^"']+)["']/) || html.match(/Bearer\s+(eyJ[^"']+)/);
        if (!match) throw new Error("No token");
        return match[1];
    } catch (e) {
        console.error("❌ Error Token:", e.message);
        return "";
    }
}

async function getPlaylistViaJina(targetUrl) {
    // console.log(`🤖 Paso 2: Jina...`);
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    const headers = { "User-Agent": UA, "X-Retain-Images": "none" };
    if (JINA_API_KEY) headers["Authorization"] = `Bearer ${JINA_API_KEY}`;

    try {
        const response = await axios.get(jinaUrl, { headers });
        let text = response.data;
        text = text.replace(/```[a-z]*\n/g, "").replace(/```/g, "");
        text = text.split('\n').filter(line => line.trim() !== '').join('\n');
        return text;
    } catch (e) {
        throw new Error(`Jina Failed: ${e.message}`);
    }
}

// --- FUNCIÓN CRÍTICA: FORZAR HTTPS ---
function getBaseUrl(req) {
    const host = req.headers.host;
    // En Render siempre es HTTPS
    if (host.includes("onrender.com")) return `https://${host}`;
    // Fallback por si acaso
    return `https://${host}`;
}

app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.adrian.cloud.v28",
        version: "3.0.0",
        name: "Carrera Viva (Jina + HTTPS)",
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
    res.json({ streams: [{ title: "🔴 LIVE | Cloud Jina", url: `${baseUrl}/playlist.m3u8` }] });
});

app.get("/playlist.m3u8", async (req, res) => {
    try {
        console.log("☁️ Stremio pide lista...");
        const token = await getToken();
        
        let playlist = "";
        try {
            playlist = await getPlaylistViaJina(TARGET_PLAYLIST);
        } catch (e) {
            console.error("Jina falló, intentando curl...");
            // Fallback (seguramente fallará en cloud, pero por si acaso)
            const buffer = await runCurl(TARGET_PLAYLIST, { "User-Agent": UA, "Referer": "https://epicplayplay.cfd/", "Authorization": `Bearer ${token}` });
            playlist = buffer.toString();
        }

        if (!playlist.includes("#EXTM3U")) {
            console.error("❌ Lista inválida.");
            return res.status(500).send("#EXTM3U\n#EXT-X-ERROR: Invalid List");
        }

        const encodedToken = encodeURIComponent(token);
        const baseUrl = getBaseUrl(req);
        
        console.log(`📝 Escribiendo URLs seguras: ${baseUrl}`);

        // REESCRITURA CON BASE URL SEGURA
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
        console.log(`🔐 Stremio ha pedido la LLAVE (¡Bien!). Conectando a Rusia...`);
        try {
            const buffer = await runCurl(target, {
                "User-Agent": UA,
                "Referer": "https://epicplayplay.cfd/",
                "Origin": "https://epicplayplay.cfd",
                "Cookie": `eplayer_session=${t}`,
                "Authorization": `Bearer ${t}`
            });

            if (buffer.length !== 16) {
                console.log(`⚠️ Llave corrupta (${buffer.length} bytes). Rusia bloquea IP Render.`);
                // console.log(buffer.toString());
                return res.status(500).end(); 
            }

            console.log(`🔓 ¡Llave OK! Enviando a Stremio...`);
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Content-Type", "application/octet-stream");
            return res.send(buffer);

        } catch (e) {
            console.error("Error Llave:", e.message);
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
    console.log(`✅ SERVIDOR V28 (HTTPS + JINA) ACTIVO`);
});
