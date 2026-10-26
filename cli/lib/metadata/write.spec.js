const _ = require('lodash');
const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('Metadata Write', () => {
  let nodeId3Stub;
  let writeModule;

  beforeEach(() => {
    nodeId3Stub = { update: sinon.stub().returns(true), read: sinon.stub().returns({ raw: {} }) };
    writeModule = proxyquire('./write.js', {
      'node-id3': nodeId3Stub,
      '../check/frames.js': {
        readTagBuffer: () => null,
        walkFrames: () => null,
        appendFrames: () => true
      }
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('mergeAssignments', () => {
    it('should merge simple assignments', () => {
      const meta = { artist: 'Old Artist' };
      const assignments = { title: 'New Title', artist: 'New Artist' };
      const result = writeModule.mergeAssignments(meta, assignments);
      expect(result).to.deep.equal({ artist: 'New Artist', title: 'New Title' });
    });

    it('should handle array assignments', () => {
      const meta = {};
      const assignments = { genre: ['Rock', 'Alternative'] };
      const result = writeModule.mergeAssignments(meta, assignments);
      expect(result.genre).to.deep.equal(['Rock', 'Alternative']);
    });

    it('should handle aggregate array assignments with addition', () => {
      const meta = { genre: 'Rock,Pop' };
      const assignments = { genre: ['+Alternative', '+Jazz'] };
      const result = writeModule.mergeAssignments(meta, assignments);
      expect(result.genre).to.include('Alternative');
      expect(result.genre).to.include('Jazz');
      expect(result.genre).to.include('Rock');
      expect(result.genre).to.include('Pop');
    });

    it('should handle aggregate array assignments with removal', () => {
      const meta = { genre: 'Rock,Pop,Jazz' };
      const assignments = { genre: ['-Pop', '+Alternative'] };
      const result = writeModule.mergeAssignments(meta, assignments);
      expect(result.genre).to.include('Rock');
      expect(result.genre).to.include('Jazz');
      expect(result.genre).to.include('Alternative');
      expect(result.genre).to.not.include('Pop');
    });

    it('should deduplicate array values case-insensitively', () => {
      const meta = {};
      const assignments = { genre: ['Rock', 'rock', 'ROCK'] };
      const result = writeModule.mergeAssignments(meta, assignments);
      expect(result.genre).to.have.length(1);
      expect(result.genre[0]).to.equal('Rock');
    });
  });

  describe('writeFiles', () => {
    const config = {
      library: {
        tags: [
          { name: 'artist', id: 'TPE1' },
          { name: 'title', id: 'TIT2' },
          { name: 'custom', id: 'TXXX.Custom' }
        ]
      },
      rating: { tag: 'POPM', max: 5, email: 'test@example.com' }
    };

    it('should transform and write metadata to files', () => {
      const files = [
        ['test1.mp3', { artist: 'Artist 1', title: 'Title 1' }],
        ['test2.mp3', { artist: 'Artist 2', custom: 'Custom Value' }]
      ];

      const writer = writeModule.writeFiles(config);
      const results = writer(files);

      expect(nodeId3Stub.update.calledTwice).to.be.true;
      expect(results).to.have.length(2);
    });

    it('should handle rating conversion', () => {
      const files = [['test.mp3', { artist: 'Artist', rating: '4.0' }]];
      const writer = writeModule.writeFiles(config);
      writer(files);

      const callArgs = nodeId3Stub.update.firstCall.args;
      expect(callArgs[0].POPM).to.deep.equal({
        email: 'test@example.com',
        rating: 204
      });
    });

    it('should prepare TXXX custom fields', () => {
      const files = [['test.mp3', { custom: 'Custom Value' }]];
      const writer = writeModule.writeFiles(config);
      writer(files);

      const callArgs = nodeId3Stub.update.firstCall.args;
      expect(callArgs[0].TXXX).to.deep.equal([{ description: 'Custom', value: 'Custom Value' }]);
    });

    it('should write multi value fields comma separated', () => {
      const files = [['test.mp3', { artist: ['A', 'B'], custom: ['Spicy', 'Nick', 'Hot'] }]];
      writeModule.writeFiles(config)(files);

      const callArgs = nodeId3Stub.update.firstCall.args;
      expect(callArgs[0].TPE1).to.equal('A,B');
      expect(callArgs[0].TXXX).to.deep.equal([{ description: 'Custom', value: 'Spicy,Nick,Hot' }]);
    });

    it('should only write fields defined in library.tags', () => {
      const files = [['test.mp3', { artist: 'Artist', album_artist: 'Album Artist' }]];
      const writer = writeModule.writeFiles({
        ...config,
        tags: [{ name: 'album_artist', id: 'TPE2' }]
      });
      writer(files);

      const callArgs = nodeId3Stub.update.firstCall.args;
      expect(callArgs[0]).to.include({ TPE1: 'Artist' });
      expect(callArgs[0]).to.not.have.property('TPE2');
    });
  });
  describe('updateTags', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const NodeId3 = require('node-id3');
    const { updateTags } = require('./write.js');
    let directory;
    let file;

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-write-'));
      file = path.join(directory, 'song.mp3');
      fs.copyFileSync(path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3'), file);
    });

    afterEach(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    it('should update a file with a UFID frame without an identifier and keep the frame', () => {
      const emptyUfid = [
        { ownerIdentifier: 'http://musicbrainz.org', identifier: Buffer.alloc(0) }
      ];
      NodeId3.update({ UFID: emptyUfid }, file);
      // node-id3 itself cannot write such a file back
      expect(() => NodeId3.update({ TIT1: 'x' }, file)).to.throw();
      const before = NodeId3.read(file).raw;

      expect(updateTags({ TIT1: 'IndieRock.Artists' }, file)).to.be.true;
      expect(updateTags({ userDefinedText: [{ description: 'sp_track_id', value: 'id' }] }, file))
        .to.be.true;
      const after = NodeId3.read(file).raw;
      expect(after.TIT1).to.equal('IndieRock.Artists');
      expect(after.UFID).to.deep.equal([
        { ownerIdentifier: 'http://musicbrainz.org', identifier: undefined }
      ]);
      expect(Object.keys(after)).to.include.members(Object.keys(before));
      expect(after.POPM).to.deep.equal(before.POPM);
    });

    // ID3v2.3 text frame: id, size, flags, then ISO-8859-1 encoding and the text
    const textFrame = (id, text) => {
      const body = Buffer.concat([Buffer.from([0]), Buffer.from(text, 'latin1')]);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(body.length);
      return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.alloc(2), body]);
    };

    it('should keep frames node-id3 does not understand when it rewrites the tag', () => {
      const {
        appendFrames,
        listFrameIds,
        readTagBuffer,
        walkFrames
      } = require('../check/frames.js');
      const tcmp = textFrame('TCMP', '1');
      const tsoc = textFrame('TSOC', 'Waters, Roger');
      expect(appendFrames(file, [tcmp, tsoc])).to.be.true;
      const audio = fs.readFileSync(file).subarray(readTagBuffer(file).length);
      // node-id3 alone drops them
      const copy = path.join(directory, 'copy.mp3');
      fs.copyFileSync(file, copy);
      NodeId3.update({ TIT1: 'x' }, copy);
      expect(listFrameIds(readTagBuffer(copy))).to.not.include('TCMP');

      expect(updateTags({ TIT1: 'Grouping' }, file)).to.be.true;
      expect(updateTags({ userDefinedText: [{ description: 'sp_track_id', value: 'id' }] }, file))
        .to.be.true;
      const tag = readTagBuffer(file);
      const frames = walkFrames(tag);
      const bytes = id =>
        frames.filter(frame => frame.id === id).map(({ start, end }) => tag.subarray(start, end));
      expect(bytes('TCMP')).to.deep.equal([tcmp]);
      expect(bytes('TSOC')).to.deep.equal([tsoc]);
      expect(NodeId3.read(file).raw.TIT1).to.equal('Grouping');
      expect(fs.readFileSync(file).subarray(tag.length).equals(audio)).to.be.true;
    });

    it('should update other files with node-id3 directly', () => {
      expect(updateTags({ TIT1: 'Grouping' }, file)).to.be.true;
      expect(NodeId3.read(file).raw.TIT1).to.equal('Grouping');
    });

    it('should keep existing values when adding to a multi value field (sync --pull, edit +value)', () => {
      const { mergeAssignments, writeFiles } = require('./write.js');
      const config = {
        library: { tags: [{ name: 'picks', id: 'TXXX.Picks', multi: true }] },
        rating: { tag: 'POPM', max: 5 }
      };
      const picks = () =>
        _.get(
          _.find([].concat(NodeId3.read(file).raw.TXXX || []), { description: 'Picks' }),
          'value'
        );
      writeFiles(config)([[file, { picks: 'Nick,Hot' }]]);
      expect(picks()).to.equal('Nick,Hot');
      writeFiles(config)([
        [file, mergeAssignments({ picks: picks() }, { picks: ['+Spicy', '-Nick'] })]
      ]);
      expect(picks()).to.equal('Spicy,Hot');
    });
  });
});
