// ============================================
// LIVE TRACKER - Main Entry
// ============================================
import './index.css';
import { Router } from './js/router.js';
import { renderDashboard } from './js/views/dashboard.js';
import { renderTally } from './js/views/tally.js';
import { renderLives } from './js/views/lives.js';
import { renderMembers } from './js/views/members.js';
import { exportData, importData } from './js/store.js';
import { showToast } from './js/utils.js';

// ---------- Page Titles ----------
const pageTitles = {
    '/': 'ダッシュボード',
    '/tally': '集計表',
    '/lives': 'ライブ管理',
    '/members': 'メンバー管理'
};

// ---------- Navigation ----------
function updateNav(path) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`.nav-item[href="#${path}"]`);
    if (activeItem) activeItem.classList.add('active');

    document.getElementById('page-title').textContent = pageTitles[path] || 'LIVE TRACKER';

    // Close sidebar on mobile
    closeSidebar();
}

// ---------- Sidebar ----------
function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('visible');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
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
    }
]);

// ---------- Event Listeners ----------
document.addEventListener('DOMContentLoaded', () => {
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
        a.download = `live-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
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
});

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Service worker registration failed - that's OK in development
        });
    });
}
