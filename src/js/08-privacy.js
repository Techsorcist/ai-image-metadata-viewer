// The "private" badge: values that leave together with the image and are
// usually not expected there: absolute paths with a user name, personal notes.
// The app strips nothing, it only shows.
App.privacy = (() => {
  const VALUE_PATTERNS = [
    /^[A-Za-z]:[\\/]/,                 // C:\ or D:/
    /[\\/](Users|home)[\\/][^\\/\s]+/, // /home/alice, C:\Users\alice, /Users/alice
    /^\/(mnt|media|Volumes)\/[^/]+\//, // mounted drives
    /^~\//,                            // home directory
    /\\\\[^\\]+\\/,                    // network paths \\server\share
  ];
  const KEY_PATTERNS = [/^personalnote$/i, /^(author|artist|user|username|owner)$/i, /note$/i];

  function isSensitive(key, value) {
    if (typeof value !== 'string' || value.trim() === '') return false;
    if (key != null && KEY_PATTERNS.some(re => re.test(String(key)))) return true;
    return VALUE_PATTERNS.some(re => re.test(value));
  }

  function badge() {
    const el = App.util.h('span', { class: 'private', title: 'Looks like private data: a local path, a user name or a personal note. It travels with the image.' },
      App.icons.svg('lock'), 'private');
    return el;
  }

  return { isSensitive, badge };
})();
