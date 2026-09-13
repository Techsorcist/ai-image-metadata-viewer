// Entry point: drag-and-drop over the whole window, adding files, clearing.
App.app = (() => {
  const { state } = App.ui;

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name));
    if (files.length === 0) return;
    const firstNew = state.files.length;
    for (const file of files) {
      state.files.push(await App.source.readFile(file));
    }
    state.selected = firstNew;
    App.ui.render();
  }

  function removeFile(index) {
    const [rec] = state.files.splice(index, 1);
    if (rec) URL.revokeObjectURL(rec.url);
    if (state.selected >= state.files.length) state.selected = state.files.length - 1;
    else if (state.selected > index) state.selected--;
    App.ui.render();
  }

  // Keep only the opened file.
  function clearOthers() {
    const keep = state.files[state.selected];
    state.files.forEach(r => { if (r !== keep) URL.revokeObjectURL(r.url); });
    state.files.length = 0;
    if (keep) state.files.push(keep);
    state.selected = keep ? 0 : -1;
    App.ui.render();
  }

  function clearAll() {
    state.files.forEach(r => URL.revokeObjectURL(r.url));
    state.files.length = 0;
    state.selected = -1;
    App.ui.render();
  }

  function initDragDrop() {
    let depth = 0;
    window.addEventListener('dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', e => { e.preventDefault(); if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', e => { e.preventDefault(); });
    window.addEventListener('drop', e => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');
      addFiles(e.dataTransfer.files);
    });
  }

  function init() {
    App.ui.mount(document.getElementById('app'));
    initDragDrop();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { addFiles, removeFile, clearOthers, clearAll };
})();
