import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider, UserProvider } from './state';
import './styles.css';

// Die HTML-Datei wird direkt (file://) geöffnet – dort funktioniert nur Hash-Routing.
const Router = __STANDALONE__ ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <ToastProvider>
        <UserProvider>
          <App />
        </UserProvider>
      </ToastProvider>
    </Router>
  </StrictMode>,
);
