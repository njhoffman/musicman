#!/bin/sh

# always patch the version number on update
set -e

[ -n "$_CUSTOM_RESOURCES_INNER_PRE_HOOK" ] && {
  echo " ### version patch successful"
  exit 0
}

echo "\n> pre-push: patching version number and resubmitting push"
npm version patch --force
_CUSTOM_RESOURCES_INNER_PRE_HOOK=1 git push --follow-tags
echo
echo " ### npm version bumped and pushed by git hook "
echo " ### outer push will be canceled, ignore error below "
echo " "
exit 1
