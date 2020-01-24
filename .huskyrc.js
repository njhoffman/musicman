const tasks = arr => arr.join(' && ');

const hooks = {
  // 'pre-commit': tasks(['npm run lint', 'npm run test']),
  // 'pre-push': './.bin/prePushVersion.sh',
  'commit-msg': 'commitlint -E HUSKY_GIT_PARAMS',
  'pre-push': tasks(['npm run test']),
  'post-push': tasks(['npm run todos', 'npm outdated --prefix cli']),
};

module.exports = {hooks};
