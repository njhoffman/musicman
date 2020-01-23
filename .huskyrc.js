const tasks = arr => arr.join(' && ');

const hooks = {
  'commit-msg': 'commitlint -E HUSKY_GIT_PARAMS',
  // 'pre-commit': tasks(['npm run lint', 'npm run test']),
  // 'pre-push': './.bin/prePushVersion.sh',
  // 'post-push': tasks(['npm run test', 'npm outdated']),
};

module.exports = {hooks};
