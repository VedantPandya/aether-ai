import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './HarnessApp';
const PhysicsLibrary = React.lazy(() => import('./PhysicsLibrary'));
// The demo film lives in demo-video/film and renders the app's own components on a scripted clock.
const DemoFilm = React.lazy(() => import('../demo-video/film/DemoFilm'));
import './harness.css';
const route = window.location.pathname.replace(/\/+$/, '').split('/').pop();
createRoot(document.getElementById('root')!).render(<React.StrictMode>{
  route === 'physics' ? <React.Suspense fallback={<p>Loading physics library…</p>}><PhysicsLibrary /></React.Suspense>
  : route === 'demo' ? <React.Suspense fallback={null}><DemoFilm /></React.Suspense>
  : <App />}</React.StrictMode>);
