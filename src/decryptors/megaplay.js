// ==========================================================================
// Megaplay.buzz Decryptor
// Decrypts encrypted HLS streams from megaplay.buzz embeds
// Encryption: AES-256-CBC with key "i?LMTAx0Q6,:}50U"
// ==========================================================================

import { CHROME_HEADERS } from "../config.js";

const MEGAPLAY_DECRYPT_KEY = "i?LMTAx0Q6,:}50U";

/**
 * Decrypt AES-CBC encrypted data from megaplay
 */
async function decryptMegaplay(encData) {
  try {
    // Convert URL-safe base64 to standard base64
    let b64 = encData.replace(/-/g, "+").replace(/_/g, "/");
    
    // Add padding if needed
    const paddingNeeded = 4 - (b64.length % 4);
    if (paddingNeeded !== 4) {
      b64 += "=".repeat(paddingNeeded);
    }
    
    // Decode base64
    const encryptedBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    
    // First 16 bytes are IV
    const iv = encryptedBytes.slice(0, 16);
    const ciphertext = encryptedBytes.slice(16);
    
    // Prepare key (pad to 32 bytes)
    const keyText = MEGAPLAY_DECRYPT_KEY;
    const keyBytes = new Uint8Array(32);
    const keyTextBytes = new TextEncoder().encode(keyText);
    keyBytes.set(keyTextBytes.slice(0, Math.min(32, keyTextBytes.length)));
    
    // Decrypt using Web Crypto API
    const key = await crypto.subtle.importKey(
      "raw", 
      keyBytes, 
      { name: "AES-CBC" }, 
      false, 
      ["decrypt"]
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv }, 
      key, 
      ciphertext
    );
    
    const text = new TextDecoder().decode(decrypted);
    
    // Extract URL from decrypted text
    // Format: /domain.com/path/to/master.m3u8"}
    const urlMatch = text.match(/\/(.+?)["\}]/);
    if (urlMatch) {
      return "https://" + urlMatch[1];
    }
    
    // Fallback: extract path
    const pathMatch = text.match(/\/[^"\}]+/);
    if (pathMatch) {
      return "https:/" + pathMatch[0];
    }
    
    return text.trim();
  } catch (e) {
    console.error("[Megaplay] Decryption failed:", e);
    throw e;
  }
}

/**
 * Resolve megaplay.buzz embed to direct HLS stream
 */
export async function resolveMegaplay(embedUrl) {
  try {
    // Extract video ID from embed URL
    // Format: https://megaplay.buzz/stream/s-2/8381/sub
    const idMatch = embedUrl.match(/\/s-\d+\/(\d+)/);
    if (!idMatch) {
      console.error("[Megaplay] Could not extract video ID from URL");
      return null;
    }
    
    const videoId = idMatch[1];
    console.log("[Megaplay] Extracted video ID:", videoId);
    
    // Fetch the embed page to get data-id
    const pageRes = await fetch(embedUrl, {
      headers: {
        ...CHROME_HEADERS,
        Referer: "https://animesalt.cx/",
      },
    });
    
    const html = await pageRes.text();
    
    // Extract data-id from the page
    const dataIdMatch = html.match(/data-id="(\d+)"/);
    if (!dataIdMatch) {
      console.error("[Megaplay] Could not find data-id in page");
      return null;
    }
    
    const dataId = dataIdMatch[1];
    console.log("[Megaplay] Found data-id:", dataId);
    
    // Call the getSources API
    const apiUrl = `https://megaplay.buzz/stream/getSourcesNew?id=${dataId}`;
    console.log("[Megaplay] Fetching:", apiUrl);
    
    const apiRes = await fetch(apiUrl, {
      headers: {
        ...CHROME_HEADERS,
        Referer: embedUrl,
      },
    });
    
    if (!apiRes.ok) {
      console.error("[Megaplay] API request failed:", apiRes.status);
      return null;
    }
    
    const data = await apiRes.json();
    console.log("[Megaplay] API response keys:", Object.keys(data));
    
    if (!data.enc) {
      console.error("[Megaplay] No encrypted data in response");
      return null;
    }
    
    // Decrypt the video URL
    const m3u8Url = await decryptMegaplay(data.enc);
    console.log("[Megaplay] Decrypted m3u8 URL:", m3u8Url);
    
    // Parse subtitles
    const subtitles = (data.tracks || [])
      .filter(t => t.kind === "captions" || t.kind === "subtitles")
      .map(t => ({
        label: t.label || "Unknown",
        url: t.file,
        default: t.default || false,
      }));
    
    // Return stream data
    return {
      isIframe: false,
      direct_hls: m3u8Url,
      subtitles,
      intro: data.intro || null,
      outro: data.outro || null,
      embedUrl,
    };
  } catch (e) {
    console.error("[Megaplay] Resolve failed:", e);
    return null;
  }
}