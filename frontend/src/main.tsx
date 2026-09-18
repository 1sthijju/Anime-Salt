import React from 'react';
import ReactDOM from 'react-dom/client';
import 'movi-player'; // registers the <movi-player> custom element
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);