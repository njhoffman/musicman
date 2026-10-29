const _ = require('lodash');
const path = require('path');
const { spawn } = require('child_process');

// the panel theme shipped with musicman, menu.theme replaces it
const panelTheme = path.join(__dirname, '..', '..', 'share', 'rofi', 'musicman-panel.rasi');

// buttons per row at most when a menu sets no columns
const panelColumns = 6;

// Notification bodies and rofi messages are Pango markup
const escapeMarkup = text =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// a rasi string literal
const rasiString = text => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// A rasi string literal holding Pango markup. rasi rejects a string holding a line break or a quoted part,
// escaped or not, so lines are joined with its \n escape, the markup can use only attribute-free tags
// such as <b>, and quotes and backslashes in the text become entities.
const rasiMarkup = text => {
  const escaped = String(text)
    .replace(/\\/g, '&#92;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return `"${escaped.replace(/\n/g, '\\n')}"`;
};

/**
 * Runs rofi -dmenu on input and resolves to the picked index, { key } for one of keys, or null when
 * dismissed. -format i returns the index, so labels are never parsed back; -no-custom rejects typed
 * text. keys are bound to kb-custom-1.., which make rofi exit with 10..; Tab moves between entries by
 * default, so it is unbound first.
 */
const runRofi = (args, input, { spawnProcess = spawn, keys = [] } = {}) => {
  const keyArgs = _.flatMap(keys, (key, index) => [`-kb-custom-${index + 1}`, key]);
  if (keys.includes('Tab')) {
    keyArgs.unshift('-kb-element-next', '');
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      'rofi',
      ['-dmenu', '-i', '-no-custom', '-format', 'i', ...keyArgs, ...args],
      { stdio: ['pipe', 'pipe', 'ignore'] }
    );
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.on('error', err =>
      reject(err.code === 'ENOENT' ? new Error('rofi is not installed') : err)
    );
    child.on('close', code => {
      // rofi exits 1 when dismissed with Escape
      if (code === 1) {
        resolve(null);
      } else if (code >= 10 && code < 10 + keys.length) {
        resolve({ key: keys[code - 10] });
      } else if (code === 0 && /^\d+$/.test(output.trim())) {
        resolve(Number(output.trim()));
      } else {
        reject(new Error(`rofi exited with code ${code}`));
      }
    });
    child.stdin.end(input);
  });
};

// keys to bind for a menu: its buttons' keys, then the menu-wide ones
const menuKeys = menu => _.uniq([..._.compact(_.map(menu.entries, 'key')), ...(menu.keys || [])]);

const activeArgs = menu => {
  const active = _.flatMap(menu.entries, (entry, index) => (entry.active ? [index] : []));
  return active.length ? ['-a', active.join(',')] : [];
};

// how a key is shown on its button: keysym names as the character they type
const keySymbols = { minus: '-', equal: '=', comma: ',', period: '.', space: '␣' };
const keyLabel = key => keySymbols[key] || key;

// A button: a large icon over its key (dimmed) and caption. Highlighted buttons have a bold caption,
// ones that do not apply to the song are drawn faded. | separates entries, so it is replaced.
const buttonMarkup = entry => {
  const caption = escapeMarkup(entry.caption || entry.label).replace(/\|/g, '¦');
  const key = entry.key
    ? `<span alpha="55%" font_size="small">${escapeMarkup(keyLabel(entry.key))}</span> `
    : '';
  const text = `<span font_size="x-large">${entry.icon || ' '}</span>\n${key}${
    entry.active ? `<b>${caption}</b>` : caption
  }`;
  return entry.disabled ? `<span alpha="35%">${text}</span>` : text;
};

/**
 * Draws a menu as a grid of buttons under the song: a title (the source and song), the cover beside the
 * song's details and the menu's status, all set per menu with -theme-str. Entries hold a line break, so
 * they are separated by | instead; three lines of height fit the large icon and caption.
 * Menus are { title, message, status, cover, accent, columns, entries: [{ icon, label, caption, key,
 * active, disabled }], keys }.
 */
const panelView =
  ({ args = [], theme = panelTheme, spawnProcess = spawn } = {}) =>
  menu => {
    const lines = Math.ceil(menu.entries.length / (menu.columns || panelColumns));
    const columns = Math.ceil(menu.entries.length / lines);
    return runRofi(
      [
        '-markup-rows',
        '-sep',
        '|',
        '-eh',
        '3',
        '-theme',
        theme,
        '-theme-str',
        `listview { columns: ${columns}; lines: ${lines}; }`,
        '-theme-str',
        `textbox-status { content: ${rasiMarkup((menu.status || []).join('\n') || ' ')}; }`,
        ...(menu.accent ? ['-theme-str', `* { accent: ${menu.accent}; }`] : []),
        ...(menu.cover
          ? ['-theme-str', `icon-cover { filename: ${rasiString(menu.cover)}; }`]
          : []),
        '-p',
        menu.title,
        '-mesg',
        menu.message || ' ',
        ...activeArgs(menu),
        ...args
      ],
      _.map(menu.entries, buttonMarkup).join('|'),
      { spawnProcess, keys: menuKeys(menu) }
    );
  };

module.exports = {
  buttonMarkup,
  escapeMarkup,
  menuKeys,
  panelTheme,
  panelView,
  rasiMarkup,
  rasiString,
  runRofi
};
