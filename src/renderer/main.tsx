import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import { App } from './App';
import { QuickOverlayRoot } from './QuickOverlayRoot';
import { applyDocumentPreferences } from './ui/preferences';
import './styles.css';

const isQuickOverlayWindow = new URLSearchParams(window.location.search).get('view') === 'quick-overlay';

applyDocumentPreferences();

if (isQuickOverlayWindow) {
  document.documentElement.classList.add('quick-overlay-document');
  document.body.classList.add('quick-overlay-document');
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isQuickOverlayWindow ? <QuickOverlayRoot /> : <App />}
  </React.StrictMode>
);
