/* VeilDrop client crypto tests — run with: node frontend/tests/crypto.test.cjs
 * Verifies crypto.js against committed cross-language vectors (see gen-vectors.cjs).
 */
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const C = require("../js/crypto.js");

const VECTOR = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "backend", "tests", "vectors", "reporter_v1.json"), "utf8")
);

let passed = 0;
function ok(name) { passed++; console.log("ok -", name); }

async function testRandomAndHex() {
  assert.strictEqual(C.randomBytes(32).length, 32);
  const hex = C.bytesToHex(C.hexToBytes("deadbeef"));
  assert.strictEqual(hex, "deadbeef");
  ok("randomBytes + hex roundtrip");
}

async function testWrapUnwrap() {
  const dek = C.randomBytes(32);
  const secret = C.randomBytes(32);
  const kek = await C.deriveKek(secret);
  const wrapped = await C.wrapDek(kek, dek);
  assert.strictEqual(wrapped.length, 60); // 12 + 32 + 16
  const unwrapped = await C.unwrapDek(kek, wrapped);
  assert.deepStrictEqual(unwrapped, dek);
  ok("wrap/unwrap DEK roundtrip (60-byte envelope)");
}

async function testWrongKeyFails() {
  const dek = C.randomBytes(32);
  const kekA = await C.deriveKek(C.randomBytes(32));
  const kekB = await C.deriveKek(C.randomBytes(32));
  const wrapped = await C.wrapDek(kekA, dek);
  await assert.rejects(() => C.unwrapDek(kekB, wrapped), "wrong KEK must fail");
  ok("wrong KEK rejected on unwrap");
}

async function testObjectRoundtrip() {
  const dek = C.randomBytes(32);
  const objectId = "msg-" + C.uuid();
  const plaintext = "this message stays sealed until the recipient opens it";
  const enc = await C.encryptObject(dek, "message", objectId, C.toBytes(plaintext));
  assert.strictEqual(enc.tag.length, 16);
  assert.strictEqual(enc.nonce.length, 12);
  const dec = await C.decryptObject(dek, "message", objectId, enc.ciphertext, enc.nonce, enc.tag);
  assert.strictEqual(C.toUtf8(dec), plaintext);
  ok("encryptObject/decryptObject roundtrip");
}

async function testTamperFails() {
  const dek = C.randomBytes(32);
  const enc = await C.encryptObject(dek, "message", "msg-tamper", C.toBytes("integrity matters"));
  const tampered = enc.ciphertext.slice();
  tampered[0] ^= 0xff;
  await assert.rejects(() => C.decryptObject(dek, "message", "msg-tamper", tampered, enc.nonce, enc.tag));
  await assert.rejects(() => C.decryptObject(dek, "message", "msg-other", enc.ciphertext, enc.nonce, enc.tag));
  ok("tampered ciphertext and wrong object id rejected");
}

async function testFileRoundtrip() {
  const dek = C.randomBytes(32);
  const bytes = C.randomBytes(100000);
  const blob = await C.encryptFile(dek, "file-roundtrip", bytes);
  assert.strictEqual(blob.length, bytes.length + 28); // + nonce + tag
  const dec = await C.decryptFile(dek, "file-roundtrip", blob);
  assert.deepStrictEqual(dec, bytes);
  ok("encryptFile/decryptFile roundtrip");
}

async function testVectorWrappedDek() {
  const secret = C.hexToBytes(VECTOR.recovery_secret_hex);
  const kek = await C.deriveKek(secret);
  const dek = await C.unwrapDek(kek, C.hexToBytes(VECTOR.wrapped_dek_hex));
  assert.strictEqual(C.bytesToHex(dek), VECTOR.dek_hex);
  ok("vector: wrapped DEK unwraps to expected DEK");
}

async function testVectorObjects() {
  const dek = C.hexToBytes(VECTOR.dek_hex);
  for (const obj of VECTOR.objects) {
    if (obj.purpose === "evidence") {
      const dec = await C.decryptFile(dek, obj.object_id, C.hexToBytes(obj.blob_hex));
      assert.strictEqual(dec.length, obj.original_size);
      const original = Uint8Array.from({ length: obj.original_size }, (_, i) => i & 0xff);
      assert.deepStrictEqual(dec, original);
    } else {
      const dec = await C.decryptObject(
        dek, obj.purpose, obj.object_id,
        C.hexToBytes(obj.ciphertext_hex), C.hexToBytes(obj.nonce_hex), C.hexToBytes(obj.tag_hex)
      );
      assert.strictEqual(C.toUtf8(dec), obj.plaintext_utf8);
    }
  }
  ok("vector: all objects decrypt (report, message, evidence)");
}

async function testAadParsing() {
  const parsed = C.parseObjectAad(C.objectAad("report", "msg-x", 1));
  assert.deepStrictEqual(parsed, { purpose: "report", objectId: "msg-x", version: 1 });
  assert.strictEqual(C.parseObjectAad(new Uint8Array(0)), null);
  ok("object AAD parse/format roundtrip");
}

(async () => {
  await testRandomAndHex();
  await testWrapUnwrap();
  await testWrongKeyFails();
  await testObjectRoundtrip();
  await testTamperFails();
  await testFileRoundtrip();
  await testVectorWrappedDek();
  await testVectorObjects();
  await testAadParsing();
  console.log("\n" + passed + " checks passed.");
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
