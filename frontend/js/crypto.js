/* VeilDrop client-side cryptography — Web Crypto API.
 *
 * Everything sensitive is sealed in the browser before it reaches the server.
 * This module runs in browsers (window.crypto) and in Node (globalThis.crypto)
 * so the protocol can be tested cross-language against the backend engines.
 *
 * Wire format (mirrors backend/tests/test_protocol.py and test_vectors.py):
 *   wrapped_dek = nonce(12) || AES-GCM(KEK, DEK) || tag(16)
 *   evidence blob = nonce(12) || AES-GCM(evidence key, file) || tag(16)
 *   KEK = HKDF-SHA256(recovery_secret, salt=32 zero bytes, info="veildrop-reporter-kek|v1")
 *   object key = HKDF-SHA256(DEK, salt=32 zero bytes, info="<purpose>|<object_id>|v<version>")
 *   object AAD = "veildrop:<purpose>:<object_id>:v<version>"
 */
(function (root) {
  "use strict";

  var subtle = (root.crypto && root.crypto.subtle) ? root.crypto.subtle : null;
  var getRandom = (root.crypto && root.crypto.getRandomValues)
    ? function (n) {
        var b = new Uint8Array(n);
        var chunk = 65536;
        for (var off = 0; off < n; off += chunk) {
          root.crypto.getRandomValues(b.subarray(off, Math.min(off + chunk, n)));
        }
        return b;
      }
    : function () { throw new Error("No secure random source available"); };

  var KEK_INFO = "veildrop-reporter-kek|v1";
  var ZERO_SALT = new Uint8Array(32);
  var NONCE_BYTES = 12;
  var TAG_BYTES = 16;

  function bytesToHex(b) {
    return Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
  }

  function hexToBytes(h) {
    if (typeof h !== "string" || h.length % 2 !== 0) throw new Error("invalid hex input");
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  function toBytes(data) {
    if (typeof data === "string") return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    throw new Error("expected string or Uint8Array");
  }

  function toUtf8(b) {
    return new TextDecoder().decode(b);
  }

  function randomBytes(n) {
    return getRandom(n);
  }

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    var b = getRandom(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = bytesToHex(b);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function importRaw(alg, bytes, usages) {
    return subtle.importKey("raw", bytes, alg, false, usages);
  }

  function hkdf(ikm, info, length, salt) {
    length = length || 32;
    salt = salt || ZERO_SALT;
    return importRaw("HKDF", ikm, ["deriveBits"]).then(function (baseKey) {
      return subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt, info: info }, baseKey, length * 8);
    }).then(function (bits) {
      return new Uint8Array(bits);
    });
  }

  function aesGcmEncrypt(keyBytes, plaintext, aad) {
    aad = aad || new Uint8Array(0);
    var nonce = randomBytes(NONCE_BYTES);
    return importRaw("AES-GCM", keyBytes, ["encrypt"]).then(function (key) {
      return subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, plaintext);
    }).then(function (out) {
      var combined = new Uint8Array(out);
      return {
        ciphertext: combined.slice(0, combined.length - TAG_BYTES),
        nonce: nonce,
        tag: combined.slice(combined.length - TAG_BYTES),
      };
    });
  }

  function aesGcmDecrypt(keyBytes, ciphertext, nonce, tag, aad) {
    aad = aad || new Uint8Array(0);
    var combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext, 0);
    combined.set(tag, ciphertext.length);
    return importRaw("AES-GCM", keyBytes, ["decrypt"]).then(function (key) {
      return subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, combined);
    }).then(function (out) {
      return new Uint8Array(out);
    });
  }

  /* ---------------- protocol helpers ---------------- */

  function deriveKek(recoverySecretBytes) {
    return hkdf(recoverySecretBytes, toBytes(KEK_INFO), 32, ZERO_SALT);
  }

  function wrapDek(kekBytes, dekBytes) {
    return aesGcmEncrypt(kekBytes, dekBytes).then(function (r) {
      var wrapped = new Uint8Array(r.nonce.length + r.ciphertext.length + r.tag.length);
      wrapped.set(r.nonce, 0);
      wrapped.set(r.ciphertext, r.nonce.length);
      wrapped.set(r.tag, r.nonce.length + r.ciphertext.length);
      return wrapped;
    });
  }

  function unwrapDek(kekBytes, wrapped) {
    var nonce = wrapped.slice(0, NONCE_BYTES);
    var tag = wrapped.slice(wrapped.length - TAG_BYTES);
    var ct = wrapped.slice(NONCE_BYTES, wrapped.length - TAG_BYTES);
    return aesGcmDecrypt(kekBytes, ct, nonce, tag);
  }

  function deriveObjectKey(dek, purpose, objectId, version) {
    version = version || 1;
    return hkdf(dek, toBytes(purpose + "|" + objectId + "|v" + version), 32, ZERO_SALT);
  }

  function objectAad(purpose, objectId, version) {
    version = version || 1;
    return toBytes("veildrop:" + purpose + ":" + objectId + ":v" + version);
  }

  function parseObjectAad(aad) {
    var s = toUtf8(aad);
    var m = /^veildrop:([a-z-]+):([^:]+):v(\d+)$/.exec(s);
    if (!m) return null;
    return { purpose: m[1], objectId: m[2], version: Number(m[3]) };
  }

  function encryptObject(dek, purpose, objectId, plaintext, version) {
    version = version || 1;
    return deriveObjectKey(dek, purpose, objectId, version).then(function (key) {
      return aesGcmEncrypt(key, plaintext, objectAad(purpose, objectId, version));
    });
  }

  function decryptObject(dek, purpose, objectId, ciphertext, nonce, tag, version) {
    version = version || 1;
    return deriveObjectKey(dek, purpose, objectId, version).then(function (key) {
      return aesGcmDecrypt(key, ciphertext, nonce, tag, objectAad(purpose, objectId, version));
    });
  }

  function encryptFile(dek, objectId, bytes) {
    return encryptObject(dek, "evidence", objectId, bytes).then(function (r) {
      var blob = new Uint8Array(r.nonce.length + r.ciphertext.length + r.tag.length);
      blob.set(r.nonce, 0);
      blob.set(r.ciphertext, r.nonce.length);
      blob.set(r.tag, r.nonce.length + r.ciphertext.length);
      return blob;
    });
  }

  function decryptFile(dek, objectId, blob) {
    var nonce = blob.slice(0, NONCE_BYTES);
    var tag = blob.slice(blob.length - TAG_BYTES);
    var ct = blob.slice(NONCE_BYTES, blob.length - TAG_BYTES);
    return decryptObject(dek, "evidence", objectId, ct, nonce, tag);
  }

  var VeilCrypto = {
    bytesToHex: bytesToHex,
    hexToBytes: hexToBytes,
    toBytes: toBytes,
    toUtf8: toUtf8,
    randomBytes: randomBytes,
    uuid: uuid,
    hkdf: hkdf,
    aesGcmEncrypt: aesGcmEncrypt,
    aesGcmDecrypt: aesGcmDecrypt,
    deriveKek: deriveKek,
    wrapDek: wrapDek,
    unwrapDek: unwrapDek,
    deriveObjectKey: deriveObjectKey,
    objectAad: objectAad,
    parseObjectAad: parseObjectAad,
    encryptObject: encryptObject,
    decryptObject: decryptObject,
    encryptFile: encryptFile,
    decryptFile: decryptFile,
  };

  root.VeilCrypto = VeilCrypto;
  if (typeof module !== "undefined" && module.exports) module.exports = VeilCrypto;
})(typeof window !== "undefined" ? window : globalThis);
