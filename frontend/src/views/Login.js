import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import SmoothScroll from '../components/landing/SmoothScroll';
import Hero from '../components/landing/Hero';
import Marquee from '../components/landing/Marquee';
import Manifesto from '../components/landing/Manifesto';
import TrustedBy from '../components/landing/TrustedBy';
import LandingFooter from '../components/landing/LandingFooter';
import LoginCard from '../components/landing/LoginCard';
import '../landing.css';

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
    <SmoothScroll>
      <main className="landing" data-testid="landing-page">
        <Hero
          loginCard={
            <LoginCard
              username={username}
              password={password}
              isLoading={isLoading}
              onUsername={setUsername}
              onPassword={setPassword}
              onSubmit={handleSubmit}
            />
          }
        />
        <Marquee />
        <Manifesto />
        <TrustedBy />
        <LandingFooter />
      </main>
    </SmoothScroll>
  );
}
