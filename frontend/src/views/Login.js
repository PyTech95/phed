import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Lock, User, Loader2, ShieldCheck, Droplets } from 'lucide-react';
import { toast } from 'sonner';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const reason = sessionStorage.getItem('signedOutReason');
    if (!reason) return;
    sessionStorage.removeItem('signedOutReason');
    const messages = {
      idle: ['Signed out due to inactivity', 'You were inactive for 10 minutes. Sign in again to continue.'],
      expired: ['Session expired', 'Please sign in again to continue.'],
    };
    const [title, description] = messages[reason] || messages.expired;
    toast.info(title, { id: 'signed-out-reason', description, duration: 6000 });
  }, []);

  useEffect(() => {
    if (user) {
      navigate(user.role === 'ADMIN' ? '/admin' : '/employee');
    }
  }, [user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const userData = await login(username, password);
      toast.success(`Ram Ram, ${userData.name}!`);
      navigate(userData.role === 'ADMIN' ? '/admin' : '/employee');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen login-bg flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 login-grid pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-fadeIn">
        <div className="clinic-card overflow-hidden" data-testid="login-card">
          <div className="h-1.5 w-full" style={{background: 'linear-gradient(90deg, var(--phed-blue-dark), var(--phed-blue), var(--phed-teal))'}} />

          {/* Logo + Title */}
          <div className="text-center pt-8 pb-4 px-8">
            <img
              src="/phed-logo.png"
              alt="Public Health Engineering Department - (PHED)"
              className="w-28 h-28 object-contain mx-auto mb-4"
            />
            <h1 className="text-lg md:text-xl font-heading font-bold tracking-tight" style={{color: 'var(--phed-ink)'}}>
              Public Health Engineering Department
            </h1>
            <p className="text-sm font-semibold mt-1" style={{color: 'var(--phed-blue)'}}>(PHED)</p>
            <p className="text-xs mt-1" style={{color: 'var(--phed-muted)'}}>PHED Survey & Notice Distribution</p>
          </div>

          <div className="mx-8 h-px" style={{background: 'var(--phed-border)'}} />

          {/* Login Form */}
          <div className="p-8 pt-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--phed-muted)'}}>
                  Username
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{color: 'var(--phed-blue)'}} />
                  <Input
                    id="username"
                    data-testid="login-username-input"
                    type="text"
                    placeholder="Enter username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10 h-12 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus-visible:border-blue-600 rounded-xl"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--phed-muted)'}}>
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{color: 'var(--phed-blue)'}} />
                  <Input
                    id="password"
                    data-testid="login-password-input"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 h-12 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus-visible:border-blue-600 rounded-xl"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                data-testid="login-submit-btn"
                className="w-full h-12 font-semibold text-white rounded-xl shadow-md shadow-blue-700/20 hover:shadow-lg hover:-translate-y-px transition-[transform,box-shadow,background-color] duration-200"
                style={{background: 'var(--phed-blue)'}}
                disabled={isLoading}
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in...</>
                ) : (
                  <><ShieldCheck className="w-4 h-4 mr-2" /> Sign In</>
                )}
              </Button>
            </form>

            {/* Footer */}
            <div className="mt-6 pt-5 border-t" style={{borderColor: 'var(--phed-border)'}}>
              <div className="flex items-center justify-center gap-2 text-xs" style={{color: 'var(--phed-muted)'}}>
                <Droplets className="w-3.5 h-3.5" style={{color: 'var(--phed-teal)'}} />
                <span>Public Health Engineering Department - (PHED)</span>
              </div>
              <p className="text-center text-[10px] mt-1" style={{color: 'var(--phed-muted)'}}>Authorised personnel only</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
