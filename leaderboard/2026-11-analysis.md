# Does size correlate with stars? 2026-11

The table invites a guess: the best-maintained projects have the smallest
context files. The three smallest files in this month's index belong to
`ollama/ollama` (21 and 91 tokens), `react/react` (87), and
`microsoft/vscode` (51), each with 187k to 252k stars. If that pattern held,
the headline would be "the repositories that need instructions least have the
fewest."

It does not hold in this sample. Checked rather than eyeballed:

| Question | n | Spearman ρ | permutation p |
| --- | ---: | ---: | ---: |
| Repository total tokens vs stars | 25 | 0.269 | 0.1943 |
| One row per file vs stars | 30 | 0.328 | 0.0774 |
| Without files under 200 tokens | 26 | 0.288 | 0.1552 |

The 95% bootstrap interval for the repository-level ρ is −0.121 to 0.575.

## How it was checked

`node scripts/analyze.mjs` reads only the committed `2026-11.json`. Ranks are
used (Spearman), because both stars and tokens are skewed. The permutation
test shuffles stars against tokens 20,000 times with a fixed seed and counts
how often the absolute correlation is at least as large as the observed one;
the p-value is two-sided. The bootstrap resamples repository pairs 2,000 times,
also with a fixed seed. A second run prints the same numbers.

The three rows answer three versions of the question: one repository one vote
(its files added up), one file one vote, and one file one vote with the
under-200-token files left out, in case the clean files were driving the result.

## What the numbers say

- The association is **weak and positive, not inverse**. Larger files, if
  anything, sit with larger repositories.
- It is not statistically distinguishable from zero at the usual threshold.
  The per-file p-value (0.0774) is the closest, and it is not significant.
- The clean-file pattern is real but local: five files under 100 tokens, in
  four very large repositories. It is not a trend across the sample. The
  largest file, `n8n-io/n8n` at 6,249 tokens, is also in a repository with
  210k stars; `openclaw` has 394k stars and a 4,124-token file.
- The extremes say the same thing. The five smallest files sit in
  repositories with a median of 194,770 stars. The five largest sit in
  repositories with a median of 226,984. If the best-maintained wrote the
  least, that comparison would be the other way round.

## What would change the answer

- **More repositories.** 25 is small. The index stops at 25 hits out of 56
  checked, which is the sample the rate is measured on; using all 56 would
  raise power, not change the direction by itself.
- **Repeated months.** One month cannot separate a repository's habits from
  its age or its language. The month-over-month delta in the table is the
  beginning of that time series.
- **Nested files.** Depth 1 counts only the root. A repository with a small
  root and a large `packages/*/AGENTS.md` looks clean here and is not.

Until one of those runs, this is not a headline. It is a null result,
published because the alternative was to repeat a guess that the data does not
support.
