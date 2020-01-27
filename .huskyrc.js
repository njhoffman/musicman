const tasks = arr => arr.join(' && ');

const hooks = {
  // 'pre-commit': tasks(['npm run lint', 'npm run test']),
  // 'pre-push': './.bin/prePushVersion.sh',
  'commit-msg': 'commitlint -E HUSKY_GIT_PARAMS',
  'pre-push': tasks(['npm run test', 'npm run todos', '.bin/prePushVersion']),
  'post-push': tasks([
    'npm run todos',
    'npm outdated --prefix cli',
    'git push --tags --no-verify',
  ]),
};

module.exports = {hooks};

// applypatch-msg
// commit-msg
// husky.local.sh
// husky.sh
// post-applypatch
// post-checkout
// post-commit
// post-merge
// post-receive
// post-rewrite
// post-update
// pre-applypatch
// pre-auto-gc
// pre-commit
// pre-merge-commit
// pre-push
// pre-rebase
// pre-receive
// prepare-commit-msg
// push-to-checkout
// sendemail-validate
// update
