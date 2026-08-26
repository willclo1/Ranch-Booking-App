import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, isAdminish, useAuth } from './auth';
import { api } from './api';
import { ToastProvider } from './components/Toast';
import { Logo, Spinner } from './components/bits';
import { LoginPage } from './pages/LoginPage';
import { InstallPage, markInstallSeen, shouldShowInstall } from './pages/InstallPage';
import { HomePage } from './pages/HomePage';
import { CalendarPage } from './pages/CalendarPage';
import { BookPage } from './pages/BookPage';
import { BookingDetailPage } from './pages/BookingDetailPage';
import { ListsPage } from './pages/ListsPage';
import { MorePage } from './pages/MorePage';
import type { Booking } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Shell />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const [showInstall, setShowInstall] = useState(shouldShowInstall);

  if (loading) {
    return (
      <div className="splash">
        <Logo size={96} />
        <Spinner />
      </div>
    );
  }
  if (showInstall) {
    return (
      <InstallPage
        onDone={() => {
          markInstallSeen();
          setShowInstall(false);
        }}
      />
    );
  }
  if (!user) return <LoginPage onShowInstall={() => setShowInstall(true)} />;

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/book" element={<BookPage />} />
          <Route path="/book/:id" element={<BookPage />} />
          <Route path="/booking/:id" element={<BookingDetailPage />} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/install" element={<InstallRoute />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}

function InstallRoute() {
  const navigate = useNavigate();
  return <InstallPage onDone={() => navigate('/more')} />;
}

function Header() {
  const { user } = useAuth();
  const location = useLocation();
  const titles: Record<string, string> = {
    '/': 'La Grange, Texas',
    '/calendar': 'Calendar',
    '/book': 'Book a stay',
    '/lists': 'Lists & checklists',
    '/more': 'Your account',
  };
  const title = titles[location.pathname] ?? (location.pathname.startsWith('/booking') ? 'Booking' : titles['/']);
  return (
    <header className="app-header">
      <div className="header-brand">
        <Logo size={34} />
        <div>
          <div className="brand-name">AV RANCH</div>
          <div className="brand-sub">{title}</div>
        </div>
      </div>
      <NavLink to="/more" className="header-user" aria-label="Your profile">
        {user?.name.slice(0, 1)}
      </NavLink>
    </header>
  );
}

function BottomNav() {
  const { user } = useAuth();
  const admin = isAdminish(user);
  const { data } = useQuery({
    queryKey: ['pending-count'],
    queryFn: () => api.get<{ bookings: Booking[] }>('/api/bookings/pending'),
    enabled: admin,
    refetchInterval: 60_000,
  });
  const pendingCount = data?.bookings.length ?? 0;

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className="nav-item">
        <HomeIcon />
        <span>Home</span>
      </NavLink>
      <NavLink to="/calendar" className="nav-item">
        <CalendarIcon />
        <span>Calendar</span>
      </NavLink>
      <NavLink to="/book" className="nav-item">
        <PlusIcon />
        <span>Book</span>
      </NavLink>
      <NavLink to="/lists" className="nav-item">
        <ListIcon />
        <span>Lists</span>
      </NavLink>
      <NavLink to="/more" className="nav-item">
        <span className="nav-icon-wrap">
          <PersonIcon />
          {admin && pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
        </span>
        <span>Account</span>
      </NavLink>
    </nav>
  );
}

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </svg>
);

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
const ListIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 6h12M9 12h12M9 18h12" />
    <circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
const PersonIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </svg>
);
