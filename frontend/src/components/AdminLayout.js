import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTown } from '../context/TownContext';
import TownSelector from './TownSelector';
import axios from 'axios';
import {
  LayoutDashboard,
  Users,
  FileSpreadsheet,
  Upload,
  ClipboardCheck,
  Download,
  LogOut,
  Menu,
  X,
  Map,
  FileText,
  Calendar,
  Building2,
  Droplet,
  Database,
  MapPin,
  ClipboardList,
  ScrollText
} from 'lucide-react';
import { Button } from './ui/button';

const API_URL = process.env.REACT_APP_BACKEND_URL;

// All navigation items with permission keys
const allNavItems = [
  { path: '/admin', icon: Droplet, label: 'PHED Dashboard', permission: 'dashboard' },
  { path: '/admin/phed/consumers', icon: ClipboardList, label: 'PHED Consumers', permission: 'properties' },
  { path: '/admin/phed/surveys', icon: ClipboardCheck, label: 'PHED Surveys', permission: 'submissions' },
  { path: '/admin/phed/import', icon: Database, label: 'PHED Import', permission: 'upload' },
  { path: '/admin/phed/location-pending', icon: MapPin, label: 'Location Pending', permission: 'map' },
  { path: '/admin/employees', icon: Users, label: 'Employees', permission: 'employees' },
  { path: '/admin/towns', icon: Building2, label: 'Towns', permission: 'admin_only', adminOnly: true },
  { path: '/admin/audit-log', icon: ScrollText, label: 'Audit Log', permission: 'admin_only', adminOnly: true },
  { path: '/admin/overview', icon: LayoutDashboard, label: 'MC Property Overview', permission: 'dashboard' },
  { path: '/admin/properties', icon: FileSpreadsheet, label: 'MC Properties', permission: 'properties' },
  { path: '/admin/map', icon: Map, label: 'Property Map', permission: 'map' },
  { path: '/admin/upload', icon: Upload, label: 'Upload MC Data', permission: 'upload' },
  { path: '/admin/bills', icon: FileText, label: 'PDF Bills', permission: 'bills' },
  { path: '/admin/attendance', icon: Calendar, label: 'Attendance', permission: 'attendance' },
  { path: '/admin/export', icon: Download, label: 'Export', permission: 'export' },
];

const ROLE_DISPLAY = {
  'ADMIN': 'Super Admin',
  'SUPERVISOR': 'Supervisor',
  'MC_OFFICER': 'MC Officer'
};

export default function AdminLayout({ children, title }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userPermissions, setUserPermissions] = useState(null);
  const { user, token, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Fetch user permissions on mount
  useEffect(() => {
    const fetchPermissions = async () => {
      if (token) {
        try {
          const response = await axios.get(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          setUserPermissions(response.data.permissions);
        } catch (error) {
          console.error('Failed to fetch permissions');
        }
      }
    };
    fetchPermissions();
  }, [token]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Determine which nav items to show based on role and permissions
  const getNavItems = () => {
    // Admin gets all items
    if (user?.role === 'ADMIN') {
      return allNavItems;
    }
    
    // For SUPERVISOR and MC_OFFICER, filter based on permissions
    if (userPermissions) {
      return allNavItems.filter(item => {
        // Skip admin-only items
        if (item.adminOnly) return false;
        
        // Check specific permission keys
        const permKey = item.permission;
        if (permKey === 'dashboard') return userPermissions.can_view_dashboard;
        if (permKey === 'employees') return userPermissions.can_view_employees;
        if (permKey === 'attendance') return userPermissions.can_view_attendance;
        if (permKey === 'upload') return userPermissions.can_upload;
        if (permKey === 'bills') return userPermissions.can_view_bills;
        if (permKey === 'properties') return userPermissions.can_view_properties;
        if (permKey === 'map') return userPermissions.can_view_map;
        if (permKey === 'submissions') return userPermissions.can_view_submissions;
        if (permKey === 'export') return userPermissions.can_export;
        return false;
      });
    }
    
    // Default: show basic items while permissions are loading
    return allNavItems.filter(item => 
      ['dashboard', 'properties', 'map'].includes(item.permission) && !item.adminOnly
    );
  };

  const navItems = getNavItems();

  return (
    <div className="min-h-screen" style={{background: 'var(--phed-bg)'}}>
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="p-3">
          <div className="flex items-center gap-2">
            <img 
              src="/phed-logo.png" 
              alt="Public Health Engineering Department - (PHED)" 
              className="w-12 h-12 object-contain rounded-full"
            />
            <div>
              <h1 className="font-heading font-extrabold text-base leading-none tracking-tight" style={{color: 'var(--phed-blue)'}}>PHED</h1>
              <p className="text-[10px] leading-tight font-medium mt-0.5" style={{color: 'var(--phed-ink)'}}>Public Health Engineering Department</p>
              <p className="text-[9px] leading-tight" style={{color: 'var(--phed-muted)'}}>Survey & Notice Distribution</p>
            </div>
          </div>
        </div>

        <nav className="mt-2 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t" style={{borderColor: 'var(--phed-border)'}}>
          <div className="flex items-center gap-2 px-2 mb-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{background: 'var(--phed-blue-soft)'}}>
              <span className="text-xs font-bold" style={{color: 'var(--phed-blue)'}}>
                {user?.name?.charAt(0) || 'A'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{color: 'var(--phed-ink)'}}>{user?.name}</p>
              <p className="text-[10px]" style={{color: 'var(--phed-muted)'}}>{ROLE_DISPLAY[user?.role] || user?.role}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-500 hover:text-red-600 hover:bg-red-50 text-sm h-8"
            onClick={handleLogout}
            data-testid="admin-logout-btn"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-30 border-b" style={{background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)', borderColor: 'var(--phed-border)'}}>
        <div className="flex items-center justify-between px-4 h-14">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-blue-700 hover:bg-blue-50"
            data-testid="mobile-menu-btn"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          <h1 className="font-heading font-bold text-sm truncate flex-1 mx-2" style={{color: 'var(--phed-ink)'}}>{title}</h1>
          <TownSelector className="h-8 text-xs shrink-0" />
        </div>
      </header>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-slate-900/40 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="main-with-sidebar pt-14 lg:pt-0">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl md:text-3xl font-heading font-bold hidden lg:block" style={{color: 'var(--phed-ink)'}}>
              {title}
            </h1>
            <div className="hidden lg:block">
              <TownSelector />
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
