const _ = require('lodash');
const Table = require('cli-table3');
const stringWidth = require('string-width').default;

const borderless = {
  top: '',
  'top-mid': '',
  'top-left': '',
  'top-right': '',
  bottom: '',
  'bottom-mid': '',
  'bottom-left': '',
  'bottom-right': '',
  left: '',
  'left-mid': '',
  mid: '',
  'mid-mid': '',
  right: '',
  'right-mid': ''
};

// shrink widths to fit maxLineWidth, truncating the column crossing it and dropping any after
const fitWidths = (widths, maxLineWidth, splitterWidth) => {
  const fitted = [];
  let lineWidth = 0;
  _.each(widths, width => {
    const splitter = fitted.length > 0 ? splitterWidth : 0;
    const available = maxLineWidth - lineWidth - splitter;
    if (available <= 0) {
      return false;
    }
    const fittedWidth = Math.min(width, available);
    fitted.push(fittedWidth);
    lineWidth += splitter + fittedWidth;
    return true;
  });
  return fitted;
};

const truncate = (str, width) => {
  if (stringWidth(str) <= width) {
    return str;
  }
  let truncated = '';
  _.each([...str], char => {
    if (stringWidth(`${truncated}${char}`) + 1 > width) {
      return false;
    }
    truncated += char;
    return true;
  });
  return `${truncated}…`;
};

// render borderless columns from plain text cells, widths and truncation are computed before
// format (header and cell) functions apply colors so ANSI codes never affect measurement,
// cell format functions also receive the row index
const renderColumns = ({ rows, columns, head, splitter = ' ', maxLineWidth = Infinity }) => {
  const contentWidths = _.map(columns, ({ minWidth = 0, maxWidth = Infinity }, i) => {
    const cells = (head ? [head[i]] : []).concat(_.map(rows, row => row[i]));
    const width = Math.max(minWidth, 1, ..._.map(cells, cell => stringWidth(cell)));
    return Math.min(width, maxWidth);
  });

  const colWidths = fitWidths(contentWidths, maxLineWidth, stringWidth(splitter));
  const colCount = colWidths.length;
  if (colCount === 0) {
    return '';
  }

  const fitColumns = _.map(columns.slice(0, colCount), (column, i) => ({
    ...column,
    width: colWidths[i]
  }));
  const fitCells = (cells, formatKey, rowIndex) =>
    _.map(fitColumns, (column, i) => {
      const { width, [formatKey]: format = _.identity } = column;
      return format(truncate(cells[i], width), rowIndex);
    });

  const table = new Table({
    chars: { ...borderless, middle: splitter },
    style: { head: [], border: [], 'padding-left': 0, 'padding-right': 0 },
    colWidths,
    colAligns: _.map(fitColumns, ({ align = 'left' }) => align),
    ...(head ? { head: fitCells(head, 'formatHeader') } : {})
  });
  _.each(rows, (row, rowIndex) => table.push(fitCells(row, 'format', rowIndex)));

  return table.toString();
};

const renderKeyValues = (pairs, maxLineWidth, { formatKey, formatValue } = {}) =>
  renderColumns({
    rows: pairs,
    columns: [{ format: formatKey }, { format: formatValue }],
    maxLineWidth
  });

module.exports = { renderColumns, renderKeyValues };
