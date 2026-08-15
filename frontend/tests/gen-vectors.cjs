/* Regenerates backend/tests/vectors/reporter_v1.json
 *
 * Fixed inputs make the vector reproducible. The vector is verified twice:
 *   - frontend/tests/crypto.test.cjs   (Node Web Crypto)
 *   - backend/tests/test_vectors.py    (Python cryptography)
 * so both implementations must agree on the wire format.
 *
 * Usage: node frontend/tests/gen-vectors.cjs
 */
"use strict";
const path = require("path");
const fs = require("fs");
const C = require("../js/crypto.js");

const RECOVERY_SECRET_HEX = "4a9c2b8f1d5e7a0b3c6d9f2e8a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b";
const DEK_HEX = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";

const REPORT_ID = "msg-8f3a9c5e-b6d2-4f01-9a7c-2b5d8e1f4a03";
const MESSAGE_ID = "msg-b7c2d4e6-f8a0-4b3d-9c1e-2f4a6b8d0e12";
const FILE_ID = "file-9c8b7a6e-5d4c-4b3a-9a2b-1c2d3e4f5a6b";

const REPORT_PLAINTEXT = JSON.stringify({
  category: "Security & safety",
  title: "Vector test report",
  summary: "Cross-language E2EE vector",
  details: "Generated once by Node, verified by Python.",
});

const MESSAGE_PLAINTEXT = "Reply: please send the full audit trail.";
const FILE_BYTES = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff);

async function main() {
  const recoverySecret = C.hexToBytes(RECOVERY_SECRET_HEX);
  const dek = C.hexToBytes(DEK_HEX);

  const kek = await C.deriveKek(recoverySecret);
  const wrappedDek = await C.wrapDek(kek, dek);

  const report = await C.encryptObject(dek, "report", REPORT_ID, C.toBytes(REPORT_PLAINTEXT));
  const message = await C.encryptObject(dek, "message", MESSAGE_ID, C.toBytes(MESSAGE_PLAINTEXT));
  const evidence = await C.encryptFile(dek, FILE_ID, FILE_BYTES);

  const vector = {
    protocol: "reporter-e2ee-v1",
    comment: "Fixed DEK/recovery secret; each object key is HKDF(DEK, purpose|object_id|v1). See frontend/js/crypto.js.",
    recovery_secret_hex: RECOVERY_SECRET_HEX,
    dek_hex: DEK_HEX,
    wrapped_dek_hex: C.bytesToHex(wrappedDek),
    objects: [
      {
        purpose: "report",
        object_id: REPORT_ID,
        aad_hex: C.bytesToHex(C.objectAad("report", REPORT_ID)),
        plaintext_utf8: REPORT_PLAINTEXT,
        ciphertext_hex: C.bytesToHex(report.ciphertext),
        nonce_hex: C.bytesToHex(report.nonce),
        tag_hex: C.bytesToHex(report.tag),
      },
      {
        purpose: "message",
        object_id: MESSAGE_ID,
        aad_hex: C.bytesToHex(C.objectAad("message", MESSAGE_ID)),
        plaintext_utf8: MESSAGE_PLAINTEXT,
        ciphertext_hex: C.bytesToHex(message.ciphertext),
        nonce_hex: C.bytesToHex(message.nonce),
        tag_hex: C.bytesToHex(message.tag),
      },
      {
        purpose: "evidence",
        object_id: FILE_ID,
        aad_hex: C.bytesToHex(C.objectAad("evidence", FILE_ID)),
        original_size: FILE_BYTES.length,
        blob_hex: C.bytesToHex(evidence),
      },
    ],
  };

  const out = path.join(__dirname, "..", "..", "backend", "tests", "vectors", "reporter_v1.json");
  fs.writeFileSync(out, JSON.stringify(vector, null, 2) + "\n");
  console.log("wrote", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
