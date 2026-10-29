import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { apiCall } from '../lib/api';

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMsg(`Provider returned an error: ${error}`);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setErrorMsg('Missing required OAuth parameters');
      return;
    }

    // Process callback
    apiCall('/integrations/callback', { 
      method: 'POST',
      body: JSON.stringify({ code, state })
    })
      .then(() => {
        setStatus('success');
        // Redirect back to integrations page after a brief delay
        setTimeout(() => {
          navigate('/dashboard/integrations');
        }, 1500);
      })
      .catch((err: any) => {
        setStatus('error');
        setErrorMsg(err.message || 'Failed to complete connection');
      });
  }, [searchParams, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md bg-card border shadow-lg rounded-xl p-8 text-center space-y-6">
        {status === 'loading' && (
          <>
            <div className="flex justify-center">
              <div className="p-4 bg-primary/10 rounded-full">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Connecting account...</h2>
              <p className="text-muted-foreground mt-2">Please wait while we secure your connection.</p>
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="flex justify-center">
              <div className="p-4 bg-green-500/10 rounded-full animate-in zoom-in duration-300">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Connected successfully!</h2>
              <p className="text-muted-foreground mt-2">Redirecting you back...</p>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="flex justify-center">
              <div className="p-4 bg-red-500/10 rounded-full">
                <XCircle className="h-10 w-10 text-red-500" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Connection failed</h2>
              <p className="text-destructive mt-2">{errorMsg}</p>
            </div>
            <button 
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full mt-4" 
              onClick={() => navigate('/dashboard/integrations')}
            >
              Return to Integrations
            </button>
          </>
        )}
      </div>
    </div>
  );
}
