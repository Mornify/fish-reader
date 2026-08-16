# Pending CI workflows

These two GitHub Actions workflows are ready but **not yet installed**, because
the GitHub token used to push this repo lacks the `workflow` scope.

- `ci.yml` — typechecks the frontend and compiles the Rust backend on every
  push, so a broken build can never become a release that auto-updates onto
  someone's Mac.
- `pages.yml` — deploys `web/` to GitHub Pages on every change.
  (The site is currently deployed from the `gh-pages` branch instead, which
  needs no workflow scope. Installing this workflow is optional.)

## To enable

```sh
gh auth refresh -h github.com -s workflow
mkdir -p .github/workflows && cp .ci-pending/*.yml .github/workflows/
git add .github && git commit -m "Add CI workflows" && git push
```

Afterwards you can delete this folder.
