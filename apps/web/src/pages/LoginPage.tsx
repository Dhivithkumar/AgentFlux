import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiCall } from '../lib/api';

export default function LoginPage() {
  const [formData, setFormData] = useState({ email: 'dhivith.off@gmail.com', password: '123456789' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Auto-login bypass
    const autoLogin = async () => {
      setLoading(true);
      try {
        const res = await apiCall('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'dhivith.off@gmail.com', password: '123456789' })
        });
        localStorage.setItem('token', res.data.token);
        
        const busRes = await apiCall('/businesses');
        if (busRes.data && busRes.data.length > 0) {
          navigate('/dashboard');
        } else {
          navigate('/onboarding');
        }
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };
    autoLogin();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const res = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      localStorage.setItem('token', res.data.token);
      
      const busRes = await apiCall('/businesses');
      if (busRes.data && busRes.data.length > 0) {
        navigate('/dashboard');
      } else {
        navigate('/onboarding');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-slate-900">Sign in to Agent Flux</h2>
          {loading && <p className="mt-2 text-sm text-slate-600">Auto-logging in...</p>}
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Email address</label>
              <input required type="email" className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Password</label>
              <input required type="password" className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
            </div>
          </div>
          <div>
            <button disabled={loading} type="submit" className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
        <div className="text-center text-sm">
          <Link to="/register" className="text-primary-600 hover:text-primary-500">Don't have an account? Register</Link>
        </div>
      </div>
    </div>
  );
}
