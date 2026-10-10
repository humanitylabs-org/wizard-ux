"""Wizard ID relay helper for the Wizard OS shell server (stdlib only).

The shell's CSP keeps the page on its own origin, so publishing a signed Wizard ID event and reading a profile go
through here. Nothing here can sign: it only verifies (id hash + BIP-340) and relays events the phone already signed.
Crypto and the websocket client are copied from wizard-app-manager/wam/nostr.py (same tests, same vectors).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import ssl
import struct
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

# The big public relays plus a profile index, so a name shows up wherever people look.
RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://purplepag.es"]
# Kinds the shell may publish through this server for now: profile (0). App announcements (30617) come with step 2.
PUBLISH_KINDS = {0}


_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _polymod(values: list[int]) -> int:
    gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if (top >> i) & 1 else 0
    return chk


def _hrp_expand(hrp: str) -> list[int]:
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def _convertbits(data, frombits: int, tobits: int, pad: bool) -> list[int]:
    acc = bits = 0
    out: list[int] = []
    maxv = (1 << tobits) - 1
    for v in data:
        acc = (acc << frombits) | v
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            out.append((acc >> bits) & maxv)
    if pad and bits:
        out.append((acc << (tobits - bits)) & maxv)
    elif not pad and (bits >= frombits or ((acc << (tobits - bits)) & maxv)):
        raise ValueError("invalid padding")
    return out


def npub_to_hex(npub: str) -> str:
    s = npub.strip().lower()
    hrp, _, data = s.rpartition("1")
    if hrp != "npub" or any(c not in _CHARSET for c in data):
        raise ValueError(f"not an npub: {npub}")
    vals = [_CHARSET.index(c) for c in data]
    if _polymod(_hrp_expand(hrp) + vals) != 1:
        raise ValueError(f"bad npub checksum: {npub}")
    raw = bytes(_convertbits(vals[:-6], 5, 8, False))
    if len(raw) != 32:
        raise ValueError(f"npub is not 32 bytes: {npub}")
    return raw.hex()


def hex_to_npub(hexkey: str) -> str:
    vals = _convertbits(bytes.fromhex(hexkey), 8, 5, True)
    chk = _polymod(_hrp_expand("npub") + vals + [0] * 6) ^ 1
    vals += [(chk >> 5 * (5 - i)) & 31 for i in range(6)]
    return "npub1" + "".join(_CHARSET[v] for v in vals)


# ---------------------------------------------------------- BIP-340 verification

_P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
      0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def _add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and a[1] != b[1]:
        return None
    if a == b:
        lam = 3 * a[0] * a[0] * pow(2 * a[1], _P - 2, _P) % _P
    else:
        lam = (b[1] - a[1]) * pow(b[0] - a[0], _P - 2, _P) % _P
    x = (lam * lam - a[0] - b[0]) % _P
    return (x, (lam * (a[0] - x) - a[1]) % _P)


def _mul(p, n):
    r = None
    while n:
        if n & 1:
            r = _add(r, p)
        p = _add(p, p)
        n >>= 1
    return r


def _tagged(tag: str, msg: bytes) -> bytes:
    t = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(t + t + msg).digest()


def _lift_x(x: int):
    if x >= _P:
        return None
    y2 = (pow(x, 3, _P) + 7) % _P
    y = pow(y2, (_P + 1) // 4, _P)
    if y * y % _P != y2:
        return None
    return (x, y if y % 2 == 0 else _P - y)


def schnorr_verify(msg: bytes, pubkey: bytes, sig: bytes) -> bool:
    if len(pubkey) != 32 or len(sig) != 64:
        return False
    pt = _lift_x(int.from_bytes(pubkey, "big"))
    r = int.from_bytes(sig[:32], "big")
    s = int.from_bytes(sig[32:], "big")
    if pt is None or r >= _P or s >= _N:
        return False
    e = int.from_bytes(_tagged("BIP0340/challenge", sig[:32] + pubkey + msg), "big") % _N
    R = _add(_mul(_G, s), _mul(pt, _N - e))
    return R is not None and R[1] % 2 == 0 and R[0] == r


def event_id(ev: dict) -> str:
    ser = json.dumps([0, ev["pubkey"], ev["created_at"], ev["kind"], ev["tags"], ev["content"]],
                     separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(ser.encode()).hexdigest()


def verify_event(ev: dict) -> bool:
    try:
        if event_id(ev) != ev["id"]:
            return False
        return schnorr_verify(bytes.fromhex(ev["id"]), bytes.fromhex(ev["pubkey"]), bytes.fromhex(ev["sig"]))
    except Exception:  # noqa: BLE001
        return False



# ------------------------------------------------------- minimal websocket client

class _WS:
    def __init__(self, url: str, timeout: float = 10):
        u = urlparse(url)
        port = u.port or (443 if u.scheme == "wss" else 80)
        raw = socket.create_connection((u.hostname, port), timeout=timeout)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=u.hostname) if u.scheme == "wss" else raw
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {u.path or '/'} HTTP/1.1\r\nHost: {u.hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: wizard-os-home\r\n\r\n")
        self.sock.sendall(req.encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise ConnectionError(f"{url}: closed during handshake")
            head += chunk
        status, _, rest = head.partition(b"\r\n\r\n")
        first = status.split(b"\r\n")[0]
        if b" 101 " not in first:
            raise ConnectionError(f"{url}: {first.decode(errors='replace')}")
        self.buf = rest

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text: str) -> None:
        data = text.encode()
        mask = os.urandom(4)
        n = len(data)
        hdr = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else
                               bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else
                               bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.sock.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self) -> str | None:
        msg = b""
        while True:
            b1, b2 = self._read(2)
            op, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(n)
            if op == 0x8:
                return None
            if op == 0x9:  # ping -> pong
                mask = os.urandom(4)
                self.sock.sendall(bytes([0x8A, 0x80 | len(payload)]) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
                continue
            msg += payload
            if b1 & 0x80:
                return msg.decode(errors="replace")

    def close(self) -> None:
        try:
            self.sock.close()
        except Exception:  # noqa: BLE001
            pass


def publish_one(relay: str, ev: dict, timeout: float = 8) -> dict:
    """Send one EVENT, wait for its OK. Returns {relay, ok, message}."""
    try:
        ws = _WS(relay, timeout)
    except Exception as e:  # noqa: BLE001
        return {"relay": relay, "ok": False, "message": str(e)[:200]}
    try:
        ws.send(json.dumps(["EVENT", ev], separators=(",", ":"), ensure_ascii=False))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = ws.recv()
            if raw is None:
                break
            msg = json.loads(raw)
            if msg and msg[0] == "OK" and len(msg) > 2 and msg[1] == ev["id"]:
                return {"relay": relay, "ok": bool(msg[2]), "message": str(msg[3] if len(msg) > 3 else "")[:200]}
            if msg and msg[0] == "NOTICE":
                continue
        return {"relay": relay, "ok": False, "message": "no answer"}
    except Exception as e:  # noqa: BLE001
        return {"relay": relay, "ok": False, "message": str(e)[:200]}
    finally:
        ws.close()


def query(relay: str, filt: dict, timeout: float = 8) -> list[dict]:
    ws = _WS(relay, timeout)
    sub = uuid.uuid4().hex[:12]
    out: list[dict] = []
    try:
        ws.send(json.dumps(["REQ", sub, filt]))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = ws.recv()
            if raw is None:
                break
            msg = json.loads(raw)
            if msg[0] == "EVENT" and msg[1] == sub:
                out.append(msg[2])
            elif msg[0] in {"EOSE", "CLOSED"} and msg[1] == sub:
                break
    finally:
        ws.close()
    return out


def check_event(ev) -> str | None:
    """None if this is a well-formed, correctly signed event we may relay; otherwise the reason."""
    if not isinstance(ev, dict):
        return "no event"
    for k, t in (("id", str), ("pubkey", str), ("sig", str), ("content", str), ("tags", list)):
        if not isinstance(ev.get(k), t):
            return "malformed event"
    if not isinstance(ev.get("kind"), int) or not isinstance(ev.get("created_at"), int):
        return "malformed event"
    if ev["kind"] not in PUBLISH_KINDS:
        return "kind not allowed"
    if abs(ev["created_at"] - time.time()) > 3600:
        return "event time is off"
    if len(json.dumps(ev)) > 64 * 1024:
        return "event too large"
    if not verify_event(ev):
        return "bad signature"
    return None


def publish(ev: dict, relays: list[str] | None = None) -> dict:
    why = check_event(ev)
    if why:
        return {"ok": False, "error": why}
    rs = relays or RELAYS
    with ThreadPoolExecutor(max_workers=len(rs)) as ex:
        results = list(ex.map(lambda r: publish_one(r, ev), rs))
    return {"ok": any(r["ok"] for r in results), "id": ev["id"], "relays": results}


def profile(pubkey: str, relays: list[str] | None = None) -> dict | None:
    """Newest verified kind-0 for pubkey across relays, parsed. None if nobody has one."""
    if not isinstance(pubkey, str) or len(pubkey) != 64 or any(c not in "0123456789abcdef" for c in pubkey):
        raise ValueError("pubkey must be 64 lower-case hex")
    rs = relays or RELAYS

    def one(r):
        try:
            return query(r, {"kinds": [0], "authors": [pubkey], "limit": 3})
        except Exception:  # noqa: BLE001
            return []
    with ThreadPoolExecutor(max_workers=len(rs)) as ex:
        evs = [e for batch in ex.map(one, rs) for e in batch]
    good = [e for e in evs if e.get("pubkey") == pubkey and e.get("kind") == 0 and verify_event(e)]
    if not good:
        return None
    best = max(good, key=lambda e: e["created_at"])
    try:
        meta = json.loads(best["content"])
    except Exception:  # noqa: BLE001
        meta = {}
    return {"created_at": best["created_at"], "id": best["id"],
            "name": str(meta.get("display_name") or meta.get("name") or "")[:120],
            "picture": str(meta.get("picture") or "")[:500], "about": str(meta.get("about") or "")[:500]}
