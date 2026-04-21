// ============================================
// BottomTabBar — Liquid Glass Tab Bar Component
// ============================================

const SVG = `width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

export interface TabDef {
  id: string;
  path: string;
  label: string;
  svg: string;
}

/** Tab definitions — single source of truth for IDs, paths, labels, icons */
export const TABS: TabDef[] = [
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
  {
    id: 'photos',
    path: '/photos',
    label: '生写真',
    svg: `<svg ${SVG}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  },
];

export interface BottomTabBarOptions {
  container: HTMLElement;
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
}

export default class BottomTabBar {
  private container: HTMLElement;
  activeTab: string;
  private onTabChange: ((tabId: string) => void) | null;

  private _nav: HTMLElement | null = null;
  private _indicator: HTMLElement | null = null;
  private _items: Map<string, HTMLAnchorElement> = new Map();

  constructor({ container, activeTab = 'top', onTabChange }: BottomTabBarOptions) {
    this.container   = container;
    this.activeTab   = activeTab;
    this.onTabChange = onTabChange ?? null;
    this._render();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Activate tab by ID. No-op if already active. */
  setActive(tabId: string): void {
    if (this.activeTab === tabId) return;
    this.activeTab = tabId;
    this._updateActive();
    this.onTabChange?.(tabId);
  }

  /** Activate tab by route path, e.g. '/tally' */
  setActiveByPath(path: string): void {
    const tab = TABS.find(t => path === t.path || path.startsWith(t.path + '/'));
    if (tab) this.setActive(tab.id);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _render(): void {
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.id = 'bottom-nav';
    nav.setAttribute('aria-label', 'メインナビゲーション');
    this._nav = nav;

    const indicator = document.createElement('span');
    indicator.className = 'tab-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    this._indicator = indicator;
    nav.appendChild(indicator);

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

    requestAnimationFrame(() => this._placeIndicator(false));
    window.addEventListener('resize', () => this._placeIndicator(false));
  }

  private _updateActive(): void {
    this._items.forEach((el, id) =>
      el.classList.toggle('active', id === this.activeTab),
    );
    this._placeIndicator(true);
  }

  /**
   * Move the sliding indicator to the active tab.
   * @param animate  false = instant (initial render / resize)
   */
  private _placeIndicator(animate: boolean): void {
    const el = this._items.get(this.activeTab);
    if (!el || !this._indicator) return;

    if (!animate) this._indicator.classList.add('no-transition');

    this._indicator.style.left  = el.offsetLeft + 'px';
    this._indicator.style.width = el.offsetWidth + 'px';

    if (!animate) {
      void this._indicator.getBoundingClientRect();
      this._indicator.classList.remove('no-transition');
    }
  }
}
