"""Explicit owner-assisted QPA1 recovery. Never changes the original SD files.

Usage: python scripts/recover-sd-recording.py INPUT.qpa OUTPUT.wav --key-file PRIVATE_KEY_FILE
The key file must contain the backed-up 32-byte key as 64 hex characters. Never
put a key in command-line arguments, a repository or a support log.
"""
from __future__ import annotations
import argparse
import hashlib
import hmac
import os
from pathlib import Path
import struct
import wave
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HEADER_BYTES = 144
BLOCK_BYTES = 4096
MAX_PCM_BYTES = 268435456 - 44


def recover(source: Path, output: Path, key_file: Path) -> tuple[int, bool]:
    source = source.resolve(strict=True)
    output = output.resolve()
    if source == output or output.exists():
        raise ValueError("Choose a new output file; originals are never overwritten.")
    key = bytes.fromhex(key_file.read_text(encoding="ascii").strip())
    if len(key) != 32:
        raise ValueError("The recovery key file must contain exactly 64 hex characters.")
    complete = True
    samples = 0
    created = False
    try:
        with source.open("rb") as archive:
            header = archive.read(HEADER_BYTES)
            if len(header) != HEADER_BYTES or header[:4] != b"QPA1":
                raise ValueError("Unsupported archive format.")
            version, source_kind, rate = struct.unpack_from("<III", header, 4)
            if version != 1 or source_kind not in (0, 1) or rate != 16000:
                raise ValueError("Unsupported archive format.")
            file_key = hmac.new(key, header, hashlib.sha256).digest()
            cipher = AESGCM(file_key)
            descriptor = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            created = True
            with os.fdopen(descriptor, "wb") as handle:
                with wave.open(handle, "wb") as audio:
                    audio.setnchannels(1)
                    audio.setsampwidth(2)
                    audio.setframerate(16000)
                    index = 0
                    while True:
                        length_bytes = archive.read(4)
                        if not length_bytes:
                            break
                        if len(length_bytes) != 4:
                            complete = False
                            break
                        length = struct.unpack("<I", length_bytes)[0]
                        if not 0 < length <= BLOCK_BYTES or length % 2:
                            raise ValueError("Invalid authenticated block length.")
                        encrypted = archive.read(length + 16)
                        if len(encrypted) != length + 16:
                            complete = False
                            break
                        nonce = header[124:132] + struct.pack("<I", index)
                        aad = header + struct.pack("<II", index, length)
                        pcm = cipher.decrypt(nonce, encrypted, aad)
                        samples += len(pcm) // 2
                        if samples * 2 > MAX_PCM_BYTES:
                            raise ValueError("Archive exceeds the supported recording limit.")
                        audio.writeframesraw(pcm)
                        index += 1
                        if length < BLOCK_BYTES:
                            if archive.read(1):
                                raise ValueError("Unexpected bytes after the final block.")
                            break
                handle.flush()
                os.fsync(handle.fileno())
        if not samples:
            raise ValueError("No authenticated audio blocks were recovered.")
        return samples, complete
    except Exception:
        # Only remove the newly created output, never the input or key file.
        if created and output.exists():
            output.unlink()
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--key-file", type=Path, required=True)
    args = parser.parse_args()
    try:
        samples, complete = recover(args.input, args.output, args.key_file)
    except Exception:
        print("Recovery failed. Original files were preserved. Check the key, archive integrity and output permissions.")
        return 1
    status = "authenticated blocks recovered" if complete else "authenticated prefix recovered; final write was interrupted"
    print(f"{samples / 16000:.2f} seconds: {status}. Check against the encrypted session manifest before declaring the meeting complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
