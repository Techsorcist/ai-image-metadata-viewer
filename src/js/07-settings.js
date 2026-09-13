// Session settings. Nothing is written to localStorage: the theme starts from the system one,
// highlighting is on, both toggles last until the page is reloaded.
App.about = {
  name: 'AI Image Metadata Viewer',
  version: '1.1.0',
  author: 'Techsorcist',
  repo: 'https://github.com/Techsorcist/ai-image-metadata-viewer',
  demo: 'https://techsorcist.github.io/ai-image-metadata-viewer/',
};

App.settings = {
  highlight: true,
  theme: null,   // null = follow the system, 'light' | 'dark' after the button is pressed

  effectiveTheme() {
    if (this.theme) return this.theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },

  toggleTheme() {
    this.theme = this.effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = this.theme;
  },
};
