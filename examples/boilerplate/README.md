# Boilerplate: a repository with a context budget

A small starter that a new repository can copy, or that a scaffold can generate.
It has the three files that make the context budget visible from the first
commit:

| File | What it does |
| --- | --- |
| `AGENTS.md` | The instructions an agent reads, with the `ctxcap` block in it |
| `.ctxcap.json` | A 2,000-token total budget and `failOn: increase` |
| `.github/workflows/ctxcap.yml` | Runs the action on every pull request |
| `ctxcap-baseline.json` | The first measurement, so the first pull request compares against it |

To use it, copy the files and commit them. The baseline is already there; if
you edit `AGENTS.md` before committing, refresh it:

```bash
cp -r examples/boilerplate/. .
npx ctxcap --update-baseline   # after any edit to AGENTS.md
git add . && git commit -m "Add a context budget"
```

Or let `init` write the wiring for the agents the repository actually uses:

```bash
npx ctxcap init        # print every file it would touch
npx ctxcap init --yes  # write them
```

`init` is reversible (`npx ctxcap init --remove`) and writes nothing without
`--yes`. The action uses `@v1`, the moving major alias, so the template does
not pin a patch version.

## For a scaffold or starter-kit maintainer

The smallest useful change is one file and one line. Add this to the generated
`AGENTS.md`, or to the template it comes from:

```markdown
- Before editing AGENTS.md or CLAUDE.md, run `npx -y ctxcap --stale --json` and keep the total from growing.
```

That line costs about 30 tokens and puts the measurement in front of every
repository generated from the template. If you want the full wiring, run
`npx ctxcap init --yes` in the template repository once and commit the diff.
