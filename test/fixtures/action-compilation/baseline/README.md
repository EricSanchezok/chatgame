# Action Compilation recorded baseline

This fixture is the immutable C0 measurement for failed execution `15629bb7-a5c4-4132-8cda-d18d6cc78be2`. It contains aggregate Ledger-derived measurements and content identities, not provider credentials or raw prompts.

Recompute and verify it against the preserved local database:

```sh
npm run benchmark:action-compilation -- \
  --database .livingworld-v19/livingworld.sqlite \
  --execution 15629bb7-a5c4-4132-8cda-d18d6cc78be2 \
  --verify test/fixtures/action-compilation/baseline/metrics.json
```

To deliberately refresh the fixture after selecting a different recorded execution, replace both the execution identity above and `metrics.json` in the same reviewed work unit. Missing token usage remains `unknown`; aggregate token totals include only provider-reported values.
