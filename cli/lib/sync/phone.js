const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const run = (command, args) =>
  new Promise((resolve, reject) =>
    execFile(command, args, { timeout: 60000 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${command}: ${`${stderr}`.trim() || err.message}`)) : resolve(`${stdout}`)
    )
  );

const service = 'org.kde.kdeconnect';
const sftpInterface = 'org.kde.kdeconnect.device.sftp';

/**
 * The phone through KDE Connect: its id by name or id (kdeconnect-cli), and its storage mounted over the
 * SFTP plugin (D-Bus, busctl). exec(command, args) runs a command and resolves its stdout.
 */
const kdeConnect = (exec = run) => {
  const call = async (deviceId, method) => {
    const out = await exec('busctl', [
      '--user',
      '--json=short',
      'call',
      service,
      `/modules/kdeconnect/devices/${deviceId}/sftp`,
      sftpInterface,
      method
    ]);
    return out.trim() ? JSON.parse(out).data[0] : null;
  };
  return {
    // id of a paired, reachable device by name or id, null when it is not reachable
    findDevice: async device => {
      const out = await exec('kdeconnect-cli', ['--list-available', '--id-name-only']);
      const rows = _.compact(`${out}`.split('\n')).map(line => {
        const [id, ...name] = line.trim().split(' ');
        return { id, name: name.join(' ') };
      });
      const found = _.find(rows, row => row.id === device || row.name === device);
      return found ? found.id : null;
    },
    isMounted: deviceId => call(deviceId, 'isMounted'),
    mount: deviceId => call(deviceId, 'mountAndWait'),
    unmount: deviceId => call(deviceId, 'unmount'),
    // the phone's shared storage in the mount (the first directory the plugin lists)
    storage: async deviceId => _.keys(await call(deviceId, 'getDirectories'))[0] || null
  };
};

// what a library file was when it was copied: a changed file (a tag write) is copied again
const stamp = file => {
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
};

/**
 * What the phone's directory needs to match the export (songs: [{ file, name }]): copy (new or changed
 * since copied, or missing there) and remove (files this mirror copied before that left the export; files
 * it never copied are left alone). sent is the last mirror's state, { name: stamp }; existing the names in
 * the phone's directory, or null when unknown (a dry run).
 */
const planMirror = (songs, { sent = {}, existing = null }) => {
  const wanted = new Set(_.map(songs, 'name'));
  const present = name => existing === null || existing.has(name);
  const copy = _.filter(songs, song => {
    const before = sent[song.name];
    return !before || !present(song.name) || !_.isEqual(before, stamp(song.file));
  });
  const remove = _.filter(
    _.keys(sent),
    name => !wanted.has(name) && (existing === null || existing.has(name))
  );
  return { copy, remove };
};

/**
 * Copies and removes as planned in the phone's directory, each copy through a temporary name so an
 * interrupted copy leaves no partial song there. Stops at the first failure (a full phone, the connection
 * gone) and returns { copied, removed, sent, error }, sent being the state to keep: what is on the phone
 * now as this mirror copied it.
 */
const applyMirror = (plan, { directory, sent = {}, onProgress = _.noop }) => {
  fs.mkdirSync(directory, { recursive: true });
  const state = { ...sent };
  let removed = 0;
  _.each(plan.remove, name => {
    fs.rmSync(path.join(directory, name), { force: true });
    delete state[name];
    removed += 1;
  });
  let copied = 0;
  for (const song of plan.copy) {
    const target = path.join(directory, song.name);
    const partial = `${target}.part`;
    try {
      const before = stamp(song.file);
      fs.copyFileSync(song.file, partial);
      const stat = fs.statSync(song.file);
      fs.utimesSync(partial, stat.atime, stat.mtime);
      fs.renameSync(partial, target);
      state[song.name] = before;
      copied += 1;
      onProgress(copied, plan.copy.length, song.name);
    } catch (err) {
      fs.rmSync(partial, { force: true });
      return { copied, removed, sent: state, error: `${song.name}: ${err.message}` };
    }
  }
  return { copied, removed, sent: state, error: null };
};

/**
 * Mirrors the exported songs into sync.phone.directory on the phone (sync.phone.device, a KDE Connect
 * name or id): mounts its storage when it is not mounted yet and unmounts it afterwards. Returns
 * { status: 'unreachable' | 'unmounted' | 'mirrored' | 'dry', copied, removed, sent, error, plan }.
 */
const mirrorToPhone = async ({
  songs,
  phone,
  sent = {},
  dryRun = false,
  connect = kdeConnect(),
  onProgress
}) => {
  if (dryRun) {
    return { status: 'dry', plan: planMirror(songs, { sent }) };
  }
  const deviceId = await connect.findDevice(phone.device);
  if (!deviceId) {
    return { status: 'unreachable' };
  }
  const wasMounted = await connect.isMounted(deviceId);
  if (!wasMounted && !(await connect.mount(deviceId))) {
    return { status: 'unmounted' };
  }
  try {
    const storage = await connect.storage(deviceId);
    if (!storage) {
      return { status: 'unmounted' };
    }
    const directory = path.join(storage, phone.directory || 'Music/musicman');
    const existing = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : []);
    const plan = planMirror(songs, { sent, existing });
    const result = applyMirror(plan, { directory, sent, onProgress });
    return { status: 'mirrored', directory, plan, ...result };
  } finally {
    if (!wasMounted) {
      await connect.unmount(deviceId);
    }
  }
};

module.exports = { applyMirror, kdeConnect, mirrorToPhone, planMirror };
