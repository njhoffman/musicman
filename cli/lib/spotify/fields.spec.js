const { expect } = require('chai');
const { assignFields, fetchDetails, isIgnored, leafPaths, valuesAt } = require('./fields.js');

describe('Spotify Fields', () => {
  const track = {
    id: 'track-1',
    name: 'Karma Police',
    popularity: 82,
    explicit: false,
    preview_url: null,
    artists: [
      { id: 'artist-1', name: 'Radiohead', href: 'h' },
      { id: 'artist-2', name: 'Guest', href: 'h' }
    ],
    album: { id: 'album-1', name: 'OK Computer', release_date: '1997-05-28' },
    external_ids: { isrc: 'GBAYE9701368' }
  };
  const album = {
    id: 'album-1',
    label: 'XL Recordings',
    genres: [],
    copyrights: [
      { text: '1997 XL', type: 'C' },
      { text: '1997 XL', type: 'P' }
    ]
  };
  const artist = { id: 'artist-1', genres: ['art rock', 'alternative rock'], popularity: 87 };
  const now = new Date('2026-10-20T10:00:00Z');

  describe('valuesAt', () => {
    it('should read nested values and collect array items with []', () => {
      expect(valuesAt({ track }, 'track.album.name')).to.deep.equal(['OK Computer']);
      expect(valuesAt({ track }, 'track.artists[].name')).to.deep.equal(['Radiohead', 'Guest']);
      expect(valuesAt({ artist }, 'artist.genres[]')).to.deep.equal([
        'art rock',
        'alternative rock'
      ]);
    });

    it('should leave out missing, null, and empty values', () => {
      expect(valuesAt({ track }, 'track.preview_url')).to.deep.equal([]);
      expect(valuesAt({ track }, 'album.label')).to.deep.equal([]);
      expect(valuesAt({ album }, 'album.genres[]')).to.deep.equal([]);
      expect(valuesAt({ track }, 'track.explicit')).to.deep.equal([false]);
    });
  });

  describe('leafPaths and isIgnored', () => {
    it('should list every path with a value in field path notation', () => {
      expect(leafPaths(album, 'album').sort()).to.deep.equal([
        'album.copyrights[].text',
        'album.copyrights[].type',
        'album.id',
        'album.label'
      ]);
    });

    it('should ignore keys at any depth and paths with everything under them', () => {
      expect(isIgnored('track.artists[].href', ['href'])).to.be.true;
      expect(isIgnored('album.tracks.items[].name', ['album.tracks'])).to.be.true;
      expect(isIgnored('album.copyrights[].type', ['album.copyrights[].type'])).to.be.true;
      expect(isIgnored('album.tracksTotal', ['album.tracks'])).to.be.false;
      expect(isIgnored('track.name', ['href', 'album.tracks'])).to.be.false;
    });
  });

  describe('assignFields', () => {
    const config = {
      spotify: {
        fields: [
          { path: 'track.name', name: 'sp_title', fallback: 'title' },
          { path: 'track.artists[].name', name: 'sp_artist', fallback: 'artist' },
          { path: 'track.artists[].id', name: 'sp_artist_id', multi: true },
          { path: 'track.album.release_date', name: 'sp_release_date', fallback: 'year' },
          { path: 'track.popularity', name: 'sp_popularity' },
          { path: 'track.explicit', name: 'sp_explicit' },
          { path: 'album.copyrights[].text', name: 'sp_copyright', separator: '; ' },
          { path: 'album.genres[]', name: 'sp_album_genres', multi: true },
          { path: 'artist.genres[]', name: 'sp_genres', multi: true }
        ],
        ignore: ['href', 'album.id', 'album.copyrights[].type', 'artist.id']
      }
    };

    it('should assign the id, fetch time, and every mapped field with a value', () => {
      const { custom } = assignFields({ track, album, artist }, config, now);
      expect(custom).to.deep.equal([
        { name: 'sp_track_id', value: 'track-1' },
        { name: 'sp_fetched_at', value: '2026-10-20T10:00:00.000Z' },
        { name: 'sp_title', value: 'Karma Police' },
        { name: 'sp_artist', value: 'Radiohead, Guest' },
        { name: 'sp_artist_id', value: 'artist-1,artist-2' },
        { name: 'sp_release_date', value: '1997-05-28' },
        { name: 'sp_popularity', value: '82' },
        { name: 'sp_explicit', value: 'false' },
        { name: 'sp_copyright', value: '1997 XL' },
        { name: 'sp_genres', value: 'art rock,alternative rock' }
      ]);
    });

    it('should give fallbacks the value, with only the year of a release date', () => {
      const { fallbacks } = assignFields({ track, album, artist }, config, now);
      expect(fallbacks).to.deep.equal([
        { name: 'title', value: 'Karma Police' },
        { name: 'artist', value: 'Radiohead, Guest' },
        { name: 'year', value: '1997' }
      ]);
    });

    it('should report response paths that are neither mapped nor ignored', () => {
      const { unassigned } = assignFields({ track, album, artist }, config, now);
      expect(unassigned.sort()).to.deep.equal(
        [
          'artist.popularity',
          'track.album.id',
          'track.album.name',
          'track.external_ids.isrc',
          'album.label'
        ].sort()
      );
    });

    it('should work without album and artist details', () => {
      const { custom } = assignFields({ track }, config, now);
      expect(custom.map(({ name }) => name)).to.not.include('sp_genres');
    });

    describe('album scope', () => {
      const scoped = {
        spotify: {
          fields: [
            { path: 'track.name', name: 'sp_title', fallback: 'title' },
            {
              path: 'track.album.name',
              name: 'sp_album',
              fallback: 'album',
              fallbackScope: 'album'
            },
            { path: 'track.album.release_date', name: 'sp_release_date', fallback: 'year' },
            { path: 'album.label', name: 'sp_label', fallback: 'publisher', scope: 'album' },
            { path: 'artist.genres[]', name: 'sp_genres', multi: true }
          ]
        }
      };
      const objects = { track, album, artist };
      const names = list => list.map(({ name }) => name);

      it('should write album fields and fallbacks to songs in albums by default', () => {
        const { custom, fallbacks, removed } = assignFields(objects, scoped, now);
        expect(names(custom)).to.include.members(['sp_album', 'sp_label']);
        expect(names(fallbacks)).to.deep.equal(['title', 'album', 'year', 'publisher']);
        expect(removed).to.deep.equal([]);
      });

      it('should leave album fields out of songs outside albums and list them as removed', () => {
        const { custom, removed } = assignFields(objects, scoped, now, { album: false });
        expect(names(custom)).to.deep.equal([
          'sp_track_id',
          'sp_fetched_at',
          'sp_title',
          'sp_album',
          'sp_release_date',
          'sp_genres'
        ]);
        expect(removed).to.deep.equal(['sp_label']);
      });

      it('should keep a fallbackScope album field but not fill its fallback outside albums', () => {
        const { fallbacks } = assignFields(objects, scoped, now, { album: false });
        expect(fallbacks).to.deep.equal([
          { name: 'title', value: 'Karma Police' },
          { name: 'year', value: '1997' }
        ]);
      });
    });
  });

  describe('fetchDetails', () => {
    const fakeClient = responses => {
      const urls = [];
      return {
        urls,
        get: async url => {
          urls.push(url);
          const [, type, ids] = url.match(/^\/(\w+)\?ids=(.*)$/);
          return { [type]: ids.split(',').map(id => responses[id] || null) };
        }
      };
    };

    it('should fetch unknown tracks, then their albums and first artists once each', async () => {
      const other = { ...track, id: 'track-2' };
      const client = fakeClient({ 'track-2': other, 'album-1': album, 'artist-1': artist });
      const config = {
        spotify: { fields: [{ path: 'album.label' }, { path: 'artist.genres[]' }] }
      };
      const details = await fetchDetails(
        client,
        ['track-1', 'track-2', 'missing'],
        config,
        new Map([['track-1', track]])
      );
      expect(client.urls).to.deep.equal([
        '/tracks?ids=track-2,missing',
        '/albums?ids=album-1',
        '/artists?ids=artist-1'
      ]);
      expect([...details.keys()]).to.deep.equal(['track-1', 'track-2']);
      expect(details.get('track-2')).to.deep.equal({ track: other, album, artist });
    });

    it('should not request albums or artists no field needs', async () => {
      const client = fakeClient({ 'track-1': track });
      await fetchDetails(client, ['track-1'], { spotify: { fields: [{ path: 'track.name' }] } });
      expect(client.urls).to.deep.equal(['/tracks?ids=track-1']);
    });

    it('should not request the albums of singles when only album fields need them', async () => {
      const other = { ...track, id: 'track-2', album: { id: 'album-2' } };
      const client = fakeClient({ 'track-1': track, 'track-2': other, 'album-1': album });
      const config = {
        spotify: { fields: [{ path: 'album.label', name: 'sp_label', scope: 'album' }] }
      };
      const details = await fetchDetails(client, ['track-1', 'track-2'], config, new Map(), {
        singles: new Set(['track-2'])
      });
      expect(client.urls).to.deep.equal(['/tracks?ids=track-1,track-2', '/albums?ids=album-1']);
      expect(details.get('track-2').album).to.equal(undefined);
    });

    it('should still request the albums of singles for fields every song gets', async () => {
      const client = fakeClient({ 'track-1': track, 'album-1': album });
      const config = {
        spotify: {
          fields: [
            { path: 'album.label', name: 'sp_label', scope: 'album' },
            { path: 'album.popularity', name: 'sp_album_popularity' }
          ]
        }
      };
      await fetchDetails(client, ['track-1'], config, new Map(), { singles: new Set(['track-1']) });
      expect(client.urls).to.deep.equal(['/tracks?ids=track-1', '/albums?ids=album-1']);
    });

    it('should request tracks in batches of 50', async () => {
      const ids = Array.from({ length: 51 }, (_, i) => `t${i}`);
      const client = fakeClient({});
      await fetchDetails(client, ids, {});
      expect(client.urls).to.have.length(2);
    });
  });
});
