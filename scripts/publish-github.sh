#!/usr/bin/env bash
# Publishes this folder as a public GitHub repo under the account you pick.
#   bash scripts/publish-github.sh <repo-name> "<Your Name for LICENSE>" [expected-email]
# Needs git and the GitHub CLI (gh). Run it on your own computer, from the project folder.
set -euo pipefail
REPO="${1:?usage: publish-github.sh <repo-name> \"<license holder>\" [email]}"
HOLDER="${2:?license holder name required}"
EMAIL="${3:?email that your gh account lists (use your GitHub noreply address to keep it private)}"

echo "Accounts gh knows about:"; gh auth status || true
echo
echo "Logged in as: $(gh api user --jq .login)"
if ! gh api user/emails --jq '.[].email' 2>/dev/null | grep -qx "$EMAIL"; then
  echo "This gh account does not list $EMAIL. Run: gh auth switch   (or gh auth login) and re-run."; exit 1
fi
read -r -p "Create public repo '$(gh api user --jq .login)/$REPO' and push? [y/N] " ok
[ "$ok" = "y" ] || { echo "cancelled"; exit 1; }

sed -i.bak "s/<your name>/$HOLDER/g" LICENSE && rm -f LICENSE.bak
[ -d .git ] || git init -b main
git config user.email "$EMAIL"
git config user.name "$HOLDER"
git add -A
git commit -m "Tessel 0.8.0: highlights and comments for AI chats"
gh repo create "$REPO" --public --source . --remote origin --push \
  --description "Permanent highlights and comments for Claude and ChatGPT chats, with shareable HTML export. Keyboard-first, local-only."
gh repo edit --add-topic browser-extension --add-topic claude --add-topic chatgpt --add-topic knowledge-base --add-topic highlighter --add-topic firefox-addon --add-topic chrome-extension
echo "Done. Next: attach dist/tessel-*-$(node -p "require('./package.json').version").zip to a release:"
echo "  gh release create v$(node -p "require('./package.json').version") dist/tessel-*.zip --generate-notes"
