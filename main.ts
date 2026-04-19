// ============================================
// LIVE TRACKER - Main Entry
// ============================================
import './index.css';
import { Router } from './js/router.js';
import BottomTabBar from './js/components/BottomTabBar.js';
import { initLiquidGlass } from './js/liquidGlass.js';
import { renderDashboard } from './js/views/dashboard.js';
import { renderTally } from './js/views/tally.js';
import { renderLives } from './js/views/lives.js';
import { renderMembers } from './js/views/members.js';
import { renderChart } from './js/views/chart.js';
import { exportData, importData, fetchFromSupabase } from './js/store.js';
import { showToast } from './js/utils.js';
import { showLiveDetailsModal, showMemberDetailsModal } from './js/views/details.js';
import { showOfficialSyncModal, refreshOfficialSyncBadge } from './js/views/officialSync.js';

// 既存のインラインHTML (onclick="...Modal(...)") 互換のため window にぶら下げる
declare global {
    interface Window {
        showLiveDetailsModal:   typeof showLiveDetailsModal;
        showMemberDetailsModal: typeof showMemberDetailsModal;
    }
}
window.showLiveDetailsModal   = showLiveDetailsModal;
window.showMemberDetailsModal = showMemberDetailsModal;

// ---------- Page Titles ----------
const pageTitles: Record<string, string> = {
    '/':         'ダッシュボード',
    '/tally':    '集計表',
    '/lives':    'ライブ管理',
    '/members':  'メンバー管理',
    '/chart':    'グラフ',
    '/history':  'ライブ管理',
};

// ---------- BottomTabBar instance ----------
let bottomTabBar: BottomTabBar | null = null;

// ---------- Navigation ----------
function updateNav(path: string): void {
    bottomTabBar?.setActiveByPath(path);

    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = pageTitles[path] || 'LIVE TRACKER';

    closeSidebar();
}

// ---------- Sidebar (kept for compatibility, sidebar removed from HTML) ----------
function openSidebar() {
    document.getElementById('sidebar')?.classList.add('open');
    document.getElementById('sidebar-overlay')?.classList.add('visible');
}

function closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('visible');
}

// ---------- Top Progress Bar ----------
function showTopProgress(): void {
    const bar = document.getElementById('top-progress-bar');
    if (!bar) return;
    const fill = bar.querySelector<HTMLElement>('#top-progress-fill');
    if (fill) fill.style.width = '0%';
    bar.classList.remove('indeterminate');
    bar.classList.add('active', 'indeterminate');
}

function setTopProgressValue(v: number): void { // 0–1
    const bar  = document.getElementById('top-progress-bar');
    const fill = document.getElementById('top-progress-fill');
    if (!bar || !fill) return;
    bar.classList.remove('indeterminate');
    bar.classList.add('active');
    fill.style.width = `${Math.min(v, 1) * 100}%`;
}

function hideTopProgress(): void {
    const bar  = document.getElementById('top-progress-bar');
    const fill = document.getElementById('top-progress-fill');
    if (!bar) return;
    bar.classList.remove('active', 'indeterminate');
    setTimeout(() => { if (fill) fill.style.width = '0%'; }, 200);
}

// ---------- Sync Indicator (Header) ----------
function showSyncIndicator(text: string = '同期中...'): void {
    const indicator = document.getElementById('sync-indicator');
    if (!indicator) return;
    const textEl = indicator.querySelector<HTMLElement>('.sync-text');
    if (textEl) textEl.textContent = text;
    indicator.classList.remove('hidden');
}

function hideSyncIndicator(): void {
    document.getElementById('sync-indicator')?.classList.add('hidden');
}

window.addEventListener('livetracker:sync-start', () => {
    showSyncIndicator('同期中...');
    showTopProgress();
});
window.addEventListener('livetracker:sync-success', () => {
    showSyncIndicator('同期完了');
    hideTopProgress();
    setTimeout(hideSyncIndicator, 2000);
});
window.addEventListener('livetracker:sync-error', () => {
    showSyncIndicator('同期エラー');
    hideTopProgress();
    setTimeout(hideSyncIndicator, 3000);
});

