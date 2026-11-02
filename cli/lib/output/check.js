const _ = require('lodash');
const chalk = require('chalk').default;

const { fixableChecks } = require('../check/fix.js');

// findings and changes listed per check unless --all
const shownPerCheck = 10;

// the sync plan's palette (output/sync.js, output/progress.js)
const colors = {
  name: '#8888FF',
  ok: '#55AA77',
  found: '#DDAA55',
  muted: '#888899',
  dim: '#666677',
  left: '#DDAA55',
  rename: '#5599BB',
  remove: '#BB7755',
  move: '#AA88CC',
  edit: '#33CCAA'
};

const paint = (color, text) => chalk.hex(colors[color])(text);

const plural = (count, word, words = `${word}s`) => `${count} ${count === 1 ? word : words}`;

// pads plain text first so the color codes do not count toward the width
const padded = (text, width, color) => paint(color, text.padEnd(width));

// the change kind is the leading verb (rename, remove, move); value rewrites have none
const changeText = text => {
  const [verb] = text.split(' ', 1);
  if (['rename', 'remove', 'move'].includes(verb)) {
    return `${chalk.hex(colors[verb]).bold(verb)}${text.slice(verb.length)}`;
  }
  return paint('edit', text);
};

const more = (count, hint) => paint('dim', `    ... ${count} more (${hint})`);

/**
 * The check report: per check its count and description, then its findings (the first shownPerCheck
 * unless all), then a summary line. Names, counts, and paths are colored when chalk has a terminal.
 */
const renderReport = (results, { all = false } = {}) => {
  const lines = [];
  _.each(results, ({ name, description, unit, findings }) => {
    const label = padded(name, 11, 'name');
    if (findings.length === 0) {
      lines.push(`${label} ${padded('ok', 11, 'ok')} ${paint('muted', description)}`);
      return;
    }
    lines.push(
      `${label} ${chalk.bold(padded(plural(findings.length, unit), 11, 'found'))} ${description}`
    );
    const shown = all ? findings : _.take(findings, shownPerCheck);
    _.each(shown, ({ file, detail }) =>
      lines.push(`    ${file ? `${paint('muted', file)}  ` : ''}${detail}`)
    );
    if (shown.length < findings.length) {
      lines.push(more(findings.length - shown.length, `--all, or --only=${name} --all`));
    }
  });
  const found = _.filter(results, ({ findings }) => findings.length);
  lines.push(
    found.length
      ? paint('found', `${plural(found.length, 'check')} of ${results.length} found problems`)
      : paint('ok', `No problems found in ${plural(results.length, 'check')}`)
  );
  return lines;
};

/**
 * The check --fix plan: per fixable check its change and file counts and what was left for a decision,
 * then the first shownPerCheck changes and cases left (all with all). Change kinds are colored.
 */
const renderPlan = ({ files, skipped }, { all = false } = {}) => {
  const lines = [];
  const changes = _.flatMap(files, ({ file, changes: fileChanges }) =>
    _.map(fileChanges, item => ({ file, ...item }))
  );
  _.each(fixableChecks, name => {
    const of = _.filter(changes, { check: name });
    const left = _.filter(skipped, { check: name });
    if (of.length === 0 && left.length === 0) {
      return;
    }
    const counts = `${plural(of.length, 'change')} in ${plural(_.uniqBy(of, 'file').length, 'file')}`;
    lines.push(
      `${padded(name, 11, 'name')} ${chalk.bold(counts)}${left.length ? paint('left', `, ${left.length} left for you`) : ''}`
    );
    const shown = all ? of : _.take(of, shownPerCheck);
    _.each(shown, ({ file, text }) =>
      lines.push(`    ${paint('muted', file)}  ${changeText(text)}`)
    );
    if (shown.length < of.length) {
      lines.push(more(of.length - shown.length, '--all'));
    }
    _.each(all ? left : _.take(left, shownPerCheck), ({ file, text }) =>
      lines.push(`    ${paint('left', 'left')}  ${paint('muted', file)}  ${text}`)
    );
  });
  return lines;
};

/**
 * One duplicates group as plan lines: the copy kept, the copies removed (with why), live copies whose
 * match is cleared, and the copies to pick from when no rule decides.
 */
const duplicateGroupLines = group => {
  const lines = [];
  if (group.keep) {
    lines.push(`    ${paint('ok', 'keep  ')}  ${paint('muted', group.keep)}`);
  }
  _.each(group.remove, file =>
    lines.push(
      `    ${chalk.hex(colors.remove).bold('remove')}  ${paint('muted', file)}  ${paint('dim', group.reasons[file] || '')}`
    )
  );
  _.each(group.clear, file =>
    lines.push(
      `    ${chalk.hex(colors.rename).bold('clear ')}  ${paint('muted', file)}  ${paint('dim', group.reasons[file] || '')}`
    )
  );
  _.each(group.candidates, file =>
    lines.push(`    ${paint('left', 'pick  ')}  ${paint('muted', file)}`)
  );
  return lines;
};

/**
 * What check --fix does about duplicates: counts, then each group (the first shownPerCheck unless all).
 */
const renderDuplicatePlan = (groups, { all = false } = {}) => {
  if (groups.length === 0) {
    return [];
  }
  const removed = _.sumBy(groups, ({ remove }) => remove.length);
  const cleared = _.sumBy(groups, ({ clear }) => clear.length);
  const picks = _.filter(groups, ({ candidates }) => candidates.length > 0).length;
  const counts = _.compact([
    removed && `remove ${plural(removed, 'copy', 'copies')}`,
    cleared && `clear ${plural(cleared, 'live match', 'live matches')}`,
    picks && paint('left', `${plural(picks, 'group')} to pick`)
  ]).join(', ');
  const lines = [
    `${padded('duplicates', 11, 'name')} ${chalk.bold(plural(groups.length, 'group'))}: ${counts}`
  ];
  const shown = all ? groups : _.take(groups, shownPerCheck);
  _.each(shown, group => lines.push(...duplicateGroupLines(group)));
  if (shown.length < groups.length) {
    lines.push(more(groups.length - shown.length, '--all'));
  }
  return lines;
};

module.exports = {
  duplicateGroupLines,
  renderDuplicatePlan,
  renderPlan,
  renderReport,
  shownPerCheck
};
