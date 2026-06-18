# Trindade QD/LT Final Safety

## Scope
- The change is limited to `app/lib/trindade-localfirst-shadow.ts`, `app/lib/trindade-shadow-types.ts`, and the controlled Trindade hook in `app/api/process/route.ts`.
- The QD/LT lookup uses the unique `bairro + quadra + lote` bucket before the logradouro fallback.
- The fallback to logradouro remains intact for residual cases.
- The production switch is gated by `ROTTA_TRINDADE_LOCALFIRST_DECISION=1`, so the default behavior stays unchanged.

## Safety Checks
1. Trindade-only scope
- The code touched is inside the Trindade LocalFirst helper plus the Trindade-only decision hook in the API route.
- No other city helper or manual map file was changed by this adjustment.

2. Unique bucket rule
- `findOperationalBairroQuadraLoteCandidate(...)` only returns when the bucket length is exactly 1.
- `findLoteCandidate(...)` also only accepts the bairro+quadra+lote bucket when it is unique.

3. Logradouro fallback
- If the operational lot bucket is not found, the matcher still continues to the exact lot, quadra+lote, rua+bairro, lot and logradouro branches.

4. Cases without QD/LT
- The non-QD/LT rows remain on the same fallback path.
- The parsing observations still report `missingQuadra: 65` and `missingLote: 65`, so the residual no-QD/LT behavior is unchanged.

5. Exact QD/LT pool
- The validation report shows 367 exact QD/LT cases.
- All 367 now resolve through `bairro+quadra+lote`.
- None remain on logradouro, lote generic, skipped, or ambiguous in the exact pool.

6. NO_MATCH
- `NO_MATCH` stayed at 10.
- No increase was introduced by this change.

7. Ambiguity
- The exact QD/LT pool has no new ambiguity.
- The runtime only accepts the bucket when it is unique.

8. Validation
- `node scripts/test-trindade-shadow-on-xlsx.mjs` passed.
- `npm.cmd run build` passed.
- `npx.cmd eslint app/lib/trindade-localfirst-shadow.ts` passed.
- `npx.cmd eslint app/api/process/route.ts` still reports the repo baseline warnings/errors unrelated to this change.
- `npx.cmd tsc --noEmit` passed.

## Final Numbers
- totalRows: 562
- trindadeRows: 552
- localFirstFound: 542
- MATCH_MEDIO: 389
- MATCH_FALLBACK: 153
- NO_MATCH: 10
- SKIPPED: 10
- exact QD/LT resolved by bairro+quadra+lote: 367
- exact QD/LT still on logradouro: 0
- controlled production route change remains gated off by default unless `ROTTA_TRINDADE_LOCALFIRST_DECISION=1`

## Remaining Risk
- The only remaining risk is the usual fallback risk for non-QD/LT rows.
- There is no evidence of a new false positive in the exact QD/LT recourse.

## Recommendation
- Maintain the change.
- No rollback is justified based on the current validation set.
