import { Navigate, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiCall } from '../lib/api';

export default function ProtectedRoute() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await apiCall('/auth/me');
        setIsAuthenticated(true);
      } catch (error) {
        // Auto-login bypass
        try {
          const res = await apiCall('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'dhivith.off@gmail.com', password: '123456789' })
          });
          localStorage.setItem('token', res.data.token);
          setIsAuthenticated(true);
        } catch (e) {
          setIsAuthenticated(false);
        }
      }
    };
    checkAuth();
  }, []);

  if (isAuthenticated === null) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}
