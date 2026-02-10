import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App';
import './styles.css';

// Expose React globally so user-authored components (bundled via esbuild)
// can import react without bundling their own copy.
(window as any).__EDITOR_REACT__ = React;
(window as any).__EDITOR_REACT_DOM__ = ReactDOM;

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
