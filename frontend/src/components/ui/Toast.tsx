import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

interface ToastContextType {
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({ type, title, message }: Omit<ToastItem, 'id'>) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          let bg = 'bg-slate-900 text-white border-slate-700';
          let icon = <Info className="text-blue-400 shrink-0" size={18} />;

          if (toast.type === 'success') {
            bg = 'bg-emerald-900/95 text-emerald-50 border-emerald-700/60';
            icon = <CheckCircle2 className="text-emerald-400 shrink-0" size={18} />;
          } else if (toast.type === 'error') {
            bg = 'bg-rose-900/95 text-rose-50 border-rose-700/60';
            icon = <AlertCircle className="text-rose-400 shrink-0" size={18} />;
          } else if (toast.type === 'warning') {
            bg = 'bg-amber-900/95 text-amber-50 border-amber-700/60';
            icon = <AlertTriangle className="text-amber-400 shrink-0" size={18} />;
          }

          return (
            <div
              key={toast.id}
              role="alert"
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-xl backdrop-blur-md border transition-all duration-300 animate-in slide-in-from-bottom-2 ${bg}`}
            >
              <div className="mt-0.5">{icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.message && <p className="text-xs opacity-90 mt-0.5 break-words">{toast.message}</p>}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="opacity-70 hover:opacity-100 p-0.5 rounded transition shrink-0"
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Graceful fallback if rendered outside provider
    return {
      addToast: ({ title, message }: { type?: string; title: string; message?: string }) => {
        console.log(`[Toast] ${title}: ${message || ''}`);
      },
      removeToast: () => {}
    };
  }
  return context;
}
