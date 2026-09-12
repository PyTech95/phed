import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import axios from "axios";
import Login from "./views/Login";
import SelectTown from "./views/SelectTown";
import AdminDashboard from "./views/admin/Dashboard";
import AdminEmployees from "./views/admin/Employees";
import AdminProperties from "./views/admin/Properties";
import AdminUpload from "./views/admin/Upload";
import AdminSubmissions from "./views/admin/Submissions";
import AdminExport from "./views/admin/Export";
import AdminMap from "./views/admin/Map";
import AdminBills from "./views/admin/Bills";
import AdminBillsMap from "./views/admin/BillsMap";
import AdminAttendance from "./views/admin/Attendance";
import AdminTowns from "./views/admin/Towns";
import AdminAuditLog from "./views/admin/AuditLog";
import EnvBanner from "./components/EnvBanner";
import PhedDashboard from "./views/admin/PhedDashboard";
import PhedConsumers from "./views/admin/PhedConsumers";
import PhedImport from "./views/admin/PhedImport";
import PhedLocationPending from "./views/admin/LocationPending";
import PhedSurveys from "./views/admin/PhedSurveys";
import PhedTodayDashboard from "./views/admin/PhedTodayDashboard";
import EmployeeDashboard from "./views/employee/Dashboard";
import EmployeeProperties from "./views/employee/Properties";
import EmployeeSurvey from "./views/employee/Survey";
import EmployeeAttendance from "./views/employee/Attendance";
import EmployeePropertyMap from "./views/employee/PropertyMap";
import PhedFieldSurvey from "./views/employee/PhedFieldSurvey";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { TownProvider, useTown } from "./context/TownContext";
import "@/App.css";

// Axios interceptor: automatically attach X-Town-Code header to ALL API requests
axios.interceptors.request.use((config) => {
  try {
    const savedTown = localStorage.getItem('selectedTown');
    if (savedTown) {
      const town = JSON.parse(savedTown);
      if (town && town.code) {
        config.headers['X-Town-Code'] = town.code;
        config.headers['X-Town-ID'] = town.id;
      }
    }
  } catch (e) {
    // ignore parse errors
  }
  return config;
});

// Protected Route with Town requirement
function ProtectedRoute({ children, allowedRoles, requireTown = true }) {
  const { user, loading } = useAuth();
  const { selectedTown, loading: townLoading, towns } = useTown();
  
  if (loading || townLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-pulse-slow text-slate-600">Loading...</div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  // Check if town selection is required and towns exist
  if (requireTown && towns.length > 0 && !selectedTown) {
    return <Navigate to="/select-town" replace />;
  }
  
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect based on role
    if (user.role === 'ADMIN' || user.role === 'SUPERVISOR') {
      return <Navigate to="/admin" replace />;
    } else if (user.role === 'MC_OFFICER') {
      return <Navigate to="/admin" replace />; // MC Officer also goes to admin but with limited view
    }
    return <Navigate to="/employee" replace />;
  }
  
  return children;
}

// All non-admin roles that can access employee/surveyor routes
const SURVEYOR_ROLES = ['EMPLOYEE', 'SURVEYOR'];

// Admin-level roles (full access)
const ADMIN_ROLES = ['ADMIN', 'SUPERVISOR'];

// Roles that can view admin dashboard (includes MC_OFFICER with limited access)
const ADMIN_VIEW_ROLES = ['ADMIN', 'SUPERVISOR', 'MC_OFFICER'];

