const _ = require('lodash');

/**
 * Review items (reviewItems) at least threshold percent similar, least similar first so the closest
 * calls are listed next to the question. None without a threshold (sync.autoAcceptPercent empty).
 */
const autoAcceptItems = (items, threshold) =>
  _.isNumber(threshold)
    ? _.orderBy(
        _.filter(items, ({ similarity }) => similarity.percent >= threshold),
        ['similarity.percent', 'path'],
        ['asc', 'asc']
      )
    : [];

/**
 * Asks which auto-accept items to accept: all of them, or all but the ones picked to leave out
 * (pickOut(items) returns their files). Saying no to both questions, picking every item, or declining
 * the last question accepts none. Returns { accept, leftOut } items; left out ones stay in review.
 */
const confirmAutoAccept = async ({ items, threshold, confirm, pickOut }) => {
  const none = { accept: [], leftOut: items };
  if (await confirm(`Accept ${items.length} matches at ${threshold}% or more?`)) {
    return { accept: items, leftOut: [] };
  }
  if (!(await confirm('Pick ones to leave out?'))) {
    return none;
  }
  const out = new Set(await pickOut(items));
  const [leftOut, accept] = _.partition(items, ({ file }) => out.has(file));
  // an fzf cancelled with escape picks nothing, so the remaining ones are confirmed once more
  if (
    accept.length === 0 ||
    !(await confirm(`Accept ${accept.length} matches, leaving ${leftOut.length} in review?`))
  ) {
    return none;
  }
  return { accept, leftOut };
};

module.exports = { autoAcceptItems, confirmAutoAccept };
