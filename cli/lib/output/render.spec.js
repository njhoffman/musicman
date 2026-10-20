const { expect } = require('chai');
const { renderColumns, renderKeyValues } = require('./render.js');

describe('Column Rendering', () => {
  describe('renderColumns', () => {
    const columns = [{}, {}, {}];
    const head = ['a', 'b', 'c'];
    const rows = [['xxxx', 'yyyy', 'zzzz']];

    it('should render borderless columns separated by the splitter', () => {
      const lines = renderColumns({ head, rows, columns, splitter: ' | ' }).split('\n');
      expect(lines).to.deep.equal(['a    | b    | c   ', 'xxxx | yyyy | zzzz']);
    });

    it('should apply minWidth and maxWidth', () => {
      const lines = renderColumns({
        rows,
        columns: [{ minWidth: 6 }, { maxWidth: 3 }, {}]
      }).split('\n');
      expect(lines).to.deep.equal(['xxxx   yy… zzzz']);
    });

    it('should align cells', () => {
      const lines = renderColumns({
        rows: [
          ['a', 'b'],
          ['xxxx', 'yyyy']
        ],
        columns: [{ align: 'right' }, { align: 'center' }]
      }).split('\n');
      expect(lines[0]).to.equal('   a  b  ');
    });

    it('should fit columns within maxLineWidth', () => {
      const lines = renderColumns({ head, rows, columns, maxLineWidth: 7 }).split('\n');
      expect(lines).to.deep.equal(['a    b ', 'xxxx y…']);
    });

    it('should return an empty string when no columns fit', () => {
      expect(renderColumns({ rows, columns, maxLineWidth: 0 })).to.equal('');
    });
  });

  describe('renderKeyValues', () => {
    it('should render aligned key/value pairs', () => {
      const lines = renderKeyValues([
        ['artist', 'Artist'],
        ['title', '']
      ]).split('\n');
      expect(lines).to.deep.equal(['artist Artist', 'title        ']);
    });

    it('should truncate values to maxLineWidth', () => {
      const [line] = renderKeyValues([['title', 'A Long Title']], 12).split('\n');
      expect(line).to.equal('title A Lon…');
    });
  });
});
