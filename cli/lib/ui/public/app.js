// musicman ui: lists from /api, a compare panel with both versions to play, accept and reject

const state = {
  tab: 'review',
  review: null,
  transfers: null,
  selected: null,
  busy: false
};

const tabs = [
  { id: 'review', label: 'Needs review', source: 'review' },
  { id: 'accepted', label: 'Accepted', source: 'review' },
  { id: 'rejected', label: 'Rejected', source: 'review' },
  { id: 'toLocal', label: 'Spotify to local', source: 'transfers' },
  { id: 'toSpotify', label: 'Local to Spotify', source: 'transfers' }
];

// an element with attributes (on* are listeners) and children (strings become text, never markup)
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) {
      return;
    }
    if (key.startsWith('on')) {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'className') {
      el.className = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  });
  children.flat().forEach(child => {
    if (child !== null && child !== undefined && child !== false) {
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  });
  return el;
};

const $ = id => document.getElementById(id);

const api = async (url, body) => {
  const response = await fetch(
    url,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      : {}
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }
  return data;
};

const showMessage = (text, error = false) => {
  const message = $('message');
  message.hidden = !text;
  message.textContent = text || '';
  message.className = error ? 'error' : '';
};

const clock = seconds => {
  if (!seconds && seconds !== 0) {
    return '';
  }
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const songDuration = song => song && song.duration;
const trackDuration = track => track && track.durationMs && track.durationMs / 1000;

const percentCell = similarity => {
  if (!similarity) {
    return h('td', { className: 'num dim' }, '');
  }
  const { percent } = similarity;
  const level = percent >= 95 ? 'high' : percent >= 80 ? 'mid' : 'low';
  return h('td', { className: `num percent ${level}` }, `${percent}%`);
};

const songText = song => `${song.artist || '?'} - ${song.title || '?'}`;
const trackText = track =>
  track && track.name ? `${track.artists || '?'} - ${track.name}` : track ? track.id : '';

// rows of the current tab, each { key, cells, item }
const rowsOf = tab => {
  if (tab === 'review' || tab === 'accepted') {
    return state.review[tab].map(item => ({
      key: `${item.song.id}`,
      item,
      text: [
        songText(item.song),
        item.song.album,
        trackText(item.track),
        item.track && item.track.album,
        item.song.path
      ],
      cells: [
        h('td', {}, songText(item.song), h('div', { className: 'dim' }, item.song.album || '')),
        h(
          'td',
          {},
          trackText(item.track),
          h('div', { className: 'dim' }, (item.track && item.track.album) || '')
        ),
        h(
          'td',
          { className: 'num' },
          clock(songDuration(item.song)),
          h('div', { className: 'dim' }, clock(trackDuration(item.track)))
        ),
        percentCell(item.similarity)
      ]
    }));
  }
  if (tab === 'rejected') {
    return state.review.rejected.map(item => ({
      key: `${item.song.id}`,
      item,
      text: [
        songText(item.song),
        item.song.album,
        item.song.path,
        ...item.rejected.map(({ track }) => trackText(track))
      ],
      cells: [
        h('td', {}, songText(item.song), h('div', { className: 'dim' }, item.song.album || '')),
        h(
          'td',
          {},
          item.rejected.map(({ track }) => h('div', {}, trackText(track)))
        ),
        h(
          'td',
          {},
          item.current ? trackText(item.current) : h('span', { className: 'dim' }, item.status)
        )
      ]
    }));
  }
  if (tab === 'toLocal') {
    return state.transfers.toLocal.map(item => ({
      key: item.track.id,
      item,
      text: [trackText(item.track), item.track.album, ...item.playlists],
      cells: [
        h('td', {}, trackText(item.track)),
        h('td', { className: 'dim' }, item.track.album || ''),
        h('td', { className: 'dim' }, item.playlists.join(', '))
      ]
    }));
  }
  return state.transfers.toSpotify.map(item => ({
    key: item.song.path,
    item,
    text: [
      item.song.artist && songText(item.song),
      item.song.album,
      item.song.path,
      ...item.playlists
    ],
    cells: [
      h(
        'td',
        {},
        item.song.artist ? songText(item.song) : item.song.path,
        h('div', { className: 'dim' }, item.song.path)
      ),
      h('td', { className: 'dim' }, item.playlists.join(', ')),
      h('td', { className: 'dim' }, item.status || 'never looked up')
    ]
  }));
};

const headers = {
  review: ['Local song', 'Spotify candidate', 'Length', 'Similar'],
  accepted: ['Local song', 'Spotify track', 'Length', 'Similar'],
  rejected: ['Local song', 'Rejected tracks', 'Linked now'],
  toLocal: ['Spotify track', 'Album', 'Playlists'],
  toSpotify: ['Local song', 'Belongs in', 'Spotify match']
};

const notes = {
  review:
    'Matches sync --match was not sure of. Pick a row to play both versions, then accept or reject.',
  accepted:
    'Matches accepted in review, newest first. Rejecting removes the Spotify id and fields from the file.',
  rejected: 'Tracks rejected for a song. Accepting one links the song to it after all.',
  toLocal:
    'Tracks in the mapped Spotify playlists that are not in the library (sync --pull downloads them).',
  toSpotify:
    'Songs that belong in a Spotify playlist but have no Spotify id, so only a local file can bring them there.'
};

const renderTabs = () => {
  const counts = {
    review: state.review && state.review.review.length,
    accepted: state.review && state.review.accepted.length,
    rejected: state.review && state.review.rejected.length,
    toLocal: state.transfers && state.transfers.toLocal.length,
    toSpotify: state.transfers && state.transfers.toSpotify.length
  };
  $('tabs').replaceChildren(
    ...tabs.map(({ id, label }) =>
      h(
        'button',
        {
          'aria-selected': String(state.tab === id),
          onClick: () => selectTab(id)
        },
        label,
        counts[id] === undefined || counts[id] === null
          ? null
          : h('span', { className: 'count' }, counts[id])
      )
    )
  );
};

const renderList = () => {
  const list = $('list');
  const source = tabs.find(({ id }) => id === state.tab).source;
  if (!state[source]) {
    list.replaceChildren(
      h(
        'p',
        { className: 'note' },
        source === 'transfers'
          ? 'Comparing the library with the cached Spotify playlists, this takes a few seconds...'
          : 'Loading...'
      )
    );
    return;
  }
  const filter = $('filter').value.trim().toLowerCase();
  const rows = rowsOf(state.tab).filter(
    row => !filter || row.text.filter(Boolean).join(' ').toLowerCase().includes(filter)
  );
  const syncedNote =
    source === 'transfers'
      ? ` As of the last sync${state.transfers.syncedAt ? ` (${state.transfers.syncedAt} UTC)` : ''}.`
      : '';
  list.replaceChildren(
    h('p', { className: 'note' }, notes[state.tab] + syncedNote),
    rows.length === 0
      ? h('p', { className: 'note' }, filter ? 'Nothing matches the filter.' : 'Nothing here.')
      : h(
          'table',
          {},
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              headers[state.tab].map(text => h('th', {}, text))
            )
          ),
          h(
            'tbody',
            {},
            rows.map(row =>
              h(
                'tr',
                {
                  className: state.selected === row.key ? 'selected' : null,
                  tabindex: '0',
                  onClick: () => select(row.key),
                  onKeydown: event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      select(row.key);
                    }
                  }
                },
                row.cells
              )
            )
          )
        )
  );
};

