import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Droplet,
  LogOut
} from 'lucide-react';

const navItems = [
  { path: '/employee', icon: LayoutDashboard, label: 'Home' },
  { path: '/employee/properties', icon: FileSpreadsheet, label: 'Properties' },
  { path: '/employee/phed-survey', icon: Droplet, label: 'Water Survey' },
];

export default function EmployeeLayout({ children, title, showBackButton = false }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen pb-20" style={{background: 'var(--phed-bg)'}}>
      {/* Header */}
      <header className="surveyor-header sticky top-0 z-30 border-b" style={{background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)', borderColor: 'var(--phed-border)'}}>
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <img
              src="/phed-logo.png"
              alt="PHED Haryana"
              className="h-11 w-11 object-contain"
              data-testid="surveyor-phed-haryana-logo"
            />
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider leading-none" style={{color: 'var(--phed-blue)'}}>PHED</p>
              <h1 className="font-semibold text-sm leading-tight" style={{color: 'var(--phed-ink)'}}>{title}</h1>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 transition-colors"
            data-testid="employee-logout-btn"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4 max-w-md mx-auto">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="surveyor-bottom-nav fixed bottom-0 left-0 right-0 z-30 border-t flex items-center justify-around px-4 py-2" style={{background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', borderColor: 'var(--phed-border)', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))'}}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center gap-1 px-5 py-2 rounded-xl transition-all ${
                isActive 
                  ? 'text-blue-700' 
                  : 'text-slate-400 hover:text-blue-600'
              }`}
              style={isActive ? {background: 'var(--phed-blue-soft)'} : {}}
              data-testid={`nav-tab-${
                item.path === '/employee'
                  ? 'home'
                  : item.path === '/employee/properties'
                    ? 'properties'
                    : 'water-survey'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
