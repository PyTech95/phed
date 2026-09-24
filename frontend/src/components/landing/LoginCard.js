import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Lock, User, Loader2, ShieldCheck, Droplets } from 'lucide-react';

export default function LoginCard({ username, password, isLoading, onUsername, onPassword, onSubmit }) {
  return (
    <div className="ld-card" data-testid="login-card">
      <div className="ld-card-head">
        <h2 className="ld-card-title">Authorised sign in</h2>
        <p className="ld-card-sub">Field staff &amp; administrators</p>
      </div>
      <div className="ld-card-body">
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Username
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/80" />
              <Input
                id="username"
                data-testid="login-username-input"
                type="text"
                placeholder="Enter username"
                value={username}
                onChange={(e) => onUsername(e.target.value)}
                className="pl-10 h-12 rounded-xl bg-white/5 border-white/10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-cyan-300/30 focus-visible:border-cyan-300/60"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-300/80" />
              <Input
                id="password"
                data-testid="login-password-input"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => onPassword(e.target.value)}
                className="pl-10 h-12 rounded-xl bg-white/5 border-white/10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-cyan-300/30 focus-visible:border-cyan-300/60"
                required
              />
            </div>
          </div>
          <Button
            type="submit"
            data-testid="login-submit-btn"
            disabled={isLoading}
            className="w-full h-12 font-semibold rounded-xl text-[#04101C] bg-gradient-to-r from-cyan-300 to-teal-300 hover:from-cyan-200 hover:to-teal-200 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-400/30 hover:-translate-y-0.5 transition-[transform,box-shadow,background-color] duration-200"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in...</>
            ) : (
              <><ShieldCheck className="w-4 h-4 mr-2" /> Sign In</>
            )}
          </Button>
        </form>
        <div className="ld-card-foot">
          <Droplets className="w-3.5 h-3.5 text-teal-300" />
          <span>Authorised personnel only</span>
        </div>
      </div>
    </div>
  );
}
