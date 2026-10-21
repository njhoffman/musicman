const { expect } = require('chai');
const { formatRecords, formatSections, outputFormat, toCsv } = require('./formats.js');

describe('Output Formats', () => {
  const records = [
    { path: '/m/a.mp3', artist: 'The Doors', title: 'Riders, on the Storm', rating: '4.5' },
    { path: '/m/b.mp3', artist: 'Say "Hi"', title: 'Line\nBreak' }
  ];
  const columns = ['path', 'artist', 'title', 'rating'];

  describe('outputFormat', () => {
    it('should default, follow --format, and use oneline for --fzf', () => {
      expect(outputFormat({})).to.equal('default');
      expect(outputFormat({ format: 'csv' })).to.equal('csv');
      expect(outputFormat({ format: 'csv', fzf: true })).to.equal('oneline');
    });

    it('should reject an unknown format', () => {
      expect(() => outputFormat({ format: 'xml' })).to.throw(
        "Unknown format 'xml', use one of: default, oneline, csv, json, html"
      );
    });
  });

  it('should quote csv fields with the delimiter, quotes, or line breaks', () => {
    expect(toCsv(records, columns)).to.equal(
      [
        'path,artist,title,rating',
        '/m/a.mp3,The Doors,"Riders, on the Storm",4.5',
        '/m/b.mp3,"Say ""Hi""","Line\nBreak",'
      ].join('\n')
    );
    expect(toCsv(records.slice(0, 1), ['title'], ';')).to.equal('title\nRiders, on the Storm');
  });

  it('should write json records with only the columns, in order', () => {
    const json = JSON.parse(formatRecords({ format: 'json', records, columns: ['title', 'path'] }));
    expect(json).to.deep.equal([
      { title: 'Riders, on the Storm', path: '/m/a.mp3' },
      { title: 'Line\nBreak', path: '/m/b.mp3' }
    ]);
  });

  it('should write a standalone html page with escaped cells', () => {
    const html = formatRecords({ format: 'html', title: 'Songs <all>', records, columns });
    expect(html).to.match(/^<!doctype html>/);
    expect(html).to.include('<title>Songs &lt;all&gt;</title>');
    expect(html).to.include('<td>Say &quot;Hi&quot;</td>');
    expect(html).to.include('prefers-color-scheme: dark');
  });

  it('should write a oneline line per record', () => {
    const oneline = record => `${record.path}\t${record.artist}`;
    expect(formatRecords({ format: 'oneline', records, oneline })).to.equal(
      '/m/a.mp3\tThe Doors\n/m/b.mp3\tSay "Hi"'
    );
  });

  describe('formatSections', () => {
    const sections = [
      { heading: 'Genres', columns: ['value', 'count'], records: [{ value: 'Rock', count: 3 }] },
      {
        heading: 'Tags',
        columns: ['value', 'id', 'count'],
        records: [{ value: 'artist', id: 'TPE1', count: 5 }]
      }
    ];

    it('should flatten sections into csv rows with a section column', () => {
      expect(formatSections({ format: 'csv', sections })).to.equal(
        'section,value,count,id\nGenres,Rock,3,\nTags,artist,5,TPE1'
      );
    });

    it('should key json by section heading', () => {
      expect(JSON.parse(formatSections({ format: 'json', sections }))).to.deep.equal({
        Genres: [{ value: 'Rock', count: 3 }],
        Tags: [{ value: 'artist', id: 'TPE1', count: 5 }]
      });
    });

    it('should write a table per section in html', () => {
      const html = formatSections({ format: 'html', title: 'Stats', sections });
      expect(html.match(/<table>/g)).to.have.length(2);
      expect(html).to.include('<h2>Genres</h2>');
    });

    it('should pass the section to oneline', () => {
      expect(
        formatSections({
          format: 'oneline',
          sections,
          oneline: record => `${record.section}:${record.value}`
        })
      ).to.equal('Genres:Rock\nTags:artist');
    });
  });
});
