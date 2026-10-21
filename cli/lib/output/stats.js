const _ = require('lodash');
const chalk = require('chalk').default;

const { availableWidth, consoleLog } = require('../utils/logger.js');
const { renderColumns } = require('./render.js');

const maxLen = (arr, maxLenStatic) => {
  return maxLenStatic || arr.reduce((a, b) => (a.length > b.length ? a : b)).length;
};

const outputStat = (title, stat, maxLenStatic = 12) => {
  let output = `\n${chalk.hex('#8888FF')(title)}\n`;
  Object.keys(stat)
    // .sort((a, b) =>
    //   sortAlpha ? a.trim().charCodeAt(0) - b.trim().charCodeAt(0) : stat[b] - stat[a]
    // )
    .sort()
    .forEach(key => {
      output += `${key.padStart(maxLen(Object.keys(stat), maxLenStatic) + 2)} ${stat[key]}\n`;
    });
  return output;
};

// rounded down so 100% means every file, counts under 1% are shown as <1%
const formatPercent = (count, total) => {
  const percent = total > 0 ? Math.floor((count / total) * 100) : 0;
  return percent === 0 && count > 0 ? '<1%' : `${percent}%`;
};

const outputTags = (tags, total) => {
  // frame id last so it is truncated first on narrow terminals
  const rows = _.map(tags, ({ name, id, count }) => [
    name,
    `${count}`,
    formatPercent(count, total),
    id
  ]);
  const columns = [{}, { align: 'right' }, { align: 'right' }, {}];
  const maxLineWidth = availableWidth() - 2;
  const table =
    rows.length > 0 ? renderColumns({ rows, columns, splitter: '  ', maxLineWidth }) : '';
  const lines = table ? _.map(table.split('\n'), line => `  ${line}`) : [];
  return `\n${chalk.hex('#8888FF')(`Tags (${total} files)`)}\n${lines.join('\n')}\n`;
};

const outputStats = ({ stats, config }) => {
  let output = '';
  const { genre, grouping, ...multiFields } = stats.fields;
  output += outputStat('Genres', genre, 30);
  output += outputStat('Groupings', grouping, 30);
  _.each(multiFields, (values, field) => {
    output += outputStat(_.upperFirst(field), values);
  });
  output += outputStat('Ratings', stats.ratings);
  output += outputStat('Overall', {
    tracks_rated: stats.rated,
    tracks_unrated: stats.unrated,
    total_duration: `${Math.round(stats.duration / 60)} min`,
    total_size: `${Math.round(stats.size / 1024)} MB`
  });
  output += outputTags(stats.tags, stats.total);
  return consoleLog(output);
};

// stats as record sections for --format: value counts per field, ratings, overall totals, and tags
const statsSections = stats => {
  const { genre, grouping, ...multiFields } = stats.fields;
  const counts = (heading, values) => ({
    heading,
    columns: ['value', 'count'],
    records: _.map(_.sortBy(_.keys(values)), value => ({ value, count: values[value] }))
  });
  return [
    counts('Genres', genre),
    counts('Groupings', grouping),
    ..._.map(multiFields, (values, field) => counts(_.upperFirst(field), values)),
    counts('Ratings', stats.ratings),
    {
      heading: 'Overall',
      columns: ['value', 'count'],
      records: [
        { value: 'tracks_rated', count: stats.rated },
        { value: 'tracks_unrated', count: stats.unrated },
        { value: 'total_duration_min', count: Math.round(stats.duration / 60) },
        { value: 'total_size_mb', count: Math.round(stats.size / 1024) }
      ]
    },
    {
      heading: 'Tags',
      columns: ['value', 'id', 'count', 'percent'],
      records: _.map(stats.tags, ({ name, id, count }) => ({
        value: name,
        id,
        count,
        percent: formatPercent(count, stats.total)
      }))
    }
  ];
};

// section:value<TAB>section value count, for fzf
const statsOneline = record =>
  `${record.section}:${record.value}\t${chalk.hex('#8888FF')(record.section.padEnd(10))} ${
    record.value
  } ${chalk.hex('#888899')(record.count)}`;

module.exports = { outputStats, statsOneline, statsSections };
