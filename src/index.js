// ==========================================
// 1. CRYPTOGRAPHY UTILITIES (MD5 & AES-CTR)
// ==========================================

// Fast MD5 Polyfill (Required because WebCrypto doesn't support MD5)
function md5(string) {
    function rotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
    function addUnsigned(lX, lY) {
        let lX4, lY4, lX8, lY8, lResult;
        lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000);
        lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000);
        lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
        if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
        if (lX4 | lY4) {
            if (lX4 & lY4) return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
            else return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
        } else return (lResult ^ lX8 ^ lY8);
    }
    function f(x, y, z) { return (x & y) | ((~x) & z); }
    function g(x, y, z) { return (x & z) | (y & (~z)); }
    function h(x, y, z) { return (x ^ y ^ z); }
    function i(x, y, z) { return (y ^ (x | (~z))); }
    function ff(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function gg(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function hh(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function ii(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function convertToWordArray(str) {
        let lWordCount, lMessageLength = str.length, lNumberOfWords_temp1 = lMessageLength + 8;
        let lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
        let lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16, lWordArray = Array(lNumberOfWords - 1);
        let lBytePosition = 0, lByteCount = 0;
        while (lByteCount < lMessageLength) {
            lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = (lWordArray[lWordCount] | (str.charCodeAt(lByteCount) << lBytePosition)); lByteCount++;
        }
        lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
        lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
        return lWordArray;
    }
    function wordToHex(lValue) {
        let wordToHexValue = "", wordToHexValue_temp = "", lByte, lCount;
        for (lCount = 0; lCount <= 3; lCount++) {
            lByte = (lValue >>> (lCount * 8)) & 255; wordToHexValue_temp = "0" + lByte.toString(16);
            wordToHexValue = wordToHexValue + wordToHexValue_temp.substr(wordToHexValue_temp.length - 2, 2);
        }
        return wordToHexValue;
    }
    let x = [], k, AA, BB, CC, DD, a, b, c, d;
    const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20, S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
    string = unescape(encodeURIComponent(string)); x = convertToWordArray(string);
    a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
    for (k = 0; k < x.length; k += 16) {
        AA = a; BB = b; CC = c; DD = d;
        a = ff(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = ff(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = ff(c, d, a, b, x[k + 2], S13, 0x242070DB); b = ff(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
        a = ff(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = ff(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = ff(c, d, a, b, x[k + 6], S13, 0xA8304613); b = ff(b, c, d, a, x[k + 7], S14, 0xFD469501);
        a = ff(a, b, c, d, x[k + 8], S11, 0x698098D8); d = ff(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = ff(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = ff(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
        a = ff(a, b, c, d, x[k + 12], S11, 0x6B901122); d = ff(d, a, b, c, x[k + 13], S12, 0xFD987193); c = ff(c, d, a, b, x[k + 14], S13, 0xA679438E); b = ff(b, c, d, a, x[k + 15], S14, 0x49B40821);
        a = gg(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = gg(d, a, b, c, x[k + 6], S22, 0xC040B340); c = gg(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = gg(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
        a = gg(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = gg(d, a, b, c, x[k + 10], S22, 0x2441453); c = gg(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = gg(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
        a = gg(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = gg(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = gg(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = gg(b, c, d, a, x[k + 8], S24, 0x455A14ED);
        a = gg(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = gg(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = gg(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = gg(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
        a = hh(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = hh(d, a, b, c, x[k + 8], S32, 0x8771F681); c = hh(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = hh(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
        a = hh(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = hh(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = hh(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = hh(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
        a = hh(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = hh(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = hh(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = hh(b, c, d, a, x[k + 6], S34, 0x4881D05);
        a = hh(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = hh(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = hh(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = hh(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
        a = ii(a, b, c, d, x[k + 0], S41, 0xF4292244); d = ii(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = ii(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = ii(b, c, d, a, x[k + 5], S44, 0xFC93A039);
        a = ii(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = ii(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = ii(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = ii(b, c, d, a, x[k + 1], S44, 0x85845DD1);
        a = ii(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = ii(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = ii(c, d, a, b, x[k + 6], S43, 0xA3014314); b = ii(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
        a = ii(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = ii(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = ii(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = ii(b, c, d, a, x[k + 9], S44, 0xEB86D391);
        a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
    }
    return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

// WebCrypto AES-CTR Helper
async function aesCtr(dataBytes, keySeed, mode = 'decrypt') {
    const keyHex = md5(keySeed.toString());
    const keyBytes = new TextEncoder().encode(keyHex); 
    const iv = keyBytes.slice(0, 16); 
    
    const cryptoKey = await crypto.subtle.importKey(
        "raw", keyBytes, { name: "AES-CTR" }, false, [mode]
    );
    
    return await crypto.subtle[mode](
        { name: "AES-CTR", counter: iv, length: 64 },
        cryptoKey,
        dataBytes
    );
}

// ==========================================
// 2. UPSTREAM RESOLVERS
// ==========================================

async function resolveAsCdn26(embedUrl) {
    const videoId = new URL(embedUrl).pathname.split('/').pop();
    const sessionRes = await fetch(embedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://animesalt.cx/" }
    });
    
    const setCookieHeader = sessionRes.headers.get('set-cookie');
    const cookieMatch = setCookieHeader ? setCookieHeader.match(/fireplayer_player=([^;]+)/) : null;
    const cookie = cookieMatch ? `fireplayer_player=${cookieMatch[1]}` : "";
    
    const ajaxRes = await fetch(`https://as-cdn26.top/player/index.php?data=${videoId}&do=getVideo`, {
        method: 'POST',
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            "Cookie": cookie,
            "Referer": embedUrl,
            "Origin": "https://as-cdn26.top"
        },
        body: `hash=${videoId}&r=https://animesalt.cx/`
    });
    
    const data = await ajaxRes.json();
    if (!data.securedLink) throw new Error("Failed to fetch secured HLS link");
    
    return { host: "as-cdn26.top", source_type: "hls", direct_hls: data.securedLink, subtitles: data.tracks || [] };
}

async function resolveAbyss(embedUrl) {
    const res = await fetch(embedUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    const html = await res.text();
    
    const datasMatch = html.match(/(?:const|var)\s+datas\s*=\s*"([^"]+)"/);
    if (!datasMatch) throw new Error("No Abyss payload found");
    
    const binaryString = atob(datasMatch[1]);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const seed = `${payload.user_id}:${payload.slug}:${payload.md5_id}`;
    
    const mediaString = payload.media;
    const mediaBytes = new Uint8Array(mediaString.length);
    for (let i = 0; i < mediaString.length; i++) mediaBytes[i] = mediaString.charCodeAt(i) & 0xFF;
    
    const decrypted = await aesCtr(mediaBytes, seed, 'decrypt');
    const mediaJson = JSON.parse(new TextDecoder().decode(decrypted));
    
    const sources = mediaJson.mp4?.sources || [];
    const qualities = [];
    
    for (const src of sources) {
        if (src.file) {
            qualities.push({ resolution: src.label || "Unknown", url: src.file });
        } else if (src.path && src.size && src.sub) {
            const pathValue = `/mp4/${payload.md5_id}/${src.res_id}/${src.size}?v=${payload.slug}`;
            const pathBytes = new TextEncoder().encode(pathValue);
            const encryptedPath = await aesCtr(pathBytes, src.size.toString(), 'encrypt');
            const firstB64 = btoa(String.fromCharCode(...new Uint8Array(encryptedPath)));
            const soraToken = btoa(firstB64);
            const domain = (mediaJson.mp4.domains || []).find(d => src.sub.includes(d)) || "abysscdn.com";
            qualities.push({ resolution: src.label || "Unknown", size: src.size, url: `https://${domain}/sora/${src.size}/${soraToken}` });
        }
    }
    return { host: "abysscdn.com", source_type: "mp4", qualities };
}

// ==========================================
// 3. NATIVE ROUTER & PROXY
// ==========================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
    }

    try {
      if (path === "/api/health") return jsonResponse({ status: "operational", time: new Date().toISOString() });

      if (path === "/api/search") {
        const query = url.searchParams.get("q");
        if (!query) return jsonResponse({ error: "Missing query 'q'" }, 400);
        const res = await fetch(`https://animesalt.cx/?s=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
        const html = await res.text();
        const regex = /<a href="\/anime\/([^"]+)".*?<img src="([^"]+)".*?<div class="title">([^<]+)<\/div>/gs;
        const results = [];
        let match;
        while ((match = regex.exec(html)) !== null) results.push({ id: match[1], poster: match[2], title: match[3] });
        return jsonResponse({ query, results });
      }

      if (path === "/api/info") {
        const id = url.searchParams.get("id");
        if (!id) return jsonResponse({ error: "Missing id" }, 400);
        const res = await fetch(`https://animesalt.cx/anime/${id}/`, { headers: { "User-Agent": "Mozilla/5.0" } });
        const html = await res.text();
        const titleMatch = html.match(/<h1 class="title">([^<]+)</);
        const synopsisMatch = html.match(/<div class="description">([^<]+)</);
        return jsonResponse({ id, title: titleMatch ? titleMatch[1] : "Unknown", synopsis: synopsisMatch ? synopsisMatch[1].trim() : "" });
      }

      if (path === "/api/servers") {
        const ep = url.searchParams.get("ep");
        if (!ep) return jsonResponse({ error: "Missing episode id" }, 400);
        const res = await fetch(`https://animesalt.cx/episode/${ep}/`, { headers: { "User-Agent": "Mozilla/5.0" } });
        const html = await res.text();
        const serverRegex = /<div id="options-(\d+)" class="video.*?">.*?<iframe.*?data-src="([^"]+)"/gs;
        const servers = [];
        let match;
        while ((match = serverRegex.exec(html)) !== null) {
          const embedUrl = match[2];
          let host = "unknown";
          if (embedUrl.includes('as-cdn26.top')) host = "as-cdn26.top";
          else if (embedUrl.includes('short.icu') || embedUrl.includes('multi-lang-plyr')) host = "abysscdn.com";
          servers.push({ server_id: parseInt(match[1]), host, embed_url: embedUrl });
        }
        return jsonResponse({ episode_id: ep, servers });
      }

      if (path === "/api/stream") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) return jsonResponse({ error: "Missing embed url" }, 400);
        if (targetUrl.includes('as-cdn26.top')) return jsonResponse(await resolveAsCdn26(targetUrl));
        if (targetUrl.includes('short.icu') || targetUrl.includes('multi-lang-plyr')) return jsonResponse(await resolveAbyss(targetUrl));
        return jsonResponse({ error: "Unsupported host" }, 400);
      }

      if (path === "/proxy/manifest") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) return new Response("Missing url", { status: 400 });
        const res = await fetch(targetUrl, { headers: { "Referer": "https://as-cdn26.top/", "Origin": "https://as-cdn26.top" } });
        const manifest = await res.text();
        const baseUrl = new URL(targetUrl);
        const rewritten = manifest.split('\n').map(line => {
          if (line.startsWith('#') || !line.trim()) return line;
          return `/proxy/segment?url=${encodeURIComponent(new URL(line, baseUrl).href)}`;
        }).join('\n');
        return new Response(rewritten, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*" } });
      }

      if (path === "/proxy/segment") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) return new Response("Missing url", { status: 400 });
        const res = await fetch(targetUrl, { headers: { "Referer": "https://as-cdn26.top/", "Origin": "https://as-cdn26.top" } });
        return new Response(res.body, { headers: { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" } });
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message, stack: e.stack }, 500);
    }
  }
};