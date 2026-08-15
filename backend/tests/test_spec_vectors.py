"""Known-answer tests against published spec vectors.

Sources:
- AES-256-GCM: NIST SP 800-38D (gcmEncryptExtIV256.rsp). Vectors were
  cross-verified against OpenSSL; case2 ciphertext/tag match the published
  NIST values exactly, so OpenSSL output is the reference for the rest.
- HKDF-SHA-256: RFC 5869, test cases 1 and 2.
"""

from app.crypto.aes_gcm import AESGCMEngine
from app.crypto.kdf import KDFEngine

AES_GCM_VECTORS = [
    {
        "name": "nist_gcm256_case1_empty",
        "key": "b52c505a37d78eda5dd34f20c22540ea1b58963cf8e5bf8ffa85f9f2492505b4",
        "iv": "516c33929df5a3284ff463d7",
        "aad": "",
        "pt": "",
        "ct": "",
        "tag": "bdc1ac884d332457a1d2664f168c76f0",
    },
    {
        "name": "nist_gcm256_case2",
        "key": "31bdadd96698c204aa9ce1448ea94ae1fb4a9a0b3c9d773b51bb1822666b8f22",
        "iv": "0d18e06c7c725ac9e362e1ce",
        "aad": "",
        "pt": "2db5168e932556f8089a0622981d017d",
        "ct": "fa4362189661d163fcd6a56d8bf0405a",
        "tag": "d636ac1bbedd5cc3ee727dc2ab4a9489",
    },
    {
        "name": "nist_gcm256_with_aad",
        "key": "31bdadd96698c204aa9ce1448ea94ae1fb4a9a0b3c9d773b51bb1822666b8f22",
        "iv": "0d18e06c7c725ac9e362e1ce",
        "aad": "4c1ca807f67f08bd",
        "pt": "930a882e67b45b6a63f8d05e3d80fb90",
        "ct": "44fcfcb862f0dcf197b473112e6dbab7",
        "tag": "d220bd58702a3df018d2cece345e3166",
    },
    {
        "name": "nist_gcm256_long",
        "key": "31bdadd96698c204aa9ce1448ea94ae1fb4a9a0b3c9d773b51bb1822666b8f22",
        "iv": "0d18e06c7c725ac9e362e1ce",
        "aad": "fa4362189661d163fcd6a56d8bf0405a",
        "pt": (
            "2db5168e932556f8089a0622981d017d"
            "2db5168e932556f8089a0622981d017d"
            "2db5168e932556f8089a0622981d017d"
            "2db5168e932556f8089a0622981d017d"
        ),
        "ct": (
            "fa4362189661d163fcd6a56d8bf0405a"
            "1c4cb17d5e03b0dfc5ba52d78d36542a"
            "0cfab14aa81d6a6668a16c3d3f768a42"
            "814a758996d38c894719e465586d3972"
        ),
        "tag": "74226e4f28e4024bd8855620ec42d8e9",
    },
]

HKDF_VECTORS = [
    {
        "name": "rfc5869_case1",
        "ikm": "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
        "salt": "000102030405060708090a0b0c",
        "info": "f0f1f2f3f4f5f6f7f8f9",
        "len": 42,
        "prk": "077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5",
        "okm": ("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"),
    },
    {
        "name": "rfc5869_case2",
        "ikm": (
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
            "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
            "404142434445464748494a4b4c4d4e4f"
        ),
        "salt": (
            "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f"
            "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f"
            "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf"
        ),
        "info": (
            "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf"
            "d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef"
            "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff"
        ),
        "len": 82,
        "prk": "06a6b88c5853361a06104c9ceb35b45cef760014904671014a193f40c15fc244",
        "okm": (
            "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c"
            "59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71c"
            "c30c58179ec3e87c14c01d5c1f3434f1d87"
        ),
    },
]


class TestAesGcmSpecVectors:
    def test_encrypt_matches_reference(self) -> None:
        engine = AESGCMEngine()
        for vec in AES_GCM_VECTORS:
            key = bytes.fromhex(vec["key"])
            nonce = bytes.fromhex(vec["iv"])
            aad = bytes.fromhex(vec["aad"]) if vec["aad"] else b""
            plaintext = bytes.fromhex(vec["pt"])
            expected_ct = bytes.fromhex(vec["ct"])
            expected_tag = bytes.fromhex(vec["tag"])

            ciphertext, used_nonce, tag = engine.encrypt(key, plaintext, aad=aad, nonce=nonce)

            assert used_nonce == nonce, vec["name"]
            assert ciphertext == expected_ct, f"{vec['name']}: ciphertext mismatch"
            assert tag == expected_tag, f"{vec['name']}: tag mismatch"

    def test_decrypt_matches_reference(self) -> None:
        engine = AESGCMEngine()
        for vec in AES_GCM_VECTORS:
            key = bytes.fromhex(vec["key"])
            nonce = bytes.fromhex(vec["iv"])
            aad = bytes.fromhex(vec["aad"]) if vec["aad"] else b""
            ciphertext = bytes.fromhex(vec["ct"])
            tag = bytes.fromhex(vec["tag"])
            expected_pt = bytes.fromhex(vec["pt"])

            plaintext = engine.decrypt(key, ciphertext, nonce, tag, aad=aad)

            assert plaintext == expected_pt, f"{vec['name']}: plaintext mismatch"

    def test_encrypt_decrypt_roundtrip(self) -> None:
        engine = AESGCMEngine()
        for vec in AES_GCM_VECTORS:
            key = bytes.fromhex(vec["key"])
            nonce = bytes.fromhex(vec["iv"])
            aad = bytes.fromhex(vec["aad"]) if vec["aad"] else b""
            plaintext = bytes.fromhex(vec["pt"])
            ciphertext, _, tag = engine.encrypt(key, plaintext, aad=aad, nonce=nonce)
            recovered = engine.decrypt(key, ciphertext, nonce, tag, aad=aad)
            assert recovered == plaintext, vec["name"]


class TestHkdfSha256SpecVectors:
    def test_extract_matches_prk(self) -> None:
        engine = KDFEngine()
        for vec in HKDF_VECTORS:
            ikm = bytes.fromhex(vec["ikm"])
            salt = bytes.fromhex(vec["salt"])
            prk = engine.extract(ikm, salt)
            assert prk.hex() == vec["prk"], f"{vec['name']}: PRK mismatch"

    def test_expand_matches_okm(self) -> None:
        engine = KDFEngine()
        for vec in HKDF_VECTORS:
            prk = bytes.fromhex(vec["prk"])
            info = bytes.fromhex(vec["info"])
            okm = engine.expand(prk, info, length=vec["len"])
            assert okm.hex() == vec["okm"], f"{vec['name']}: OKM mismatch"

    def test_derive_matches_okm(self) -> None:
        engine = KDFEngine()
        for vec in HKDF_VECTORS:
            ikm = bytes.fromhex(vec["ikm"])
            salt = bytes.fromhex(vec["salt"])
            info = bytes.fromhex(vec["info"])
            okm = engine.derive(ikm, info, length=vec["len"], salt=salt)
            assert okm.hex() == vec["okm"], f"{vec['name']}: OKM mismatch"
