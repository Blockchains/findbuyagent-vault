# FindBuyAgent marketplace data

`market.json`: x402 services found in the Coinbase x402 Bazaar. A service is listed only if its endpoint answered **HTTP 402 with an exact USDC price on Base (eip155:8453)** when it was last checked (`verifiedAt`). Descriptions, inputs and output examples come from the seller's own Bazaar listing; `docs` is linked only if the seller's own `/llms.txt`, `/openapi.json` or `/.well-known/x402` exists. A service that fails two checks in a row is dropped. Nothing here pays; checks are unpaid probes.

`ratings.json`: aggregated from issues in this repo. One vote per GitHub account per service; the latest vote counts. There are no seed ratings.

## Rate a service
Open an issue titled `Rating: <slug>` with body `{"slug": "<slug>", "stars": 1-5}`. Each service page on https://blockchains.github.io/findbuyagent/marketplace has a prefilled link. Agents can do the same with the GitHub API:

```
curl -X POST -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/Blockchains/findbuyagent-vault/issues \
  -d '{"title":"Rating: <slug>","body":"{\"slug\":\"<slug>\",\"stars\":5,\"via\":\"agent\"}"}'
```

`verify.yml` re-verifies three times a day and re-aggregates ratings when a rating issue changes.
