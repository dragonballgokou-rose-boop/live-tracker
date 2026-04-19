// ============================================
// Router - Hash-based SPA Router
// ============================================

export interface Route {
  path: string;
  handler: () => void;
}

export class Router {
  routes: Route[];
  currentRoute: string | null = null;

  constructor(routes: Route[]) {
    this.routes = routes;

    window.addEventListener('hashchange', () => this.resolve());
    window.addEventListener('load',       () => this.resolve());
  }

  resolve(): void {
    const hash = window.location.hash || '#/';
    const fullPath = hash.replace('#', '');
    const path = fullPath.split('?')[0] ?? '/';

    const route = this.routes.find(r => r.path === path) ?? this.routes[0];
    if (!route) return;

    if (this.currentRoute !== route.path) {
      this.currentRoute = route.path;
      route.handler?.();
    }
  }

  navigate(path: string): void {
    window.location.hash = path;
  }
}
