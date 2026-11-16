# Ready to send

One directory pair per verified defect: a pull request body and a patch.
Nothing has been sent. To send one, fork the repository, apply the patch on
a branch, and open the pull request with the body:

```bash
gh repo fork <owner>/<name> --clone --remote
git apply <slug>.patch   # or apply by hand; each patch is one line
git push -u origin HEAD
gh pr create --repo <owner>/<name> --title "docs: fix a dead reference in AGENTS.md" --body-file <slug>.md
```

- [twbs-bootstrap-CLAUDE-md](.)
- [avelino-awesome-go-github-scripts-check-quality-js](.)
