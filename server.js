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
// TU CLAVE DE JINA (Opcional pero recomendada para velocidad)
const JINA_API_KEY = ""; 

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// --- MOTOR CURL (Para Token y Llaves) ---
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

// 1. OBTENER TOKEN (Local/Cloud directo)
async function getToken() {
    try {
        // El token no suele tener bloqueo de IP fuerte, usamos CURL directo
        // Jina limpiaría el javascript y perderíamos el token.
        console.log("🔑 Generando token...");
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

// 2. OBTENER LISTA (USANDO JINA COMO PROXY DE TEXTO)
async function getPlaylistViaJina(targetUrl, token) {
    console.log("🤖 Jina AI: Intentando recuperar la lista...");
    
    // Construimos la URL de Jina
    // Jina no permite enviar Headers personalizados (Referer/Auth) al destino fácilmente.
    // Esto es el mayor riesgo: Si el servidor ruso exige el Token en la cabecera, Jina fallará.
    // PERO, si el token va en la URL o cookie, quizá cuele.
    
    // Intentamos pasar el token como cookie en la cabecera de Jina (truco experimental)
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    
    const headers = {
        "User-Agent": UA,
        "X-Retain-Images": "none" // Solo queremos texto
    };
    
    if (JINA_API_KEY) {
        headers["Authorization"] = `Bearer ${JINA_API_KEY}`;
    }

    // Nota: Jina NO enviará nuestra Authorization al servidor ruso.
    // Confiamos en que la lista sea accesible por IP limpia.
    
    try {
        const response = await axios.get(jinaUrl, { headers });
        let text = response.data;

        // Jina devuelve Markdown. Tenemos que limpiarlo para que vuelva a ser m3u8
        // Eliminamos bloques de código de markdown ```
        text = text.replace(/```[a-z]*\n/g, "").replace(/```/g, "");
        
        // Limpiamos líneas vacías extra que Jina suele meter
        text = text.split('\n').filter(line => line.trim() !== '').join('\n');

        return text;
    } catch (e) {
        throw new Error(`Jina falló: ${e.message}`);
    }
}

function getBaseUrl(req) {
    const host = req.headers.host;
    if (host.includes("onrender.com") || host.includes("replit")) return `https://${host}`;
    return `http://${host}`;
}

// --- ENDPOINTS ---

app.get("/manifest.json", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.adrian.jina",
        version: "1.0.0",
        name: "Carrera Viva (Jina AI)",
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
    res.json({ streams: [{ title: "🔴 LIVE | Jina Powered", url: `${baseUrl}/playlist.m3u8` }] });
});

app.get("/playlist.m3u8", async (req, res) => {
    try {
        const token = await getToken();
        if (!token) throw new Error("Sin token");

        // AQUÍ USAMOS JINA
        let playlist = await getPlaylistViaJina(TARGET_PLAYLIST, token);

        // Verificamos si Jina nos trajo una lista válida
        if (!playlist.includes("#EXTM3U")) {
            console.error("❌ Jina devolvió algo que no es una lista:");
            console.log(playlist.substring(0, 500)); // Ver qué devolvió
            
            // FALLBACK: Si Jina falla, intentamos CURL directo por si acaso
            console.log("⚠️ Jina falló o formato incorrecto. Probando CURL directo...");
            const buffer = await runCurl(TARGET_PLAYLIST, {
                "User-Agent": UA,
                "Referer": "[https://epicplayplay.cfd/](https://epicplayplay.cfd/)",
                "Origin": "[https://epicplayplay.cfd](https://epicplayplay.cfd)",
                "Authorization": `Bearer ${token}`
            });
            playlist = buffer.toString();
        } else {
            console.log("✅ Jina recuperó la lista con éxito.");
        }

        const encodedToken = encodeURIComponent(token);
        const baseUrl = getBaseUrl(req);
        
        // REESCRITURA (Igual que siempre)
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
        console.error("🔥 Error:", e.message);
        res.status(500).send("#EXTM3U\n#EXT-X-ERROR: " + e.message);
    }
});

app.get("/proxy", async (req, res) => {
    const { target, t, type } = req.query;

    // LLAVE: Usamos CURL directo (Jina rompería el binario)
    if (type === 'key') {
        console.log(`🔐 Pidiendo LLAVE (Directo)...`);
        try {
            const buffer = await runCurl(target, {
                "User-Agent": UA,
                "Referer": "[https://epicplayplay.cfd/](https://epicplayplay.cfd/)",
                "Origin": "[https://epicplayplay.cfd](https://epicplayplay.cfd)",
                "Cookie": `eplayer_session=${t}`,
                "Authorization": `Bearer ${t}`
            });

            if (buffer.length !== 16) {
                console.log(`⚠️ Llave inválida (${buffer.length} bytes).`);
                return res.status(500).end(); 
            }
            console.log(`🔓 ¡Llave OK!`);
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Content-Type", "application/octet-stream");
            return res.send(buffer);
        } catch (e) { return res.status(500).end(); }
    }

    // VIDEO: Usamos AXIOS directo
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
    console.log(`✅ SERVIDOR V26 (JINA EXPERIMENTAL) LISTO`);
});
