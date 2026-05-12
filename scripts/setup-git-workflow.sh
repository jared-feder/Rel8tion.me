#!/usr/bin/env bash
set -euo pipefail

echo "REL8TION Git workflow setup helper"
echo "This script is safe and informational. It will not force-push, delete, rename, or recreate existing branches."
echo ""

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script from inside the REL8TION.me git repository."
  exit 1
fi

remote_name="${1:-origin}"

has_local_branch() {
  git show-ref --verify --quiet "refs/heads/$1"
}

has_remote_branch() {
  git ls-remote --exit-code --heads "${remote_name}" "$1" >/dev/null 2>&1
}

current_branch="$(git branch --show-current || true)"
echo "Current branch: ${current_branch:-detached HEAD}"
echo "Remote: ${remote_name}"
echo ""

main_local="no"
main_remote="no"
staging_local="no"
staging_remote="no"

if has_local_branch main; then main_local="yes"; fi
if has_remote_branch main; then main_remote="yes"; fi
if has_local_branch staging; then staging_local="yes"; fi
if has_remote_branch staging; then staging_remote="yes"; fi

echo "Branch detection:"
echo "- local main: ${main_local}"
echo "- remote main: ${main_remote}"
echo "- local staging: ${staging_local}"
echo "- remote staging: ${staging_remote}"
echo ""

if [[ "${main_local}" != "yes" && "${main_remote}" != "yes" ]]; then
  echo "Error: main was not found locally or on ${remote_name}. Create/restore main before configuring this workflow."
  exit 1
fi

if [[ "${staging_local}" == "yes" || "${staging_remote}" == "yes" ]]; then
  echo "staging already exists. The script will not recreate it."
  echo ""
else
  echo "staging does not exist locally or on ${remote_name}."
  echo "If you continue, this script will:"
  echo "1. switch to main"
  echo "2. update main from ${remote_name}/main when remote main exists"
  echo "3. create local staging from main"
  echo "4. push staging to ${remote_name}"
  echo ""
  read -r -p "Create staging from main and push it? Type 'yes' to continue: " confirm

  if [[ "${confirm}" != "yes" ]]; then
    echo "No branch changes made."
  else
    if [[ "${main_local}" != "yes" && "${main_remote}" == "yes" ]]; then
      echo "Creating local main from ${remote_name}/main."
      git fetch "${remote_name}" main
      git switch -c main "${remote_name}/main"
    else
      git switch main
      if [[ "${main_remote}" == "yes" ]]; then
        git pull --ff-only "${remote_name}" main
      fi
    fi

    git switch -c staging
    git push -u "${remote_name}" staging
    echo "Created and pushed staging."
  fi
fi

echo ""
echo "Manual next steps:"
echo "1. Configure GitHub branch protection for main."
echo "2. Require pull requests into main."
echo "3. Require status checks, including Branch Safety and Repo Checks."
echo "4. Block force pushes."
echo "5. Block branch deletions."
echo "6. Restrict direct pushes to main if available."
echo "7. Set Vercel production branch to main."
echo ""
echo "Recommended workflow:"
echo "- feature/* branches start from staging and merge into staging."
echo "- staging merges into main only after testing."
echo "- hotfix/* branches start from main, merge into main, then main merges back into staging."
