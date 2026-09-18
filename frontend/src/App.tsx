import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';

const Home = lazy(() => import('./pages/Home'));
const Search = lazy(() => import('./pages/Search'));
const Browse = lazy(() => import('./pages/Browse'));
const Anime = lazy(() => import('./pages/Anime'));
const Watch = lazy(() => import('./pages/Watch'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

function PageFallback() {
  return (
    <div className="container-x grid grid-cols-2 gap-4 py-10 sm:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="skeleton aspect-[2/3]" />
      ))}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/search" element={<Search />} />
              <Route path="/browse/:kind" element={<Browse />} />
              <Route path="/genre/:slug" element={<Browse />} />
              <Route path="/anime/:id" element={<Anime />} />
              <Route path="/watch/:episode" element={<Watch />} />
              <Route
                path="*"
                element={
                  <div className="container-x py-32 text-center">
                    <h1 className="font-display text-4xl font-bold">404</h1>
                    <p className="mt-2 text-muted">This page drifted into the Hollow world.</p>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}