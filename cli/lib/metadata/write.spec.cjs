const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('Metadata Write', () => {
  let nodeId3Stub;
  let writeModule;

  beforeEach(() => {
    nodeId3Stub = { update: sinon.stub().returns(true) };
    writeModule = proxyquire('./write.cjs', {
      'node-id3': nodeId3Stub
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
      tags: [
        { name: 'artist', id: 'TPE1' },
        { name: 'title', id: 'TIT2' },
        { name: 'custom', id: 'TXXX.Custom' }
      ],
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
  });
});
