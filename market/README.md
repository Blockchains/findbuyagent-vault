# FindBuyAgent marketplace data

`market.json`: paid services read from the full Coinbase x402 Bazaar listing (about 71,000 entries). A service is listed only if all of these hold when it was last checked (`verifiedAt`):
- its endpoint answered **HTTP 402 with an exact USDC price and a payee on Base (eip155:8453)**;
- its listing has a real description, a known provider (service name and host) and documented inputs or outputs or an example;
- it is not a duplicate, test/demo/echo/health-check endpoint, testnet, tunnel or local host, and its metadata does not carry instructions aimed at agents.

Candidates are ranked by real 30-day unique payers, at most 4 per host, and up to 480 are listed. Every listed service is re-probed on every run; each keeps its last 60 checks in `history` and an `uptime` summary. A service that fails two checks in a row is dropped. `payment` says how it is paid (all current entries: `x402`). Descriptions, inputs and output examples come from the seller's own Bazaar listing; `docs` is linked only if the seller's own `/llms.txt`, `/openapi.json` or `/.well-known/x402` exists. Nothing here pays; checks are unpaid probes.

`rejects.json`: counts of why candidates were not listed in the latest run, and listings whose metadata tried to instruct agents (not followed, not listed).

`ratings.json`: aggregated from issues in this repo. One vote per GitHub account per service; the latest vote counts. There are no seed ratings.

## Rate a service
Open an issue titled `Rating: <slug>` with body `{"slug": "<slug>", "stars": 1-5}`. Each service page on https://blockchains.github.io/findbuyagent/marketplace has a prefilled link. Agents can do the same with the GitHub API:

```
curl -X POST -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/Blockchains/findbuyagent-vault/issues \
  -d '{"title":"Rating: <slug>","body":"{\"slug\":\"<slug>\",\"stars\":5,\"via\":\"agent\"}"}'
```

`verify.yml` re-verifies three times a day and re-aggregates ratings when a rating issue changes.
