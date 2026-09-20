// src/util/fetcher.js
import { UPSTREAM, CHROME_HEADERS } from "../config.js";

const gate = createSemaphore(6);

function createSemaphore(max) {
  let active = 0;
  const queue = [];
  
  return function(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active--;
          if (queue.length > 0) {
            queue.shift()();
          }
        }
      };
      
      if (active < max) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

export async function fetchUpstream(path) {
  const url = `${UPSTREAM}${path}`;
  try {
    const response = await gate(async () => {
      const res = await fetch(url, {
        headers: CHROME_HEADERS,
        redirect: 'follow'
      });
      
      if (!res.ok) {
        throw new Error(`Upstream returned ${res.status}`);
      }
      
      return res;
    });
    
    return await response.text();
  } catch (error) {
    console.error(`[FETCH] Failed to fetch ${path}:`, error.message);
    throw error;
  }
}