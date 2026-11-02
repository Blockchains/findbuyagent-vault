# findbuyagent-vault

Public, **encrypted-only** store for FindBuyAgent burner-wallet receipts. Written by the private runner (Blockchains/findbuyagent-runner) through a deploy key; read by https://blockchains.github.io/findbuyagent/budget ("My purchases").

- `v/<wallet>/index.json`: which receipt files belong to that wallet (budget and request numbers only).
- `v/<wallet>/<budget>-<request>.json`: `{ v, alg, epk, nonce, ct }`, a nacl.box (X25519 + XSalsa20-Poly1305) ciphertext to that wallet's vault public key.

The vault key is derived in the browser from the wallet's signature of a fixed message (sha256 of the signature = X25519 secret). Nobody without that wallet's signature can read these files. Nothing in this repo is plaintext.
