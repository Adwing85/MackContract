import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Person } from '../shared/types';
import { api, setApiUser } from './api';

// ---------------------------------------------------------------- Daten laden

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await fnRef.current();
      if (id === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, error, loading, reload };
}

// ---------------------------------------------------------------- Benachrichtigungen

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/** Führt eine Aktion aus und zeigt Fehler als Hinweis an. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await fn();
        if (success) toast(success, 'success');
        return result;
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
        return undefined;
      }
    },
    [toast],
  );
}

// ---------------------------------------------------------------- Personen & aktueller Benutzer

interface UserContextValue {
  people: Person[];
  currentUser: Person | null;
  setCurrentUserId: (id: number | null) => void;
  reloadPeople: () => Promise<void>;
  peopleLoaded: boolean;
}

const UserContext = createContext<UserContextValue>({
  people: [],
  currentUser: null,
  setCurrentUserId: () => undefined,
  reloadPeople: async () => undefined,
  peopleLoaded: false,
});

const USER_KEY = 'mackcontract.currentUser';

function readStoredUser(): number | null {
  try {
    const v = localStorage.getItem(USER_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(() => {
    const stored = readStoredUser();
    setApiUser(stored);
    return stored;
  });

  const reloadPeople = useCallback(async () => {
    try {
      setPeople(await api.people.list());
    } finally {
      setPeopleLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reloadPeople();
  }, [reloadPeople]);

  const setCurrentUserId = useCallback((id: number | null) => {
    setCurrentId(id);
    setApiUser(id);
    try {
      if (id) localStorage.setItem(USER_KEY, String(id));
      else localStorage.removeItem(USER_KEY);
    } catch {
      /* Speicher nicht verfügbar */
    }
  }, []);

  const currentUser = useMemo(() => people.find((p) => p.id === currentId) ?? null, [people, currentId]);

  useEffect(() => {
    // Gelöschte Person nicht weiter als aktuellen Benutzer führen.
    if (peopleLoaded && currentId && !currentUser) setCurrentUserId(null);
  }, [peopleLoaded, currentId, currentUser, setCurrentUserId]);

  const value = useMemo(
    () => ({ people, currentUser, setCurrentUserId, reloadPeople, peopleLoaded }),
    [people, currentUser, setCurrentUserId, reloadPeople, peopleLoaded],
  );
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUsers() {
  return useContext(UserContext);
}
