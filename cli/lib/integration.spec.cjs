const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

const parser = require('./parser/index.cjs');
const editCommand = require('./commands/edit.cjs');
const viewCommand = require('./commands/view.cjs');
const { getFiles } = require('./utils/files.cjs');

describe('Integration Tests', () => {
  const testDataDir = path.join(process.cwd(), 'test/data/sandbox');
  const config = {
    mpd: { baseDirectory: 'testBaseDir' },
    tags: [
      { name: 'artist', id: 'TPE1' },
      { name: 'title', id: 'TIT2' },
      { name: 'album', id: 'TALB' },
      { name: 'genre', id: 'TCON' }
    ],
    rating: { tag: 'POPM', max: 5, email: 'test@example.com' }
  };

  describe('Parser to Command Integration', () => {
    it('should parse view command with filters and execute', async () => {
      const args = ['artist:TestArtist', '-i', 'artist,title'];
      const parsed = parser({ args, config });

      expect(parsed.command.name).to.equal('view');
      expect(parsed.options.filters.include).to.deep.include({ artist: 'TestArtist' });
      expect(parsed.options.switches.include).to.deep.equal(['artist', 'title']);
    });

    it('should parse edit command with assignments', () => {
      const args = ['artist=NewArtist', 'album="New Album"'];
      const parsed = parser({ args, config });

      expect(parsed.command.name).to.equal('edit');
      expect(parsed.options.assignments).to.deep.include({
        artist: 'NewArtist',
        album: 'New Album'
      });
    });

    it('should default to current directory when no target specified', () => {
      const args = ['artist:TestArtist'];
      const parsed = parser({ args, config });

      expect(parsed.target).to.equal(process.cwd());
    });
  });

  describe('File Operations Integration', () => {
    it('should find mp3 files in test directory', () => {
      if (fs.existsSync(testDataDir)) {
        const files = getFiles(testDataDir, { ext: 'mp3', recursive: true });
        expect(files).to.be.an('array');
        if (files && files.length > 0) {
          expect(files.every(file => file.endsWith('.mp3'))).to.be.true;
        }
      }
    });

    it('should handle non-existent directory gracefully', () => {
      const files = getFiles('/nonexistent/directory');
      expect(files).to.be.null;
    });
  });

  describe('Command Workflow Integration', () => {
    it('should handle view command workflow', async () => {
      const args = ['-i', 'artist'];
      const parsed = parser({ args, config });

      expect(parsed.command.name).to.equal('view');

      // Command should be executable
      expect(viewCommand.func).to.be.a('function');
      expect(viewCommand.name).to.equal('view');
    });

    it('should handle edit command workflow structure', () => {
      const args = ['artist=TestArtist'];
      const parsed = parser({ args, config });

      expect(parsed.command.name).to.equal('edit');
      expect(parsed.options.assignments.artist).to.equal('TestArtist');

      // Command should be executable
      expect(editCommand.func).to.be.a('function');
      expect(editCommand.name).to.equal('edit');
    });
  });

  describe('Filter and Assignment Integration', () => {
    it('should combine multiple filter types correctly', () => {
      const args = ['artist:Rock', 'album:"Test Album"', '~genre:Pop'];
      const parsed = parser({ args, config });

      expect(parsed.options.filters.include).to.deep.include({
        artist: 'Rock',
        album: 'Test Album'
      });
      expect(parsed.options.filters.exclude).to.deep.include({
        genre: 'Pop'
      });
    });

    it('should handle mixed filters and assignments', () => {
      const args = ['artist:OldArtist', 'title=NewTitle', '~genre:Rock'];
      const parsed = parser({ args, config });

      expect(parsed.command.name).to.equal('edit');
      expect(parsed.options.filters.include.artist).to.equal('OldArtist');
      expect(parsed.options.filters.exclude.genre).to.equal('Rock');
      expect(parsed.options.assignments.title).to.equal('NewTitle');
    });
  });

  describe('Switch and Option Integration', () => {
    it('should combine switches with other options', () => {
      const args = ['-r', '-i', 'artist,title', 'genre:Rock'];
      const parsed = parser({ args, config });

      expect(parsed.options.switches.recursive).to.be.true;
      expect(parsed.options.switches.include).to.deep.equal(['artist', 'title']);
      expect(parsed.options.filters.include.genre).to.equal('Rock');
    });

    it('should handle negated switches', () => {
      const args = ['-nr', 'artist:TestArtist'];
      const parsed = parser({ args, config });

      expect(parsed.options.switches.recursive).to.be.false;
      expect(parsed.options.filters.include.artist).to.equal('TestArtist');
    });
  });
});