const field = (label, value, other) => [
  h('dt', {}, label),
  h(
    'dd',
    {
      className:
        other !== undefined &&
        value &&
        other &&
        String(value).toLowerCase() !== String(other).toLowerCase()
          ? 'differs'
          : null
    },
    value || h('span', { className: 'dim' }, 'none')
  )
];

const localVersion = song =>
  h(
    'div',
    { className: 'version' },
    h('h3', {}, 'Local file'),
    h(
      'dl',
      {},
      field('Artist', song.artist),
      field('Title', song.title),
      field('Album', song.album),
      field('Length', clock(song.duration)),
      field('Path', song.path)
    ),
    song.id
      ? h('audio', { controls: true, preload: 'none', src: `/api/songs/${song.id}/audio` })
      : null
  );

const spotifyVersion = (title, track, song, actions = []) =>
  h(
    'div',
    { className: 'version' },
    h('h3', {}, title),
    h(
      'dl',
      {},
      field('Artist', track.artists, song && song.artist),
      field('Title', track.name, song && song.title),
      field('Album', track.album, song && song.album),
      field('Length', clock(trackDuration(track)), song && clock(song.duration)),
      field('Track id', track.id)
    ),
    h('iframe', {
      src: `https://open.spotify.com/embed/track/${encodeURIComponent(track.id)}`,
      height: '80',
      loading: 'lazy',
      allow: 'autoplay; clipboard-write; encrypted-media',
      title: `Spotify player for ${trackText(track)}`
    }),
    h(
      'div',
      { className: 'actions' },
      h('button', { onClick: () => openInApp(track.id) }, 'Play in Spotify app'),
      actions
    )
  );

