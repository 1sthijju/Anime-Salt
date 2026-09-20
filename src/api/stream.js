/**
 * Extract subtitles from episode page - DEBUG VERSION
 */
async function extractSubtitlesFromPage(epSlug) {
  try {
    const html = await fetchUpstream(`/episode/${epSlug}/`);
    console.log(`[DEBUG] Episode page HTML length: ${html.length}`);
    
    const subtitles = [];

    // Debug: Check what patterns exist
    const hasPlayerJS = html.includes("playerjsSubtitle");
    const hasSubtitlesVar = /var\s+subtitles/i.test(html);
    const hasVTT = html.includes(".vtt");
    const hasSRT = html.includes(".srt");
    const hasWEBVTT = html.includes("WEBVTT");
    
    console.log(`[DEBUG] Patterns found:`, {
      playerjsSubtitle: hasPlayerJS,
      subtitlesVar: hasSubtitlesVar,
      vttFiles: hasVTT,
      srtFiles: hasSRT,
      WEBVTT: hasWEBVTT
    });

    // Pattern 1: playerjsSubtitle = "[lang]url,[lang]url"
    const pjsMatch = html.match(/var\s+playerjsSubtitle\s*=\s*["']([^"']+)["']/i);
    if (pjsMatch) {
      console.log(`[DEBUG] Found playerjsSubtitle: ${pjsMatch[1].substring(0, 200)}...`);
      const re = /\[([^\]]+)\]\s*(https?:\/\/[^"'\s,;]+)/g;
      let m;
      while ((m = re.exec(pjsMatch[1])) !== null) {
        const url = m[2].trim().replace(/\\\//g, "/");
        console.log(`[DEBUG] Extracted subtitle: ${m[1]} -> ${url}`);
        if (/\.(vtt|srt|ass|ssa|txt)(\?|$)/i.test(url)) {
          subtitles.push({
            label: m[1].trim(),
            url,
            referer: "https://animesalt.cx/",
          });
        }
      }
    }

    // Pattern 2: var subtitles = [{file: "...", label: "..."}]
    const subVarMatch = html.match(/var\s+subtitles\s*=\s*(\[[\s\S]*?\]);/i);
    if (subVarMatch) {
      console.log(`[DEBUG] Found subtitles var: ${subVarMatch[1].substring(0, 200)}...`);
      try {
        const cleanJson = subVarMatch[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":');
        const subsArray = JSON.parse(cleanJson);
        console.log(`[DEBUG] Parsed ${subsArray.length} subtitles`);
        subsArray.forEach((sub) => {
          if (sub.file || sub.src || sub.url) {
            const url = (sub.file || sub.src || sub.url).replace(/\\\//g, "/");
            console.log(`[DEBUG] Subtitle object: ${JSON.stringify(sub)}`);
            if (/\.(vtt|srt|ass|ssa|txt)(\?|$)/i.test(url)) {
              subtitles.push({
                label: sub.label || sub.language || sub.name || "Subtitles",
                url,
                referer: "https://animesalt.cx/",
              });
            }
          }
        });
      } catch (e) {
        console.log(`[DEBUG] JSON parse error: ${e.message}`);
      }
    }

    // Pattern 3: Raw .vtt / .srt URLs
    const vttUrls = [...html.matchAll(/["'](https?:\/\/[^"'\s]+\.(?:vtt|srt|ass|ssa)(?:\?[^"']*)?)["']/gi)];
    if (vttUrls.length > 0) {
      console.log(`[DEBUG] Found ${vttUrls.length} raw subtitle URLs`);
      vttUrls.forEach((m) => {
        const url = m[1].replace(/\\\//g, "/");
        if (!subtitles.some((s) => s.url === url)) {
          const langMatch = url.match(/\/([a-z]{2,3})\.(?:vtt|srt)/i) || url.match(/subtitles?[_-]([a-z]{2,3})/i);
          console.log(`[DEBUG] Raw URL: ${url}`);
          subtitles.push({
            label: langMatch ? langMatch[1].toUpperCase() : "Subtitles",
            url,
            referer: "https://animesalt.cx/",
          });
        }
      });
    }

    // Pattern 4: Look for any URL containing "sub" or "caption"
    const subUrls = [...html.matchAll(/["'](https?:\/\/[^"'\s]*(?:sub|caption|track)[^"'\s]*)["']/gi)];
    if (subUrls.length > 0) {
      console.log(`[DEBUG] Found ${subUrls.length} URLs with 'sub'/'caption'/'track'`);
      subUrls.slice(0, 5).forEach((m) => {
        console.log(`[DEBUG] Potential subtitle URL: ${m[1]}`);
      });
    }

    console.log(`[DEBUG] Total subtitles extracted: ${subtitles.length}`);
    return subtitles;
  } catch (e) {
    console.error(`[DEBUG] Failed to extract subtitles: ${e.message}`);
    return [];
  }
}