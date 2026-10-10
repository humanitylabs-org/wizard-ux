"""wizard_id.py: verify-before-relay, kind allowlist, profile pick. Run: python3 -m unittest test_wizard_id"""
import hashlib
import json
import time
import unittest
from unittest import mock

import wizard_id as W


def _sign(sk: int, ev: dict) -> dict:
    """BIP-340 sign with the reference math (test only)."""
    P = W._mul(W._G, sk)
    d = sk if P[1] % 2 == 0 else W._N - sk
    pub = P[0].to_bytes(32, "big")
    ev = dict(ev, pubkey=pub.hex())
    ev["id"] = W.event_id(ev)
    msg = bytes.fromhex(ev["id"])
    aux = b"\x01" * 32
    t = (d ^ int.from_bytes(W._tagged("BIP0340/aux", aux), "big")).to_bytes(32, "big")
    k0 = int.from_bytes(W._tagged("BIP0340/nonce", t + pub + msg), "big") % W._N
    R = W._mul(W._G, k0)
    k = k0 if R[1] % 2 == 0 else W._N - k0
    r = R[0].to_bytes(32, "big")
    e = int.from_bytes(W._tagged("BIP0340/challenge", r + pub + msg), "big") % W._N
    ev["sig"] = (r + ((k + e * d) % W._N).to_bytes(32, "big")).hex()
    return ev


def _profile(sk=7, at=None, name="Robin"):
    return _sign(sk, {"kind": 0, "created_at": at or int(time.time()), "tags": [], "content": json.dumps({"name": name})})


class Checks(unittest.TestCase):
    def test_good_profile_passes(self):
        self.assertIsNone(W.check_event(_profile()))

    def test_tampered_or_forged_refused(self):
        ev = _profile()
        bad = dict(ev, content=json.dumps({"name": "Mallory"}))
        self.assertEqual(W.check_event(bad), "bad signature")
        bad = dict(ev, sig=ev["sig"][:-2] + ("00" if ev["sig"][-2:] != "00" else "11"))
        self.assertEqual(W.check_event(bad), "bad signature")

    def test_only_profiles_for_now(self):
        post = _sign(7, {"kind": 1, "created_at": int(time.time()), "tags": [], "content": "gm"})
        self.assertEqual(W.check_event(post), "kind not allowed")

    def test_stale_and_malformed(self):
        self.assertEqual(W.check_event(_profile(at=int(time.time()) - 7200)), "event time is off")
        self.assertEqual(W.check_event({"kind": 0}), "malformed event")
        self.assertEqual(W.check_event(None), "no event")

    def test_publish_never_contacts_relays_for_bad_events(self):
        with mock.patch.object(W, "publish_one") as one:
            out = W.publish(dict(_profile(), content="{}"))
        self.assertFalse(out["ok"])
        one.assert_not_called()

    def test_publish_fans_out_and_succeeds_if_any_relay_accepts(self):
        ev = _profile()
        answers = {"wss://a": {"relay": "wss://a", "ok": False, "message": "down"}, "wss://b": {"relay": "wss://b", "ok": True, "message": ""}}
        with mock.patch.object(W, "publish_one", side_effect=lambda r, e: answers[r]):
            out = W.publish(ev, ["wss://a", "wss://b"])
        self.assertTrue(out["ok"])
        self.assertEqual(out["id"], ev["id"])

    def test_profile_takes_newest_verified(self):
        old, new = _profile(at=1000, name="Old"), _profile(at=2000, name="New")
        forged = dict(_profile(at=3000, name="Forged"), sig="00" * 64)
        pub = new["pubkey"]
        with mock.patch.object(W, "query", side_effect=lambda r, f: [old, forged] if r == "wss://a" else [new]):
            p = W.profile(pub, ["wss://a", "wss://b"])
        self.assertEqual(p["name"], "New")
        with self.assertRaises(ValueError):
            W.profile("NPUB", ["wss://a"])


if __name__ == "__main__":
    unittest.main()
