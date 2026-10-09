const API_URL = ((import.meta) as any).env.NEXT_PUBLIC_API_URL || '/api';

export const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('token');
  
  const headers: any = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorMsg = (typeof data?.error === 'string' ? data.error : data?.error?.message) || data?.message || response.statusText || 'An error occurred';
    throw new Error(errorMsg);
  }

  return data;
};
