// ============================================
// BottomTabBar — iOS 標準 UITabBar 相当のタブバー
//
// iOS のデフォルトタブバーに合わせた構成:
//   - 未選択はアウトライン、選択中は塗りつぶしアイコン (SF Symbols の .fill 相当)
//   - スライドするピル型インジケーターは持たない（選択は色で示す）
//   - 見た目（半透明マテリアル / ヘアライン / ティント）は index.css 側で定義
// ============================================

const SVG        = `class="tab-icon-outline" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
const SVG_FILLED = `class="tab-icon-filled" width="26" height="26" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"`;

export interface TabDef {
  id: string;
  path: string;
  label: string;
  /** 未選択時のアウトラインアイコン */
  svg: string;
  /** 選択時の塗りつぶしアイコン */
  svgFilled: string;
}

/** Tab definitions — single source of truth for IDs, paths, labels, icons */
export const TABS: TabDef[] = [
  {
    id: 'top',
    path: '/',
    label: 'TOP',
    svg: `<svg ${SVG}><rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/></svg>`,
    svgFilled: `<svg ${SVG_FILLED}><rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/></svg>`,
  },
  {
    id: 'tally',
    path: '/tally',
    label: '集計表',
    svg: `<svg ${SVG}><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><line x1="2.5" y1="9.5" x2="21.5" y2="9.5"/><line x1="2.5" y1="15" x2="21.5" y2="15"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15.5" y1="4" x2="15.5" y2="20"/></svg>`,
    svgFilled: `<svg ${SVG_FILLED}><path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5V8.6H2V6.5A2.5 2.5 0 0 1 4.5 4Z"/><rect x="2" y="10.1" width="6.4" height="4.4"/><rect x="9.9" y="10.1" width="4.9" height="4.4"/><rect x="16.3" y="10.1" width="5.7" height="4.4"/><path d="M2 16h6.4v4H4.5A2.5 2.5 0 0 1 2 17.5V16Z"/><rect x="9.9" y="16" width="4.9" height="4"/><path d="M16.3 16H22v1.5A2.5 2.5 0 0 1 19.5 20h-3.2V16Z"/></svg>`,
  },
  {
    id: 'lives',
    path: '/lives',
    label: 'ライブ',
    svg: `<svg ${SVG}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    svgFilled: `<svg ${SVG_FILLED}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  },
  {
    id: 'members',
    path: '/members',
    label: 'メンバー',
    svg: `<svg ${SVG}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    svgFilled: `<svg ${SVG_FILLED}><circle cx="9" cy="7.5" r="4"/><path d="M9 13.5c-4.1 0-7.5 2.1-7.5 4.7V21h15v-2.8c0-2.6-3.4-4.7-7.5-4.7Z"/><circle cx="17.6" cy="8.2" r="3.1"/><path d="M17.6 13.2c-.85 0-1.66.09-2.4.26 1.6 1.2 2.55 2.9 2.55 4.74V21H23v-2.9c0-2.5-2.4-4.9-5.4-4.9Z"/></svg>`,
  },
  {
    id: 'photos',
    path: '/photos',
    label: '生写真',
    svg: `<svg ${SVG}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    svgFilled: `<svg ${SVG_FILLED}><path fill-rule="evenodd" d="M9.4 3h5.2a1.5 1.5 0 0 1 1.25.67l.95 1.83H20A2.5 2.5 0 0 1 22.5 8v11a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 19V8A2.5 2.5 0 0 1 4 5.5h3.2l.95-1.83A1.5 1.5 0 0 1 9.4 3Zm2.6 6a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z"/></svg>`,
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

    TABS.forEach(tab => {
      const a = document.createElement('a');
      a.href = `#${tab.path}`;
      const isActive = tab.id === this.activeTab;
      a.className = 'bottom-nav-item' + (isActive ? ' active' : '');
      a.dataset.tabId = tab.id;
      a.setAttribute('aria-label', tab.label);
      // iOS 標準タブは選択項目を aria-current で示す
      if (isActive) a.setAttribute('aria-current', 'page');
      a.innerHTML =
        `<span class="item-inner">` +
          `<span class="tab-icon">${tab.svg}${tab.svgFilled}</span>` +
          `<span class="nav-label">${tab.label}</span>` +
        `</span>`;

      a.addEventListener('click', e => {
        e.preventDefault();
        this.setActive(tab.id);
        window.location.hash = tab.path;
      });

      this._items.set(tab.id, a);
      nav.appendChild(a);
    });

    this.container.appendChild(nav);
  }

  private _updateActive(): void {
    this._items.forEach((el, id) => {
      const isActive = id === this.activeTab;
      el.classList.toggle('active', isActive);
      if (isActive) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }
}
