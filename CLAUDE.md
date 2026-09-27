# Path.er

A static website: plain HTML, CSS and JavaScript. No build step, no dependencies, no package.json. Every page works by opening its file in a browser. README.md explains what each page and file does.

## Keep it that way unless asked

- Don't add a framework, bundler or npm packages unless the owner asks for one.
- Keep every link and `src` relative (`css/site.css`, not `/css/site.css`). On GitHub Pages the site lives under `/<repo-name>/`, so paths starting with `/` break.
- Keep file names lowercase. Web hosts are case-sensitive even though Windows isn't.

## Setting up a new computer

This folder may be on a computer that has never been used for web development. Before installing anything, tell the owner what you'll install and why, and wait for a yes. On Windows 11, use winget:

| Tool | Why | Install |
|---|---|---|
| Git | Version history, and pushing to GitHub. Claude Code on Windows also uses the Git Bash shell it comes with. | `winget install --id Git.Git -e --source winget` |
| GitHub CLI (`gh`) | Creating the repo and turning on GitHub Pages | `winget install --id GitHub.cli -e --source winget` |
| Node.js LTS | A local preview server now, and build tools later if the site ever needs them | `winget install --id OpenJS.NodeJS.LTS -e --source winget` |

winget may ask to accept the package's license and its source's terms. Tell the owner, and with their OK add `--accept-package-agreements --accept-source-agreements`.

The new commands usually aren't found until the Claude app is restarted. After that:

- Ask the owner for the name and email to sign commits with, and set them with `git config --global user.name` and `git config --global user.email`.
- Ask the owner to create a GitHub account if they don't have one, then to run `gh auth login` themselves in a terminal. It signs in through their browser. Never handle their password.

`.claude/launch.json` starts a preview server with Python's `py`, which this computer may not have. If it doesn't, add a configuration that serves the folder with Node instead.

## Publishing on GitHub Pages

The first time:

1. `git init -b main`.
2. Add an empty `.nojekyll` file so GitHub serves the files exactly as they are.
3. Commit everything. Ask the owner what to call the repo (for example `path-er`), then run `gh repo create <name> --public --source . --push`. On a free account Pages only works for public repos, so the code will be public. That is true of a static site's code anyway once it's online.
4. Turn on Pages from the root of `main`: `gh api -X POST repos/<owner>/<name>/pages -f "source[branch]=main" -f "source[path]=/"`.
5. The site appears at `https://<owner>.github.io/<name>/` after a minute or two. Check `gh api repos/<owner>/<name>/pages` for its status, then open it and try all four pages.

After that, putting a change online is a commit and `git push`. Pages redeploys on its own within a minute or two.
