const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('MPD Client', () => {
  let mockMpdClient;
  let mpdModule;

  beforeEach(() => {
    mockMpdClient = {
      on: sinon.stub(),
      sendCommandAsync: sinon.stub()
    };

    mpdModule = proxyquire('./mpd.js', {
      'musicman-common/mpd/MpdClient.js': {
        MpdClient: {
          connect: sinon.stub().returns(mockMpdClient)
        }
      }
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('connectMpd', () => {
    it('should resolve when MPD connection is ready', async () => {
      const connectPromise = mpdModule.connectMpd({ port: 6600, host: 'localhost' });

      // Simulate ready event
      const readyCallback = mockMpdClient.on.withArgs('ready').firstCall.args[1];
      readyCallback();

      const client = await connectPromise;
      expect(client).to.equal(mockMpdClient);
    });

    it('should reject when MPD connection fails', async () => {
      const connectPromise = mpdModule.connectMpd({ port: 6600, host: 'localhost' });

      // Simulate error event
      const errorCallback = mockMpdClient.on.withArgs('error').firstCall.args[1];
      const testError = new Error('Connection failed');
      errorCallback(testError);

      try {
        await connectPromise;
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.equal('Connection failed');
      }
    });
  });

  describe('connectMpd timeout', () => {
    it('should reject and close the socket when MPD does not respond', async () => {
      const clock = sinon.useFakeTimers();
      mockMpdClient.socket = { destroy: sinon.stub() };
      const connectPromise = mpdModule.connectMpd({ port: 6600, host: 'unreachable' }, { timeout: 100 });
      clock.tick(100);

      try {
        await connectPromise;
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.equal('timed out connecting to unreachable:6600');
        expect(mockMpdClient.socket.destroy).to.have.been.calledOnce;
      }
    });
  });

  describe('getAvailableSong', () => {
    it('should return the current song when MPD is available', async () => {
      const mockSong = { file: 'test.mp3' };
      mockMpdClient.sendCommandAsync.withArgs('currentsong').resolves(mockSong);
      mockMpdClient.sendCommandAsync.withArgs('status').resolves({ state: 'play' });

      const songPromise = mpdModule.getAvailableSong({ port: 6600, host: 'localhost' });
      mockMpdClient.on.withArgs('ready').firstCall.args[1]();
      expect(await songPromise).to.equal(mockSong);
    });

    it('should return false when MPD connection fails', async () => {
      const songPromise = mpdModule.getAvailableSong({ port: 6600, host: 'localhost' });
      mockMpdClient.on.withArgs('error').firstCall.args[1](new Error('connect ECONNREFUSED'));
      expect(await songPromise).to.be.false;
    });
  });

  describe('getCurrentSong', () => {
    it('should return current song when playing', async () => {
      const mockSong = { file: 'test.mp3', artist: 'Test Artist' };
      const mockStatus = { state: 'play' };

      mockMpdClient.sendCommandAsync
        .withArgs('currentsong')
        .resolves(mockSong)
        .withArgs('status')
        .resolves(mockStatus);

      const result = await mpdModule.getCurrentSong(mockMpdClient);
      expect(result).to.deep.equal(mockSong);
    });

    it('should return false when not playing', async () => {
      const mockSong = { file: 'test.mp3' };
      const mockStatus = { state: 'pause' };

      mockMpdClient.sendCommandAsync
        .withArgs('currentsong')
        .resolves(mockSong)
        .withArgs('status')
        .resolves(mockStatus);

      const result = await mpdModule.getCurrentSong(mockMpdClient);
      expect(result).to.be.false;
    });

    it('should return false when stopped', async () => {
      const mockSong = {};
      const mockStatus = { state: 'stop' };

      mockMpdClient.sendCommandAsync
        .withArgs('currentsong')
        .resolves(mockSong)
        .withArgs('status')
        .resolves(mockStatus);

      const result = await mpdModule.getCurrentSong(mockMpdClient);
      expect(result).to.be.false;
    });
  });
});
