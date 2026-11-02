const _ = require('lodash');
const chalk = require('chalk').default;

const { fixableChecks } = require('../check/fix.js');

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

/**
 * The check report: per check its count and description, then every finding, then a summary line. Names, counts, and paths are colored when chalk has a terminal.
 */
const renderReport = results => {
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
    _.each(findings, ({ file, detail }) =>
      lines.push(`    ${file ? `${paint('muted', file)}  ` : ''}${detail}`)
    );
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
 * then every change and case left. Change kinds are colored.
 */
const renderPlan = ({ files, skipped }) => {
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
    _.each(of, ({ file, text }) => lines.push(`    ${paint('muted', file)}  ${changeText(text)}`));
    _.each(left, ({ file, text }) =>
      lines.push(`    ${paint('left', 'left')}  ${paint('muted', file)}  ${text}`)
    );
  });
  return lines;
};

/**
 * One duplicates group as plan lines: the copy kept, the copies trashed and dropped from the library
 * (file kept), with why, other recordings whose match is cleared, and the copies to pick from.
 */
const duplicateGroupLines = group => {
  const lines = [];
  if (group.keep) {
    lines.push(`    ${paint('ok', 'keep  ')}  ${paint('muted', group.keep)}`);
  }
  _.each(group.trash, file =>
    lines.push(
      `    ${chalk.hex(colors.remove).bold('trash ')}  ${paint('muted', file)}  ${paint('dim', group.reasons[file] || '')}`
    )
  );
  _.each(group.exclude, file =>
    lines.push(
      `    ${chalk.hex(colors.move).bold('drop  ')}  ${paint('muted', file)}  ${paint('dim', `${group.reasons[file] || ''} (file kept)`)}`
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
 * What check --fix does about duplicates: counts, then every group.
 */
const renderDuplicatePlan = groups => {
  if (groups.length === 0) {
    return [];
  }
  const trashed = _.sumBy(groups, ({ trash }) => trash.length);
  const dropped = _.sumBy(groups, ({ exclude }) => exclude.length);
  const cleared = _.sumBy(groups, ({ clear }) => clear.length);
  const picks = _.filter(groups, ({ candidates }) => candidates.length > 0).length;
  const counts = _.compact([
    trashed && `trash ${plural(trashed, 'file')}`,
    dropped && `drop ${plural(dropped, 'copy', 'copies')} from the library (files kept)`,
    cleared && `re-match ${plural(cleared, 'other recording')}`,
    picks && paint('left', `${plural(picks, 'group')} to pick`)
  ]).join(', ');
  const lines = [
    `${padded('duplicates', 11, 'name')} ${chalk.bold(plural(groups.length, 'group'))}: ${counts}`
  ];
  _.each(groups, group => lines.push(...duplicateGroupLines(group)));
  return lines;
};

module.exports = {
  duplicateGroupLines,
  renderDuplicatePlan,
  renderPlan,
  renderReport
};
