const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '..', 'cli.js');

// fzf preview running musicman itself, e.g. previewCommand('view') shows the tags of the picked song
const previewCommand = (...args) =>
  `FORCE_COLOR=1 ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} ${args.join(' ')} {1}`;

/**
 * Lets the user pick oneline output lines ("key<TAB>text") with fzf, which shows the text and is
 * searched by it. Returns the keys of the picked lines, none when fzf is cancelled or nothing matches.
 */
const pickWithFzf = (
  lines,
  {
    preview,
    previewWindow = 'right,50%,wrap',
    multi = true,
    prompt,
    header,
    spawn = spawnSync
  } = {}
) => {
  const args = ['--ansi', '--delimiter=\t', '--with-nth=2..', '--layout=reverse', '--height=90%'];
  if (multi) {
    args.push('--multi');
  }
  if (preview) {
    args.push(`--preview=${preview}`, `--preview-window=${previewWindow}`);
  }
  if (prompt) {
    args.push(`--prompt=${prompt}> `);
  }
  if (header) {
    args.push(`--header=${header}`);
  }
  // fzf draws on /dev/tty itself, only the picked lines come back on stdout
  const result = spawn('fzf', args, {
    input: lines.join('\n'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit']
  });
  if (result.error) {
    throw new Error(
      result.error.code === 'ENOENT'
        ? 'fzf is not installed or not on PATH, see https://github.com/junegunn/fzf'
        : `fzf failed: ${result.error.message}`
    );
  }
  // 1 is no match and 130 is cancelled with esc or ctrl-c, neither picks anything
  if (result.status === 1 || result.status === 130) {
    return [];
  }
  if (result.status !== 0) {
    throw new Error(`fzf exited with status ${result.status}`);
  }
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('\t')[0]);
};

module.exports = { pickWithFzf, previewCommand };
