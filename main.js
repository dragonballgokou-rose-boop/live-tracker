// ============================================
// LIVE TRACKER - Main Entry
// ============================================
import './index.css';
import { Router } from './js/router.js';
import { renderDashboard } from './js/views/dashboard.js';
import { renderTally } from './js/views/tally.js';
import { renderLives } from './js/views/lives.js';
import { renderMembers } from './js/views/members.js';
import { renderChart } from './js/views/chart.js';
import { exportData, importData, fetchFromGAS } from './js/store.js';
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

// ---------- Navigation ----------
function updateNav(path) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`.nav-item[href="#${path}"]`);
    if (activeItem) activeItem.classList.add('active');

    // Update bottom nav active state
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeBottomItem = document.querySelector(`.bottom-nav-item[href="#${path}"]`);
    if (activeBottomItem) activeBottomItem.classList.add('active');

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

window.addEventListener('livetracker:sync-start', () => showSyncIndicator('同期中...'));
window.addEventListener('livetracker:sync-success', () => {
    showSyncIndicator('同期完了');
    setTimeout(hideSyncIndicator, 2000);
});
window.addEventListener('livetracker:sync-error', () => {
    showSyncIndicator('同期エラー');
    setTimeout(hideSyncIndicator, 3000);
});

// ---------- Pull to Refresh ----------
function initPullToRefresh(router) {
    const THRESHOLD = 65;
    let startY = 0;
    let pulling = false;

    const indicator = document.createElement('div');
    indicator.className = 'ptr-indicator';
    indicator.innerHTML = `
        <svg class="ptr-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <polyline points="21 3 21 8 16 8"/>
        </svg>
        <span class="ptr-text">引っ張って更新</span>
    `;
    document.getElementById('app').prepend(indicator);

    document.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        pulling = window.scrollY === 0;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy <= 0) { pulling = false; return; }

        const progress = Math.min(dy / THRESHOLD, 1);
        const offsetY = Math.min(dy * 0.4, THRESHOLD * 0.6) - 50;
        indicator.style.transform = `translateY(${offsetY}px)`;
        indicator.style.opacity = progress;

        const icon = indicator.querySelector('.ptr-icon');
        const text = indicator.querySelector('.ptr-text');
        if (dy >= THRESHOLD) {
            icon.style.transform = 'rotate(180deg)';
            text.textContent = '放して更新';
        } else {
            icon.style.transform = `rotate(${progress * 180}deg)`;
            text.textContent = '引っ張って更新';
        }
    }, { passive: true });

    document.addEventListener('touchend', async (e) => {
        if (!pulling) return;
        pulling = false;
        const dy = e.changedTouches[0].clientY - startY;

        if (dy >= THRESHOLD) {
            const icon = indicator.querySelector('.ptr-icon');
            const text = indicator.querySelector('.ptr-text');
            icon.style.transform = '';
            icon.classList.add('animate-spin');
            text.textContent = '更新中...';
            indicator.style.transform = 'translateY(-10px)';
            indicator.style.opacity = '1';

            await fetchFromGAS();
            router.currentRoute = null;
            router.resolve();
        }

        indicator.style.transition = 'opacity 0.3s, transform 0.3s';
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(-50px)';
        setTimeout(() => {
            indicator.style.transition = '';
            indicator.querySelector('.ptr-icon').classList.remove('animate-spin');
        }, 300);
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
    // Show App Loader initially
    const appLoader = document.getElementById('app-loader');
    if (appLoader) {
        appLoader.classList.remove('hidden');
    }

    // Try fetching from GAS on load (if GAS_URL is set)
    try {
        await fetchFromGAS();
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
