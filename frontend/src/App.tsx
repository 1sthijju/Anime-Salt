import { Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import Home from './pages/Home';
import Search from './pages/Search';
import AnimeDetails from './pages/AnimeDetails';
import Watch from './pages/Watch';

export default function App() {
  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 pb-16 pt-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/anime/:slug" element={<AnimeDetails />} />
          <Route path="/watch/:episode" element={<Watch />} />
          <Route
            path="*"
            element={
              <div className="text-center py-20 text-muted">
                <h1 className="text-4xl font-bold mb-4">404</h1>
                <p>Page not found</p>
              </div>
            }
          />
        </Routes>
      </main>
    </>
  );
}