// ---------- Pull to Refresh ----------
function initPullToRefresh(router: Router): void {
    const THRESHOLD = 70;
    let startY = 0;
    let pulling = false;

    document.addEventListener('touchstart', (e) => {
        startY = e.touches[0]?.clientY ?? 0;
        pulling = window.scrollY === 0;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!pulling) return;
        const t = e.touches[0];
        if (!t) return;
        const dy = t.clientY - startY;
        if (dy <= 0) { pulling = false; return; }
        setTopProgressValue(Math.min(dy / THRESHOLD, 1));
    }, { passive: true });

    document.addEventListener('touchend', async (e) => {
        if (!pulling) return;
        pulling = false;
        const t = e.changedTouches[0];
        if (!t) return;
        const dy = t.clientY - startY;

        if (dy >= THRESHOLD) {
            showTopProgress(); // indeterminate while loading
            await fetchFromSupabase();
            router.currentRoute = null;
            router.resolve();
            hideTopProgress();
        } else {
            hideTopProgress();
        }
    });
}

// ---------- Router ----------
const router = new Router([
    {
        path: '/',
        handler: () => {
            updateNav('/');
            renderDashboard();
        }
    },
    {
        path: '/tally',
        handler: () => {
            updateNav('/tally');
            renderTally();
        }
    },
    {
        path: '/lives',
        handler: () => {
            updateNav('/lives');
            renderLives();
        }
    },
    {
        path: '/members',
        handler: () => {
            updateNav('/members');
            renderMembers();
        }
    },
    {
        path: '/chart',
        handler: () => {
            updateNav('/chart');
            renderChart();
        }
    },
    {
        path: '/history',
        handler: () => {
            updateNav('/lives');
            renderLives();
        }
    }
]);

// ---------- Event Listeners ----------
document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('bottom-nav-container');
    if (!container) {
        console.error('bottom-nav-container not found');
        return;
    }
    bottomTabBar = new BottomTabBar({
        container,
        activeTab: 'top',
    });

    // Initialise physics-based liquid glass filters (Snell's Law refraction + specular)
    initLiquidGlass();

    // Show App Loader initially
    const appLoader = document.getElementById('app-loader');
    if (appLoader) {
        appLoader.classList.remove('hidden');
    }

    // Supabase から最新データを取得
    try {
        await fetchFromSupabase();
    } catch (e) {
        console.warn('Initial sync failed', e);
    }

    // Hide loader
    if (appLoader) {
        appLoader.classList.add('hidden');
    }

    // 公式データの更新件数をヘッダーバッジに表示（失敗しても無視）
    refreshOfficialSyncBadge();

    // Sidebar toggle
    document.getElementById('menu-toggle')?.addEventListener('click', openSidebar);
    document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

    // Share
    document.getElementById('share-btn')?.addEventListener('click', async () => {
        const url = location.href;
        const title = document.getElementById('page-title')?.textContent || 'LIVE TRACKER';
        if (navigator.share) {
            try {
                await navigator.share({ title, url });
            } catch (e: unknown) {
                if ((e as Error)?.name !== 'AbortError') showToast('共有に失敗しました', 'error');
            }
        } else {
            try {
                await navigator.clipboard.writeText(url);
                showToast('リンクをコピーしました', 'success');
            } catch {
                showToast('コピーに失敗しました', 'error');
            }
        }
    });

    // Export
    document.getElementById('export-btn')?.addEventListener('click', () => {
        const data = exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        a.download = `live-tracker-backup-${y}-${m}-${d}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('データをエクスポートしました', 'success');
        closeSidebar();
    });

    // Import
    document.getElementById('import-btn')?.addEventListener('click', () => {
        document.getElementById('import-file')?.click();
        closeSidebar();
    });

    // Official Live Sync (乃木坂46 / 櫻坂46)
    document.getElementById('official-sync-btn')?.addEventListener('click', () => {
        showOfficialSyncModal().catch(err => {
            console.error('official sync failed:', err);
            showToast('公式データの読み込みに失敗しました', 'error');
        });
    });

    document.getElementById('import-file')?.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                importData(ev.target?.result as string);
                showToast('データをインポートしました', 'success');
                // Re-render current page
                router.currentRoute = null;
                router.resolve();
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                showToast('インポートに失敗しました: ' + msg, 'error');
            }
        };
        reader.readAsText(file);
        input.value = '';
    });

    // Initialize router
    router.resolve();

    // Pull to refresh
    initPullToRefresh(router);
});

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Service worker registration failed - that's OK in development
        });
    });
}
