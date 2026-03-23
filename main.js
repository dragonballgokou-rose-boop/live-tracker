// ============================================
// LIVE TRACKER - Main Entry
// ============================================
import './index.css';
import { Router } from './js/router.js';
import BottomTabBar from './js/components/BottomTabBar.js';
import { renderDashboard } from './js/views/dashboard.js';
import { renderTally } from './js/views/tally.js';
import { renderLives } from './js/views/lives.js';
import { renderMembers } from './js/views/members.js';
import { renderChart } from './js/views/chart.js';
import { exportData, importData, fetchFromSupabase } from './js/store.js';
import { showToast } from './js/utils.js';
import { showLiveDetailsModal, showMemberDetailsModal } from './js/views/details.js';

window.showLiveDetailsModal = showLiveDetailsModal;
window.showMemberDetailsModal = showMemberDetailsModal;

// ---------- Page Titles ----------
const pageTitles = {
    '/': 'ダッシュボード',
    '/tally': '集計表',
    '/lives': 'ライブ管理',
    '/members': 'メンバー管理',
    '/chart': 'グラフ',
    '/history': 'ライブ管理'
};

// ---------- BottomTabBar instance ----------
let bottomTabBar = null;

// ---------- Navigation ----------
function updateNav(path) {
    // Delegate bottom-tab active state to the component
    bottomTabBar?.setActiveByPath(path);

    document.getElementById('page-title').textContent = pageTitles[path] || 'LIVE TRACKER';

    // Close sidebar on mobile
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
function showTopProgress() {
    const bar = document.getElementById('top-progress-bar');
    if (!bar) return;
    bar.querySelector('#top-progress-fill').style.width = '0%';
    bar.classList.remove('indeterminate');
    bar.classList.add('active', 'indeterminate');
}

function setTopProgressValue(v) { // 0–1
    const bar = document.getElementById('top-progress-bar');
    const fill = document.getElementById('top-progress-fill');
    if (!bar || !fill) return;
    bar.classList.remove('indeterminate');
    bar.classList.add('active');
    fill.style.width = `${Math.min(v, 1) * 100}%`;
}

function hideTopProgress() {
    const bar = document.getElementById('top-progress-bar');
    const fill = document.getElementById('top-progress-fill');
    if (!bar) return;
    bar.classList.remove('active', 'indeterminate');
    setTimeout(() => { if (fill) fill.style.width = '0%'; }, 200);
}

// ---------- Sync Indicator (Header) ----------
function showSyncIndicator(text = '同期中...') {
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
        indicator.querySelector('.sync-text').textContent = text;
        indicator.classList.remove('hidden');
    }
}

function hideSyncIndicator() {
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
        indicator.classList.add('hidden');
    }
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
function initPullToRefresh(router) {
    const THRESHOLD = 70;
    let startY = 0;
    let pulling = false;

    document.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        pulling = window.scrollY === 0;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy <= 0) { pulling = false; return; }
        setTopProgressValue(Math.min(dy / THRESHOLD, 1));
    }, { passive: true });

    document.addEventListener('touchend', async (e) => {
        if (!pulling) return;
        pulling = false;
        const dy = e.changedTouches[0].clientY - startY;

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
    // Mount BottomTabBar component
    bottomTabBar = new BottomTabBar({
        container: document.getElementById('bottom-nav-container'),
        activeTab: 'top',
    });

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
            } catch (e) {
                if (e.name !== 'AbortError') showToast('共有に失敗しました', 'error');
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
        document.getElementById('import-file').click();
        closeSidebar();
    });

    document.getElementById('import-file')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                importData(ev.target.result);
                showToast('データをインポートしました', 'success');
                // Re-render current page
                router.currentRoute = null;
                router.resolve();
            } catch (err) {
                showToast('インポートに失敗しました: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
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
