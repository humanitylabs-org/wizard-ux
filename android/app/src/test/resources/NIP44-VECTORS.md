# NIP-44 v2 public vectors

`nip44.vectors.json` is vendored unchanged from
https://github.com/paulmillr/nip44/blob/671a1f04bcfacaf125b0db68adc45bc9ce0e763b/nip44.vectors.json
(public protocol test vectors; see upstream README for implementation licenses). SHA-256:
`269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040`.

These are public synthetic test keys, never an owner key. `Nip44Test` exercises all
128 cases: 35 conversation keys, 32 message keys, 24 padding lengths, 10 ciphertext
roundtrips, 3 long messages, 8 invalid keys, 12 invalid ciphertexts, 4 invalid lengths.
The mobile implementation caps plaintext at 65535 UTF-8 bytes (original v2 limit),
even if later protocol revisions allow extended-length messages.