const actionButton = (label, kind, songId, trackId) =>
  h(
    'button',
    { className: kind, disabled: state.busy, onClick: () => act(kind, songId, trackId) },
    label
  );

const similarityLine = similarity =>
  similarity
    ? h(
        'p',
        { className: 'similarity' },
        `${similarity.percent}% similar`,
        h('span', { className: 'dim' }, ` - ${similarity.details}`)
      )
    : null;

const renderCompare = () => {
  const compare = $('compare');
  const row = state.selected && rowsOf(state.tab).find(({ key }) => key === state.selected);
  if (!row) {
    compare.hidden = true;
    compare.replaceChildren();
    return;
  }
  const { item } = row;
  compare.hidden = false;
  let body;
  if (state.tab === 'review') {
    body = [
      similarityLine(item.similarity),
      localVersion(item.song),
      spotifyVersion(
        item.linked ? 'Spotify candidate (already linked)' : 'Spotify candidate',
        item.track,
        item.song,
        [
          actionButton('Accept', 'accept', item.song.id, item.track.id),
          actionButton('Reject', 'reject', item.song.id, item.track.id)
        ]
      )
    ];
  } else if (state.tab === 'accepted') {
    body = [
      similarityLine(item.similarity),
      localVersion(item.song),
      spotifyVersion('Spotify track (accepted)', item.track, item.song, [
        actionButton('Reject', 'reject', item.song.id, item.track.id)
      ])
    ];
  } else if (state.tab === 'rejected') {
    body = [
      localVersion(item.song),
      item.current ? spotifyVersion('Linked now', item.current, item.song) : null,
      ...item.rejected.map(({ track }) =>
        spotifyVersion('Rejected track', track, item.song, [
          actionButton('Accept this one', 'accept', item.song.id, track.id)
        ])
      )
    ];
  } else if (state.tab === 'toLocal') {
    body = [spotifyVersion('Spotify track', item.track, null)];
  } else {
    body = [localVersion(item.song)];
  }
  compare.replaceChildren(h('h2', {}, row.text[0] || ''), ...body);
};

const render = () => {
  renderTabs();
  renderList();
  renderCompare();
};

const load = async source => {
  try {
    state[source] = await api(source === 'review' ? '/api/review' : '/api/transfers');
    if (source === 'review' && state.review.warning) {
      showMessage(state.review.warning, true);
    }
  } catch (err) {
    showMessage(`Could not load ${source}: ${err.message}`, true);
  }
  render();
};

const selectTab = id => {
  state.tab = id;
  state.selected = null;
  const { source } = tabs.find(tab => tab.id === id);
  render();
  if (!state[source]) {
    load(source);
  }
};

const select = key => {
  state.selected = state.selected === key ? null : key;
  renderList();
  renderCompare();
};

const openInApp = async trackId => {
  try {
    await api('/api/spotify/open', { trackId });
    showMessage('Playing in the Spotify app');
  } catch (err) {
    showMessage(`Spotify app: ${err.message}`, true);
  }
};

// greys out the accept and reject buttons without drawing the panel again, which would restart the
// players
const setBusy = busy => {
  state.busy = busy;
  document.querySelectorAll('#compare button.accept, #compare button.reject').forEach(button => {
    button.disabled = busy;
  });
};

const act = async (kind, songId, trackId) => {
  setBusy(true);
  try {
    const result = await api(`/api/songs/${songId}/${kind}`, { trackId });
    showMessage(
      `${kind === 'accept' ? 'Accepted' : 'Rejected'} ${trackId}` +
        (result.detailsError ? ` (fields not fetched: ${result.detailsError})` : '') +
        '; musicman undo restores the tags'
    );
    state.selected = null;
    setBusy(false);
    await load('review');
  } catch (err) {
    showMessage(`${kind} failed: ${err.message}`, true);
    setBusy(false);
  }
};

$('filter').addEventListener('input', () => renderList());
render();
load('review');
