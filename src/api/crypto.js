export async function decryptAES(ciphertext, key, iv, mode = "CBC") {
  const algo = { name: `AES-${mode}`, iv: new Uint8Array(iv) };
  const cryptoKey = await crypto.subtle.importKey(
    "raw", new Uint8Array(key), algo, false, ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt(algo, cryptoKey, new Uint8Array(ciphertext));
  return new TextDecoder().decode(decrypted);
}