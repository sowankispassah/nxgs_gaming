import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { QuickOverlayRoot } from './QuickOverlayRoot';
import './styles.css';

const isQuickOverlayWindow = new URLSearchParams(window.location.search).get('view') === 'quick-overlay';

if (isQuickOverlayWindow) {
  document.documentElement.classList.add('quick-overlay-document');
  document.body.classList.add('quick-overlay-document');
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isQuickOverlayWindow ? <QuickOverlayRoot /> : <App />}
  </React.StrictMode>
);
