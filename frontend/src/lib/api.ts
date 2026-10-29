let rawApiUrl = ((import.meta) as any).env.VITE_API_URL || ((import.meta) as any).env.NEXT_PUBLIC_API_URL || '/api';
rawApiUrl = rawApiUrl.replace(/\/+$/, '');

// If user supplied a full backend URL without /api, ensure /api is appended
if (rawApiUrl.startsWith('http') && !rawApiUrl.endsWith('/api')) {
  rawApiUrl += '/api';
}

const API_URL = rawApiUrl;

export const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('token');
  
  const headers: any = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // If endpoint already includes /api and API_URL also ends with /api, avoid /api/api duplication
  if (API_URL.endsWith('/api') && cleanEndpoint.startsWith('/api/')) {
    cleanEndpoint = cleanEndpoint.replace(/^\/api/, '');
  }

  const targetUrl = `${API_URL}${cleanEndpoint}`;
  const response = await fetch(targetUrl, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const backendError = typeof data?.error === 'string' ? data.error : data?.error?.message;
    const errorMsg =
      backendError ||
      data?.message ||
      (response.status === 404
        ? `API route not found (404) at ${targetUrl}. Verify your backend URL.`
        : `Server error (${response.status}): ${response.statusText}`);
    throw new Error(errorMsg);
  }

  if (data === null && text && text.trim().startsWith('<')) {
    throw new Error(
      `Received HTML instead of JSON from ${targetUrl}. Please ensure VITE_API_URL in Vercel is set to your Render backend URL (e.g. https://agentflux-backend.onrender.com/api).`
    );
  }

  return data;
};
