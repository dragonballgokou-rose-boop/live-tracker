// ============================================
// Router - Hash-based SPA Router
// ============================================

export class Router {
    constructor(routes) {
        this.routes = routes;
        this.currentRoute = null;

        window.addEventListener('hashchange', () => this.resolve());
        window.addEventListener('load', () => this.resolve());
    }

    resolve() {
        const hash = window.location.hash || '#/';
        const path = hash.replace('#', '');

        const route = this.routes.find(r => r.path === path) || this.routes[0];

        if (this.currentRoute !== route.path) {
            this.currentRoute = route.path;
            if (route.handler) {
                route.handler();
            }
        }
    }

    navigate(path) {
        window.location.hash = path;
    }
}
