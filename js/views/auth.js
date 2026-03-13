// ============================================
// Auth View - Login / Signup
// ============================================
import { signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithDiscord } from '../supabase.js';
import { showToast } from '../utils.js';

let authMode = 'login'; // 'login' | 'signup'

export function renderAuth() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-logo">
                    <img src="icon.svg" alt="" width="48" height="48" class="auth-logo-img" />
                    <h1 class="auth-logo-text">LIVE<span class="logo-accent">TRACKER</span></h1>
                    <p class="auth-tagline">ライブ参戦をみんなで管理</p>
                </div>

                <!-- OAuth Buttons -->
                <div class="auth-oauth-group">
                    <button id="auth-google-btn" class="btn-oauth btn-oauth-google">
                        <svg width="18" height="18" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Google でログイン
                    </button>
                    <button id="auth-discord-btn" class="btn-oauth btn-oauth-discord">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.045.03.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                        </svg>
                        Discord でログイン
                    </button>
                </div>

                <div class="auth-divider"><span>または</span></div>

                <!-- Email Form -->
                <div class="auth-tabs">
                    <button class="auth-tab${authMode === 'login' ? ' active' : ''}" data-mode="login">ログイン</button>
                    <button class="auth-tab${authMode === 'signup' ? ' active' : ''}" data-mode="signup">新規登録</button>
                </div>

                <form id="auth-form" class="auth-form">
                    ${authMode === 'signup' ? `
                        <div class="form-group">
                            <label class="form-label">表示名</label>
                            <input type="text" id="auth-name" class="form-input" placeholder="あなたの名前" required />
                        </div>
                    ` : ''}
                    <div class="form-group">
                        <label class="form-label">メールアドレス</label>
                        <input type="email" id="auth-email" class="form-input" placeholder="email@example.com" required autocomplete="email" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">パスワード</label>
                        <input type="password" id="auth-password" class="form-input" placeholder="6文字以上" required autocomplete="${authMode === 'login' ? 'current-password' : 'new-password'}" minlength="6" />
                    </div>
                    <button type="submit" id="auth-submit-btn" class="btn btn-primary" style="width:100%;justify-content:center;">
                        ${authMode === 'login' ? 'ログイン' : 'アカウントを作成'}
                    </button>
                </form>

                ${authMode === 'login' ? `
                    <p class="auth-note">アカウントをお持ちでない方は「新規登録」タブへ</p>
                ` : `
                    <p class="auth-note">登録後、確認メールが送信されます</p>
                `}
            </div>
        </div>
    `;

    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            authMode = tab.dataset.mode;
            renderAuth();
        });
    });

    // OAuth buttons
    document.getElementById('auth-google-btn').addEventListener('click', async () => {
        try {
            await signInWithGoogle();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    document.getElementById('auth-discord-btn').addEventListener('click', async () => {
        try {
            await signInWithDiscord();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    // Email form
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('auth-submit-btn');
        const email    = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const name     = document.getElementById('auth-name')?.value.trim();

        btn.disabled = true;
        btn.textContent = '処理中...';

        try {
            if (authMode === 'login') {
                await signInWithEmail(email, password);
                showToast('ログインしました', 'success');
            } else {
                const { user } = await signUpWithEmail(email, password, name);
                if (user?.identities?.length === 0) {
                    showToast('このメールアドレスはすでに登録済みです', 'error');
                } else {
                    showToast('確認メールを送信しました。メールをご確認ください。', 'success');
                }
            }
        } catch (err) {
            showToast(err.message || 'エラーが発生しました', 'error');
            btn.disabled = false;
            btn.textContent = authMode === 'login' ? 'ログイン' : 'アカウントを作成';
        }
    });
}