function AppRoutes() {
  const { user } = useAuth();
  
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/select-town" element={<SelectTown />} />
      
      {/* Admin Routes - Full Access (ADMIN, SUPERVISOR) */}
      <Route path="/admin" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <PhedDashboard />
        </ProtectedRoute>
      } />
      <Route path="/admin/overview" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <AdminDashboard />
        </ProtectedRoute>
      } />
      <Route path="/admin/employees" element={
        <ProtectedRoute allowedRoles={ADMIN_ROLES}>
          <AdminEmployees />
        </ProtectedRoute>
      } />
      <Route path="/admin/properties" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <AdminProperties />
        </ProtectedRoute>
      } />
      <Route path="/admin/upload" element={
        <ProtectedRoute allowedRoles={ADMIN_ROLES}>
          <AdminUpload />
        </ProtectedRoute>
      } />
      <Route path="/admin/submissions" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <AdminSubmissions />
        </ProtectedRoute>
      } />
      <Route path="/admin/export" element={
        <ProtectedRoute allowedRoles={ADMIN_ROLES}>
          <AdminExport />
        </ProtectedRoute>
      } />
      <Route path="/admin/map" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <AdminMap />
        </ProtectedRoute>
      } />
      <Route path="/admin/bills" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <AdminBills />
        </ProtectedRoute>
      } />
      <Route path="/admin/bills-map" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <AdminBillsMap />
        </ProtectedRoute>
      } />
      <Route path="/admin/attendance" element={
        <ProtectedRoute allowedRoles={ADMIN_ROLES}>
          <AdminAttendance />
        </ProtectedRoute>
      } />
      <Route path="/admin/towns" element={
        <ProtectedRoute allowedRoles={['ADMIN']} requireTown={false}>
          <AdminTowns />
        </ProtectedRoute>
      } />
      <Route path="/admin/audit-log" element={
        <ProtectedRoute allowedRoles={['ADMIN']} requireTown={false}>
          <AdminAuditLog />
        </ProtectedRoute>
      } />
      
      <Route path="/employee/phed-survey" element={
        <ProtectedRoute allowedRoles={['EMPLOYEE', 'SURVEYOR', 'ADMIN', 'SUPERVISOR', 'MC_OFFICER']}>
          <PhedFieldSurvey />
        </ProtectedRoute>
      } />
      <Route path="/employee/phed-survey/:propertyId" element={
        <ProtectedRoute allowedRoles={['EMPLOYEE', 'SURVEYOR', 'ADMIN', 'SUPERVISOR', 'MC_OFFICER']}>
          <PhedFieldSurvey />
        </ProtectedRoute>
      } />

      {/* PHED Survey Routes */}
      <Route path="/admin/phed" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <PhedDashboard />
        </ProtectedRoute>
      } />
      <Route path="/admin/phed/today" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <PhedTodayDashboard />
        </ProtectedRoute>
      } />
      <Route path="/admin/phed/consumers" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <PhedConsumers />
        </ProtectedRoute>
      } />
      <Route path="/admin/phed/surveys" element={
        <ProtectedRoute allowedRoles={ADMIN_VIEW_ROLES}>
          <PhedSurveys />
        </ProtectedRoute>
      } />
      <Route path="/admin/phed/import" element={
        <ProtectedRoute allowedRoles={ADMIN_ROLES}>
          <PhedImport />
        </ProtectedRoute>
      } />

      <Route path="/admin/phed/location-pending" element={
        <ProtectedRoute allowedRoles={ADMIN_ROLES}>
          <PhedLocationPending />
        </ProtectedRoute>
      } />

      {/* Employee/Surveyor Routes */}
      <Route path="/employee" element={
        <ProtectedRoute allowedRoles={SURVEYOR_ROLES}>
          <EmployeeDashboard />
        </ProtectedRoute>
      } />
      <Route path="/employee/properties" element={
        <ProtectedRoute allowedRoles={SURVEYOR_ROLES}>
          <EmployeeProperties />
        </ProtectedRoute>
      } />
      <Route path="/employee/survey/:propertyId" element={
        <ProtectedRoute allowedRoles={SURVEYOR_ROLES}>
          <EmployeeSurvey />
        </ProtectedRoute>
      } />
      <Route path="/employee/attendance" element={
        <ProtectedRoute allowedRoles={SURVEYOR_ROLES}>
          <EmployeeAttendance />
        </ProtectedRoute>
      } />
      <Route path="/employee/property-map" element={
        <ProtectedRoute allowedRoles={SURVEYOR_ROLES}>
          <EmployeePropertyMap />
        </ProtectedRoute>
      } />
      
      {/* Default redirect */}
      <Route path="/" element={
        user ? (
          <Navigate to={
            user.role === 'ADMIN' || user.role === 'SUPERVISOR' || user.role === 'MC_OFFICER' 
              ? '/admin' 
              : '/employee'
          } replace />
        ) : (
          <Navigate to="/login" replace />
        )
      } />
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TownProvider>
          <EnvBanner />
          <AppRoutes />
          <Toaster position="top-right" richColors closeButton />
        </TownProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
