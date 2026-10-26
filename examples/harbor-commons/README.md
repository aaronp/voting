# Harbor Commons — polls

**[▶ View the polls](https://aaronp.github.io/voting-example/)**

The data lives in [`tally.json`](tally.json) (format:
[schema.md](https://github.com/aaronp/voting/blob/master/schema.md)). The UI comes from
[aaronp/voting](https://github.com/aaronp/voting).

## Using this as a template

1. Create an empty repo on GitHub, then from this directory run
   `make clone REPO=you/your-repo` (or `./clone.sh`, which prompts).
   It copies the files to `../your-repo`, points the View link above at
   your Pages site and sets the git remote.
2. Replace the polls with your own: draft and mint them in the app, then **Download**
   `tally.json`, commit and push. Entries are signed, so hand edits break verification
   (the app will show exactly where).
3. On GitHub: Settings → Pages → Source: **GitHub Actions**.
4. Optional: on the repo page, open About (⚙) → tick **Use your GitHub Pages
   website** so the link also shows in the sidebar.

The workflow deploys from `main` or `master`. "Branch … is not allowed to
deploy to github-pages"? Add your branch under Settings → Environments →
github-pages → Deployment branches and tags.

Your site redirects to the app with `?src=` pointing at your `tally.json`.
Any query params you add are passed on, e.g. `?filter=closed` or `?theme=night`.

No Pages? Link straight to the file:
`https://aaronp.github.io/voting/?src=https://github.com/<you>/<repo>/blob/<branch>/tally.json`
