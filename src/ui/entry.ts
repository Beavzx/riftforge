// Browser entry point for dist/app.js.
import { boot } from './main';
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot()); else boot();
