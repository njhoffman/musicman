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
 * default, so it is unbound first. Aborting signal closes rofi and resolves to { redraw: true }.
 */
const runRofi = (args, input, { spawnProcess = spawn, keys = [], signal = null } = {}) => {
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
    let aborted = false;
    const abort = () => {
      aborted = true;
      child.kill();
    };
    if (signal) {
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener('abort', abort, { once: true });
      }
    }
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.on('error', err =>
      reject(err.code === 'ENOENT' ? new Error('rofi is not installed') : err)
    );
    child.on('close', code => {
      if (signal) {
        signal.removeEventListener('abort', abort);
      }
      if (aborted) {
        resolve({ redraw: true });
      } else if (code === 1) {
        // rofi exits 1 when dismissed with Escape
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

// rofi's -a (active) or -u (urgent) argument for the entries with flag
const flagArgs = (menu, flag, option) => {
  const indexes = _.flatMap(menu.entries, (entry, index) => (entry[flag] ? [index] : []));
  return indexes.length ? [option, indexes.join(',')] : [];
};

// how a key is shown on its button: keysym names as the character they type, Alt+ as M-
const keySymbols = { minus: '-', equal: '=', comma: ',', period: '.', space: '␣' };
const keyLabel = key => {
  const alt = /^Alt\+(.+)$/.exec(key);
  return alt ? `M-${keyLabel(alt[1])}` : keySymbols[key] || key;
};

// | separates entries, so it is replaced in captions
const captionOf = entry => String(entry.caption || entry.label).replace(/\|/g, '¦');

// A button: a large icon (in the entry's tone) over its key (dimmed) and caption. Highlighted buttons
// have a bold caption, ones that do not apply to the song are drawn faded.
const buttonMarkup = entry => {
  const caption = escapeMarkup(captionOf(entry));
  const key = entry.key
    ? `<span alpha="55%" font_size="small">${escapeMarkup(keyLabel(entry.key))}</span>  `
    : '';
  const tone = entry.tone && !entry.disabled ? ` foreground="${entry.tone}"` : '';
  const text = `<span font_size="x-large"${tone}>${entry.icon || ' '}</span>\n${key}${
    entry.active ? `<b>${caption}</b>` : caption
  }`;
  return entry.disabled ? `<span alpha="35%">${text}</span>` : text;
};

// A button of a plain menu, text only since rofi filters on the raw text, markup included: the icon
// and a check for highlighted ones, the caption, the key after it. Faded through the urgent state.
const buttonText = entry => {
  const icon = entry.icon ? `${entry.icon}${entry.active ? ' ✓' : ''}` : entry.active ? '✓' : '';
  const key = entry.key ? `   ${keyLabel(entry.key)}` : '';
  return _.compact([icon, `${captionOf(entry)}${key}`]).join('\n');
};

/**
 * Draws a menu as a grid of buttons under the song: a title (the source), the cover beside the song's
 * details and the menu's status, all set per menu with -theme-str. Entries hold a line break, so they
 * are separated by | instead; three lines of height fit the large icon and caption.
 * Menus are { title, message, status, cover, accent, columns, entries: [{ icon, label, caption, key,
 * tone, active, disabled }], keys, selected, signal }; aborting signal closes the menu to redraw it.
 * A plain menu (submenus) is text only and shows a filter box, typing filters its buttons; disabled
 * buttons are marked urgent, which the theme fades. height sets lines of text per button, maxLines the
 * rows shown at most (the rest scroll), align 'left' left-aligns the text (lines of details).
 */
const panelView =
  ({ args = [], theme = panelTheme, spawnProcess = spawn } = {}) =>
  menu => {
    const count = Math.max(1, menu.entries.length);
    const rows = Math.ceil(count / (menu.columns || panelColumns));
    const columns = Math.ceil(count / rows);
    const lines = menu.maxLines ? Math.min(rows, menu.maxLines) : rows;
    const height = menu.height || (menu.plain ? 2 : 3);
    return runRofi(
      [
        ...(menu.plain ? [] : ['-markup-rows']),
        '-sep',
        '|',
        '-eh',
        `${height}`,
        '-theme',
        theme,
        '-theme-str',
        `listview { columns: ${columns}; lines: ${lines}; scrollbar: ${lines < rows}; }`,
        ...(menu.plain
          ? ['-theme-str', 'inputbar { children: [ "prompt", "textbox-sep", "entry" ]; }']
          : []),
        ...(menu.align === 'left'
          ? [
              '-theme-str',
              'element-text { horizontal-align: 0; }',
              '-theme-str',
              'element { padding: 2px 10px; }'
            ]
          : []),
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
        ...flagArgs(menu, 'active', '-a'),
        ...(menu.plain ? flagArgs(menu, 'disabled', '-u') : []),
        ...(menu.selected > 0 ? ['-selected-row', `${menu.selected}`] : []),
        ...args
      ],
      _.map(menu.entries, menu.plain ? buttonText : buttonMarkup).join('|'),
      { spawnProcess, keys: menuKeys(menu), signal: menu.signal || null }
    );
  };

module.exports = {
  buttonMarkup,
  buttonText,
  keyLabel,
  escapeMarkup,
  menuKeys,
  panelTheme,
  panelView,
  rasiMarkup,
  rasiString,
  runRofi
};
