const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');

const {
  buildNotification,
  getSongInfo,
  sendNotification,
  watchSongs
} = require('./notification.js');

const daemon = {
  bin: '/usr/bin/notify-send',
  icon: false,
  duration: 5000,
  urgency: 'LOW',
  fields: ['artist', 'album']
};

const song = { rating: '4.5', title: 'Fade Into You', artist: 'Mazzy Star', album: 'So Tonight' };

// an MPD client answering currentsong and status, emitting idle events like the real one
const fakeMpd = ({ file, state = 'play' }) => {
  const client = new EventEmitter();
  client.sendCommandAsync = sinon.stub();
  client.sendCommandAsync.withArgs('currentsong').resolves(file ? { file } : {});
  client.sendCommandAsync.withArgs('status').resolves({ state });
  return client;
};

describe('Notify Daemon', () => {
  describe('buildNotification', () => {
    it('should put the rating and title in the summary and the fields in the body', () => {
      expect(buildNotification(song, daemon)).to.deep.equal({
        bin: '/usr/bin/notify-send',
        args: [
          '--urgency=LOW',
          '--expire-time=5000',
          '4.5   Fade Into You',
          'Mazzy Star\nSo Tonight'
        ]
      });
    });

    it('should add the icon when one is configured', () => {
      const { args } = buildNotification(song, { ...daemon, icon: '/icons/music.png' });
      expect(args.slice(0, 3)).to.deep.equal([
        '--urgency=LOW',
        '--icon=/icons/music.png',
        '--expire-time=5000'
      ]);
    });

    it('should mark unrated songs and leave out empty fields', () => {
      const { args } = buildNotification({ title: 'Untitled', artist: 'Someone' }, daemon);
      expect(args.slice(-2)).to.deep.equal(['*UNRATED*   Untitled', 'Someone']);
    });

    it('should pass shell characters through as plain arguments', () => {
      const { args } = buildNotification({ ...song, title: '$(rm -rf ~); "quoted"' }, daemon);
      expect(args).to.include('4.5   $(rm -rf ~); "quoted"');
    });
  });

  describe('sendNotification', () => {
    it('should run the binary with the notification arguments', () => {
      const execFile = sinon.stub();
      sendNotification(song, daemon, { execFile });
      expect(execFile).to.have.been.calledOnce;
      expect(execFile.firstCall.args[0]).to.equal('/usr/bin/notify-send');
      expect(execFile.firstCall.args[1]).to.deep.equal(buildNotification(song, daemon).args);
    });

    it('should not throw when the binary fails', () => {
      const execFile = sinon
        .stub()
        .callsFake((bin, args, callback) => callback(new Error('ENOENT')));
      expect(() => sendNotification(song, daemon, { execFile })).not.to.throw();
    });
  });

  describe('getSongInfo', () => {
    const config = {
      mpd: { baseDirectory: '/music' },
      library: { tags: [{ id: 'TIT2', name: 'title' }] }
    };

    it('should read the playing file from the MPD music directory', async () => {
      const readMetadata = sinon.stub().resolves([['/music/a/b.mp3', { TIT2: 'B' }]]);
      const info = await getSongInfo(fakeMpd({ file: 'a/b.mp3' }), config, { readMetadata });
      expect(readMetadata).to.have.been.calledOnceWith('/music/a/b.mp3');
      expect(info).to.include({ title: 'B' });
    });

    it('should return false when MPD is not playing', async () => {
      const readMetadata = sinon.stub();
      const info = await getSongInfo(fakeMpd({ file: 'a/b.mp3', state: 'pause' }), config, {
        readMetadata
      });
      expect(info).to.equal(false);
      expect(readMetadata).not.to.have.been.called;
    });
  });

  describe('watchSongs', () => {
    const config = {
      mpd: { baseDirectory: '/music' },
      library: { tags: [{ id: 'TIT2', name: 'title' }] },
      daemon
    };

    it('should notify for the current song and again on each player change', async () => {
      const mpd = fakeMpd({ file: 'a/b.mp3' });
      const readMetadata = sinon.stub().resolves([['/music/a/b.mp3', { TIT2: 'B' }]]);
      const execFile = sinon.stub();
      await watchSongs(mpd, config, { readMetadata, execFile });
      expect(execFile).to.have.been.calledOnce;

      mpd.emit('system', 'mixer');
      mpd.emit('system', 'player');
      await new Promise(resolve => setImmediate(resolve));
      expect(execFile).to.have.been.calledTwice;
    });
  });
});
