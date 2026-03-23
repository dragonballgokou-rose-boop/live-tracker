// ============================================
// BottomTabBar — Liquid Glass Tab Bar Component
// ============================================
// Usage:
//   import BottomTabBar, { TABS } from './components/BottomTabBar.js';
//   const bar = new BottomTabBar({ container, activeTab: 'top', onTabChange });

const SVG = `width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

/** Tab definitions — single source of truth for IDs, paths, labels, icons */
export const TABS = [
  {
    id: 'top',
    path: '/',
    label: 'TOP',
    svg: `<svg ${SVG}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  },
  {
    id: 'tally',
    path: '/tally',
    label: '集計表',
    svg: `<svg ${SVG}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`,
  },
  {
    id: 'chart',
    path: '/chart',
    label: 'グラフ',
    svg: `<svg ${SVG}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`,
  },
  {
    id: 'lives',
    path: '/lives',
    label: 'ライブ',
    svg: `<svg ${SVG}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  },
  {
    id: 'members',
    path: '/members',
    label: 'メンバー',
    svg: `<svg ${SVG}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  },
];

export default class BottomTabBar {
  /**
   * @param {object}      opts
   * @param {HTMLElement} opts.container    — element to mount the nav into
   * @param {string}     [opts.activeTab]   — initial active tab ID (default: 'top')
   * @param {Function}   [opts.onTabChange] — (tabId: string) => void
   */
  constructor({ container, activeTab = 'top', onTabChange } = {}) {
    this.container   = container;
    this.activeTab   = activeTab;
    this.onTabChange = onTabChange ?? null;

    this._nav       = null;
    this._indicator = null;
    this._items     = new Map(); // tabId → <a> element

    this._render();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Activate tab by ID. No-op if already active. */
  setActive(tabId) {
    if (this.activeTab === tabId) return;
    this.activeTab = tabId;
    this._updateActive();
    this.onTabChange?.(tabId);
  }

  /** Activate tab by route path, e.g. '/tally' */
  setActiveByPath(path) {
    const tab = TABS.find(t => path === t.path || path.startsWith(t.path + '/'));
    if (tab) this.setActive(tab.id);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  _render() {
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.id = 'bottom-nav';
    nav.setAttribute('aria-label', 'メインナビゲーション');
    this._nav = nav;

    // Sliding liquid-glass indicator (z-index 0, behind items)
    const indicator = document.createElement('span');
    indicator.className = 'tab-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    this._indicator = indicator;
    nav.appendChild(indicator);

    // Tab items
    TABS.forEach(tab => {
      const a = document.createElement('a');
      a.href = `#${tab.path}`;
      a.className = 'bottom-nav-item' + (tab.id === this.activeTab ? ' active' : '');
      a.dataset.tabId = tab.id;
      a.setAttribute('aria-label', tab.label);
      a.innerHTML = `<span class="item-inner">${tab.svg}<span class="nav-label">${tab.label}</span></span>`;

      a.addEventListener('click', e => {
        e.preventDefault();
        this.setActive(tab.id);
        window.location.hash = tab.path;
      });

      this._items.set(tab.id, a);
      nav.appendChild(a);
    });

    this.container.appendChild(nav);

    // Position indicator once layout is ready
    requestAnimationFrame(() => this._placeIndicator(false));
    window.addEventListener('resize', () => this._placeIndicator(false));
  }

  _updateActive() {
    this._items.forEach((el, id) =>
      el.classList.toggle('active', id === this.activeTab)
    );
    this._placeIndicator(true);
  }

  /**
   * Move the sliding indicator to the active tab.
   * @param {boolean} animate — false = instant (initial render / resize)
   */
  _placeIndicator(animate) {
    const el = this._items.get(this.activeTab);
    if (!el || !this._indicator) return;

    if (!animate) {
      this._indicator.classList.add('no-transition');
    }

    this._indicator.style.left  = el.offsetLeft + 'px';
    this._indicator.style.width = el.offsetWidth + 'px';

    if (!animate) {
      // Force reflow, then re-enable transition
      void this._indicator.getBoundingClientRect();
      this._indicator.classList.remove('no-transition');
    }
  }
}
